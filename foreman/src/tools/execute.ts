import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import type { PolicyConfig, RoleName, RuntimeFacts, ToolCall } from '../domain/types.ts';
import type { Audit } from '../guards/audit.ts';
import { safeResolve } from '../guards/fs-safe.ts';
import { classify } from './effects.ts';
import type { Workspace } from './workspace.ts';

/**
 * Tool execution.
 *
 * The agent loop has already classified the call and decided to run it. This
 * module classifies it **again** before doing anything, because the loop and
 * the executor are separated by time — an approval can sit in the queue for
 * hours, and the world may have changed under it. Re-checking is one function
 * call and removes a whole category of time-of-check/time-of-use bug.
 *
 * Every call is bracketed by audit writes: an attempt before, a result after.
 */

export interface ExecuteContext {
  role: RoleName;
  policy: PolicyConfig;
  facts: RuntimeFacts;
  audit: Audit;
  runId: string;
  /** Injected so tests can assert on timing without waiting for a clock. */
  now?: () => number;
  /** Sinks for tools that produce records rather than touching the disk. */
  sinks?: Partial<ToolSinks>;
  /** The checkout git and shell tools operate in. Absent means they cannot run. */
  workspace?: Workspace;
}

export interface ToolSinks {
  createArtifact(input: { kind: string; title: string; body: string }): Promise<{ id: string }>;
  askFounder(input: { question: string }): Promise<{ id: string }>;
  saveDraft(input: { lead_id: string; subject: string; body: string }): Promise<{ id: string }>;
  /** Only ever reached through an approval; never called by a role directly. */
  sendEmail(input: { draft_id: string }): Promise<{ sent: boolean; detail: string }>;
  listInquiries(input: { limit?: number }): Promise<string>;
  searchMemory(input: { query: string }): Promise<string>;

  // The work graph. Reads come back as text because text is what a model can
  // use; the shapes behind them are the HTTP API's business, not the prompt's.
  lookUp(input: { view: string; query?: string }): Promise<string>;
  setGoal(input: { title: string; why?: string }): Promise<{ id: string }>;
  dispatch(input: {
    title: string;
    spec: string;
    definition_of_done: string;
    owner_role: string;
    priority?: number;
  }): Promise<{ id: string }>;
  review(input: { task_id: string; verdict: string; notes: string }): Promise<{ status: string }>;
  answer(input: { question_id: string; answer: string }): Promise<{ taskId: string | null }>;
  control(input: { paused: boolean }): Promise<void>;
}

export interface ToolResult {
  ok: boolean;
  /** What goes back to the model as the tool result. */
  output: string;
  /** Stable hash of the output, stored in the audit log instead of the body. */
  resultHash: string;
  ms: number;
}

const MAX_OUTPUT = 60_000; // characters; beyond this the model gains nothing

function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function truncate(s: string): string {
  return s.length <= MAX_OUTPUT
    ? s
    : `${s.slice(0, MAX_OUTPUT)}\n\n[truncated — ${s.length - MAX_OUTPUT} more characters]`;
}

function need(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') throw new ToolError(`missing string argument: ${key}`);
  return v;
}

/** The tool could not do its job: missing file, bad input, sink unavailable. */
export class ToolError extends Error {}

/**
 * The tool was asked to do something it is not allowed to do.
 *
 * Kept distinct from ToolError on purpose. An operational failure is handed
 * back to the model so it can adapt — that is normal and expected. A policy
 * violation aborts the run and is audited as a refusal, because an agent
 * trying to leave its jail is not a situation to negotiate with, and because
 * six months later you want to be able to tell the two apart at a glance.
 */
export class PolicyViolation extends Error {}

export async function runTool(call: ToolCall, ctx: ExecuteContext): Promise<ToolResult> {
  const clock = ctx.now ?? (() => performance.now());
  const started = clock();

  // Re-verify. The loop checked this too; between then and now an approval may
  // have waited hours, and policy or branch may have moved.
  const verdict = classify(ctx.role, call, ctx.policy, ctx.facts);
  if (verdict.effect === 'forbidden') {
    await ctx.audit.record({
      actor: ctx.role,
      action: 'tool.refused',
      subject: ctx.runId,
      detail: { tool: call.name, args: call.args, reason: verdict.reason },
    });
    throw new PolicyViolation(`refused: ${verdict.reason}`);
  }

  await ctx.audit.record({
    actor: ctx.role,
    action: 'tool.attempt',
    subject: ctx.runId,
    detail: { tool: call.name, args: call.args, effect: verdict.effect },
  });

  let output: string;
  let ok = true;
  try {
    output = await dispatch(call, ctx);
  } catch (err) {
    if (err instanceof PolicyViolation) {
      await ctx.audit.record({
        actor: ctx.role,
        action: 'tool.refused',
        subject: ctx.runId,
        detail: { tool: call.name, args: call.args, reason: err.message },
      });
      throw err;
    }
    ok = false;
    // An operational failure goes back to the model so it can adapt, which is
    // the whole point of returning a result rather than throwing out of the loop.
    output = err instanceof Error ? err.message : String(err);
  }

  output = truncate(output);
  const result: ToolResult = {
    ok,
    output,
    resultHash: hash(output),
    ms: Math.round(clock() - started),
  };

  await ctx.audit.record({
    actor: ctx.role,
    action: 'tool.result',
    subject: ctx.runId,
    detail: {
      tool: call.name,
      ok: result.ok,
      resultHash: result.resultHash,
      bytes: output.length,
      ms: result.ms,
    },
  });

  return result;
}

