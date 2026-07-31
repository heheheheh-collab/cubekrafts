import type { Autonomy, PolicyConfig, RoleName, RuntimeFacts, ToolCall } from '../domain/types.ts';
import type { Audit } from '../guards/audit.ts';
import { classify, disposition } from '../tools/effects.ts';
import { runTool, PolicyViolation, type ToolSinks } from '../tools/execute.ts';
import { toolsFor } from '../tools/registry.ts';
import { addUsage, NO_USAGE, type Effort, type ModelEntry, type Usage } from '../claude/catalog.ts';
import type { Claude, Message, TurnResult } from '../claude/client.ts';

/**
 * The agent loop.
 *
 * Thirty-odd lines, and deliberately ours rather than the SDK's tool runner:
 * the permission classifier has to sit between the model asking for a tool and
 * that tool running, and that position is the security boundary of the whole
 * application. It belongs in code you can read top to bottom in one sitting.
 *
 * The loop never throws for ordinary trouble. It returns an outcome, because
 * every ending — done, parked on an approval, parked on a question, refused,
 * out of budget — is a state the task needs to record and resume from.
 */

export type Outcome =
  | { kind: 'done'; text: string }
  | { kind: 'awaiting_approval'; call: ToolCall; reason: string }
  | { kind: 'awaiting_founder'; question: string }
  | { kind: 'refused'; reason: string; category?: string | null }
  | { kind: 'aborted'; reason: string }
  | { kind: 'exhausted'; reason: string };

export interface RunResult {
  outcome: Outcome;
  /** The conversation as it ended, ready to be stored and resumed. */
  messages: Message[];
  usage: Usage;
  costUsd: number;
  steps: number;
}

export interface LoopContext {
  runId: string;
  role: RoleName;
  claude: Pick<Claude, 'turn'>;
  model: ModelEntry;
  effort: Effort;
  policy: PolicyConfig;
  facts: RuntimeFacts;
  audit: Audit;
  /** Autonomy per tool for this role. Missing means the spec default applies. */
  autonomy: (tool: string) => Autonomy;
  sinks?: Partial<ToolSinks>;
  /** Stable, cacheable prefix: tool preamble, charter, canon. */
  stableSystem: string[];
  volatileSystem?: string[];
  maxSteps?: number;
  /** Stops the loop mid-run when the founder says "stop". */
  signal?: AbortSignal;
  /** Checkpoint after every step so a crash or deploy resumes cleanly. */
  onStep?: (step: number, result: TurnResult, messages: Message[]) => Promise<void>;
}

const DEFAULT_MAX_STEPS = 12;

export async function runAgent(
  initial: Message[],
  ctx: LoopContext,
): Promise<RunResult> {
  const messages: Message[] = [...initial];
  const tools = toolsFor(ctx.role);
  const maxSteps = ctx.maxSteps ?? DEFAULT_MAX_STEPS;
  let usage = NO_USAGE;
  let costUsd = 0;
  let steps = 0;

  const finish = (outcome: Outcome): RunResult => ({ outcome, messages, usage, costUsd, steps });

  await ctx.audit.record({
    actor: ctx.role,
    action: 'run.start',
    subject: ctx.runId,
    detail: { model: ctx.model.model, effort: ctx.effort },
  });

  for (steps = 1; steps <= maxSteps; steps++) {
    if (ctx.signal?.aborted) {
      await ctx.audit.record({
        actor: 'founder',
        action: 'run.aborted',
        subject: ctx.runId,
        detail: { step: steps },
      });
      return finish({ kind: 'aborted', reason: 'stopped by the founder' });
    }

    const result = await ctx.claude.turn({
      stableSystem: ctx.stableSystem,
      ...(ctx.volatileSystem ? { volatileSystem: ctx.volatileSystem } : {}),
      messages,
      tools,
      model: ctx.model,
      effort: ctx.effort,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    usage = addUsage(usage, result.usage);
    costUsd += result.costUsd;
    messages.push({ role: 'assistant', content: result.raw });
    await ctx.onStep?.(steps, result, messages);

    if (result.finish === 'refused') {
      await ctx.audit.record({
        actor: ctx.role,
        action: 'run.refused',
        subject: ctx.runId,
        detail: { category: result.refusal?.category ?? null },
      });
      return finish({
        kind: 'refused',
        reason: result.refusal?.explanation ?? 'the model declined this request',
        category: result.refusal?.category ?? null,
      });
    }

    if (result.finish === 'truncated') {
      // Not retried here: the caller decides whether to reopen with more room,
      // because that costs money and the task may not be worth it.
      return finish({ kind: 'exhausted', reason: 'ran out of output tokens mid-answer' });
    }

    if (result.finish === 'end') {
      await ctx.audit.record({
        actor: ctx.role,
        action: 'run.done',
        subject: ctx.runId,
        detail: { steps, costUsd: round(costUsd) },
      });
      return finish({ kind: 'done', text: result.text });
    }

    // Tool calls. Classify every one before running any of them, and stop at
    // the first that needs the founder — executing the safe ones and queueing
    // the rest leaves a half-finished turn nobody can reason about.
    const results: Array<{ id: string; content: string; isError: boolean }> = [];

    for (const call of result.toolCalls) {
      const verdict = classify(ctx.role, call, ctx.policy, ctx.facts);
      const decision = disposition(verdict, ctx.autonomy(call.name));

      if (decision.action === 'refuse') {
        await ctx.audit.record({
          actor: ctx.role,
          action: 'run.refused_tool',
          subject: ctx.runId,
          detail: { tool: call.name, reason: decision.reason },
        });
        return finish({ kind: 'refused', reason: decision.reason });
      }

      if (decision.action === 'queue') {
        await ctx.audit.record({
          actor: ctx.role,
          action: 'run.parked',
          subject: ctx.runId,
          detail: { tool: call.name, reason: decision.reason },
        });
        return finish({ kind: 'awaiting_approval', call, reason: decision.reason });
      }

      try {
        const out = await runTool(call, {
          role: ctx.role,
          policy: ctx.policy,
          facts: ctx.facts,
          audit: ctx.audit,
          runId: ctx.runId,
          ...(ctx.sinks ? { sinks: ctx.sinks } : {}),
        });
        results.push({ id: call.id, content: out.output, isError: !out.ok });
      } catch (err) {
        if (err instanceof PolicyViolation) {
          return finish({ kind: 'refused', reason: err.message });
        }
        throw err;
      }

      // `ask_founder` succeeds and then parks: the answer is the point, and
      // continuing without it is exactly the guessing this tool exists to stop.
      if (call.name === 'ask_founder') {
        const question = String(call.args['question'] ?? '');
        return finish({ kind: 'awaiting_founder', question });
      }
    }

    messages.push({
      role: 'user',
      // Every result goes back in a single user message. Splitting them across
      // messages teaches the model to stop making parallel calls.
      content: results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    });
  }

  await ctx.audit.record({
    actor: ctx.role,
    action: 'run.exhausted',
    subject: ctx.runId,
    detail: { maxSteps },
  });
  return finish({ kind: 'exhausted', reason: `stopped after ${maxSteps} steps` });
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