async function dispatch(call: ToolCall, ctx: ExecuteContext): Promise<string> {
  const roots = ctx.policy.allowedRoots[ctx.role] ?? [];

  switch (call.name) {
    case 'fs.read': {
      const target = await resolveOrThrow(need(call.args, 'path'), roots);
      return await readFile(target, 'utf8');
    }

    case 'fs.write': {
      const content = need(call.args, 'content');
      const safe = await safeResolveOrThrow(need(call.args, 'path'), roots);
      await mkdir(dirname(safe.path), { recursive: true });
      await writeFile(safe.path, content, 'utf8');
      // Report the path relative to the root that actually matched, not the
      // first configured one — a role with two roots would otherwise be told
      // it wrote to a path that reads like ../../elsewhere.
      return `wrote ${content.length} characters to ${relative(safe.root ?? '/', safe.path)}`;
    }

    case 'fs.list': {
      const target = await resolveOrThrow(need(call.args, 'path'), roots);
      const entries = await readdir(target, { withFileTypes: true });
      if (entries.length === 0) return '(empty directory)';
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join('\n');
    }

    case 'artifact.create': {
      const sink = ctx.sinks?.createArtifact;
      if (!sink) throw new ToolError('artifact.create has no sink configured');
      const { id } = await sink({
        kind: need(call.args, 'kind'),
        title: need(call.args, 'title'),
        body: need(call.args, 'body'),
      });
      return `recorded artifact ${id}; it is now queued for review`;
    }

    case 'ask_founder': {
      const sink = ctx.sinks?.askFounder;
      if (!sink) throw new ToolError('ask_founder has no sink configured');
      const { id } = await sink({ question: need(call.args, 'question') });
      return `asked (${id}). This task is parked until the founder answers.`;
    }

    case 'email.draft': {
      const sink = ctx.sinks?.saveDraft;
      if (!sink) throw new ToolError('email.draft has no sink configured');
      const { id } = await sink({
        lead_id: need(call.args, 'lead_id'),
        subject: need(call.args, 'subject'),
        body: need(call.args, 'body'),
      });
      return `draft ${id} saved. Nothing has been sent; call email.send to queue it for approval.`;
    }

    case 'git.branch': {
      return await workspaceOf(ctx).createBranch(need(call.args, 'name'));
    }

    case 'git.commit': {
      return await workspaceOf(ctx).commitAll(need(call.args, 'message'));
    }

    case 'git.diff': {
      return await workspaceOf(ctx).diff();
    }

    case 'git.push': {
      // The branch comes from `facts`, which the caller read from git — the
      // same value the classifier just approved. Reading it again here could
      // race with a checkout between the two, and pushing a branch nobody
      // classified is precisely what must not happen.
      const branch = ctx.facts.currentBranch;
      if (branch === undefined) throw new PolicyViolation('no branch is checked out');
      return await workspaceOf(ctx).pushAndOpenPr({
        branch,
        title: need(call.args, 'title'),
        body: need(call.args, 'body'),
      });
    }

    case 'shell.run': {
      const argv = call.args['argv'];
      if (!Array.isArray(argv)) throw new ToolError('shell.run needs an argv array');
      const result = await workspaceOf(ctx).exec(argv as string[]);
      return result.ok ? result.output || '(no output)' : `exited non-zero:\n${result.output}`;
    }

    case 'http.fetch': {
      // The classifier has already required https and decided whether the
      // host needed approval. What is left is to fetch it without letting the
      // response become a denial of service: a cap on time, a cap on bytes,
      // and no redirect chase to a host nobody classified.
      const url = need(call.args, 'url');
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          headers: { accept: 'text/html,text/plain,application/json', 'user-agent': 'Foreman' },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        throw new ToolError(`could not fetch ${url}: ${err instanceof Error ? err.message : err}`);
      }
      if (response.status >= 300 && response.status < 400) {
        const to = response.headers.get('location') ?? 'somewhere';
        return `${url} redirects to ${to}. Fetch that instead if you still want it — a redirect is a different host and has to be classified as one.`;
      }
      const body = await response.text();
      return `HTTP ${response.status}\n\n${body.slice(0, MAX_OUTPUT)}`;
    }

    case 'cubekrafts.inquiries': {
      const sink = ctx.sinks?.listInquiries;
      if (!sink) throw new ToolError('this instance is not connected to Cubekrafts');
      const limit = call.args['limit'];
      return await sink(typeof limit === 'number' ? { limit } : {});
    }

    case 'email.send': {
      const sink = ctx.sinks?.sendEmail;
      if (!sink) throw new ToolError('email.send has no sink configured');
      const { sent, detail } = await sink({ draft_id: need(call.args, 'draft_id') });
      // A refusal comes back as an ordinary result rather than an exception:
      // a suppressed address or an exhausted cap is something the agent should
      // hear about and adapt to, not a fault to abort the run over.
      return sent ? `sent. ${detail}` : `not sent — ${detail}`;
    }

    case 'memory.search': {
      const sink = ctx.sinks?.searchMemory;
      if (!sink) throw new ToolError('memory.search has no sink configured');
      return await sink({ query: need(call.args, 'query') });
    }

    case 'org.look_up': {
      const sink = ctx.sinks?.lookUp;
      if (!sink) throw new ToolError('org.look_up has no sink configured');
      const query = call.args['query'];
      return await sink({
        view: need(call.args, 'view'),
        ...(typeof query === 'string' && query.length > 0 ? { query } : {}),
      });
    }

    case 'org.set_goal': {
      const sink = ctx.sinks?.setGoal;
      if (!sink) throw new ToolError('org.set_goal has no sink configured');
      const why = call.args['why'];
      const { id } = await sink({
        title: need(call.args, 'title'),
        ...(typeof why === 'string' ? { why } : {}),
      });
      return `recorded goal ${id}. It has no work under it yet.`;
    }

    case 'org.dispatch': {
      const sink = ctx.sinks?.dispatch;
      if (!sink) throw new ToolError('org.dispatch has no sink configured');
      const priority = call.args['priority'];
      const { id } = await sink({
        title: need(call.args, 'title'),
        spec: need(call.args, 'spec'),
        definition_of_done: need(call.args, 'definition_of_done'),
        owner_role: need(call.args, 'owner_role'),
        ...(typeof priority === 'number' ? { priority } : {}),
      });
      return `created task ${id}, ready for ${need(call.args, 'owner_role')} to pick up.`;
    }

    case 'org.review': {
      const sink = ctx.sinks?.review;
      if (!sink) throw new ToolError('org.review has no sink configured');
      const { status } = await sink({
        task_id: need(call.args, 'task_id'),
        verdict: need(call.args, 'verdict'),
        notes: need(call.args, 'notes'),
      });
      return `task ${need(call.args, 'task_id')} is now ${status}.`;
    }

    case 'org.answer': {
      const sink = ctx.sinks?.answer;
      if (!sink) throw new ToolError('org.answer has no sink configured');
      const { taskId } = await sink({
        question_id: need(call.args, 'question_id'),
        answer: need(call.args, 'answer'),
      });
      return taskId === null
        ? 'answered. There was no task waiting on it.'
        : `answered; task ${taskId} can run again.`;
    }

    case 'org.control': {
      const sink = ctx.sinks?.control;
      if (!sink) throw new ToolError('org.control has no sink configured');
      const paused = call.args['paused'] === true;
      await sink({ paused });
      return paused ? 'stopped. Nothing new will be claimed.' : 'running again.';
    }

    default:
      // Classified as executable but nothing here can run it — that is a gap in
      // this file, not permission to improvise.
      throw new ToolError(`${call.name} is not implemented yet`);
  }
}

/** The checkout, or a plain refusal. An agent told "not configured" can adapt. */
function workspaceOf(ctx: ExecuteContext): Workspace {
  if (!ctx.workspace) throw new ToolError('this instance has no code checkout configured');
  return ctx.workspace;
}

async function resolveOrThrow(path: string, roots: readonly string[]): Promise<string> {
  return (await safeResolveOrThrow(path, roots)).path;
}

async function safeResolveOrThrow(path: string, roots: readonly string[]) {
  const safe = await safeResolve(path, roots);
  if (!safe.ok) throw new PolicyViolation(safe.reason ?? 'path is outside the workspace');
  return safe;
}
