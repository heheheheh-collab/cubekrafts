import type { RoleName, ToolCall } from '../domain/types.ts';
import type { Sql } from '../db/sql.ts';
import type { Message } from '../claude/client.ts';
import { PgAudit, id, recordToolCall, finishRun, addSpend, setTaskStatus } from '../db/repo.ts';
import { runTool, PolicyViolation } from '../tools/execute.ts';
import { runAgent, type LoopContext, type RunResult } from './loop.ts';
import { recordLesson } from './learned.ts';

/**
 * Parking a run, and picking it up again.
 *
 * When an agent reaches for something guarded, the run stops mid-conversation
 * and waits. That means the conversation has to survive the wait — it is
 * written to the database, not held in memory — because the founder may
 * approve it tomorrow, from a phone, after a deploy has restarted the process.
 */

export interface ParkedApproval {
  id: string;
  runId: string;
  taskId: string;
  role: RoleName;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  createdAt: Date;
  waitingMinutes: number;
}

/** Old enough that the context which justified it may have moved on. */
export const STALE_AFTER_DAYS = 7;

export async function saveMessages(sql: Sql, runId: string, messages: Message[]): Promise<void> {
  await sql.query('DELETE FROM message WHERE run_id = $1', [runId]);
  let seq = 0;
  for (const m of messages) {
    await sql.query('INSERT INTO message (run_id, seq, role, content) VALUES ($1, $2, $3, $4)', [
      runId,
      seq++,
      m.role,
      JSON.stringify(m.content),
    ]);
  }
}

export async function loadMessages(sql: Sql, runId: string): Promise<Message[]> {
  const { rows } = await sql.query<{ role: string; content: unknown }>(
    'SELECT role, content FROM message WHERE run_id = $1 ORDER BY seq',
    [runId],
  );
  return rows.map((r) => ({ role: r.role, content: r.content }) as Message);
}

/** Record the stop: the conversation, the call, and the thing awaiting a person. */
export async function parkRun(
  sql: Sql,
  input: {
    runId: string;
    taskId: string;
    role: RoleName;
    call: ToolCall;
    reason: string;
    messages: Message[];
    seq: number;
  },
): Promise<string> {
  await saveMessages(sql, input.runId, input.messages);

  const toolCallId = await recordToolCall(sql, {
    runId: input.runId,
    seq: input.seq,
    tool: input.call.name,
    args: input.call.args,
    effect: 'guarded',
    reason: input.reason,
  });

  const approvalId = id('apr');
  await sql.query(
    `INSERT INTO approval (id, run_id, tool_call_id, kind, preview, status)
          VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [
      approvalId,
      input.runId,
      toolCallId,
      input.call.name,
      JSON.stringify({
        tool: input.call.name,
        args: input.call.args,
        reason: input.reason,
        role: input.role,
        taskId: input.taskId,
      }),
    ],
  );
  return approvalId;
}

export async function listPending(sql: Sql): Promise<ParkedApproval[]> {
  const { rows } = await sql.query<{
    id: string;
    run_id: string;
    preview: { tool: string; args: Record<string, unknown>; reason: string; role: RoleName; taskId: string };
    created_at: Date;
  }>(
    `SELECT id, run_id, preview, created_at
       FROM approval WHERE status = 'pending' ORDER BY created_at`,
  );
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    taskId: r.preview.taskId,
    role: r.preview.role,
    tool: r.preview.tool,
    args: r.preview.args,
    reason: r.preview.reason,
    createdAt: new Date(r.created_at),
    waitingMinutes: Math.max(0, (now - new Date(r.created_at).getTime()) / 60_000),
  }));
}

export class ApprovalError extends Error {}

export interface DecideDeps {
  sql: Sql;
  /** Everything the resumed run needs, minus the parts read from the database. */
  context: (input: { runId: string; role: RoleName }) => Omit<LoopContext, 'runId' | 'role' | 'audit'>;
  now?: () => Date;
}

export interface Decision {
  approvalId: string;
  decision: 'approve' | 'reject';
  reason?: string;
  /** Approving an item older than the stale window needs saying twice. */
  confirmStale?: boolean;
}

export interface DecisionResult {
  executed: boolean;
  toolOutput?: string;
  resumed?: RunResult;
}

/**
 * Approve or reject a parked call, then let the run carry on.
 *
 * Rejection resumes too, rather than killing the run. The agent is told what
 * the founder said and gets a chance to do something else with it, which is
 * both more useful and closer to how you would treat a colleague.
 */
export async function decide(input: Decision, deps: DecideDeps): Promise<DecisionResult> {
  const { sql } = deps;
  const now = deps.now?.() ?? new Date();

  const { rows } = await sql.query<{
    id: string;
    run_id: string;
    status: string;
    created_at: Date;
    preview: { tool: string; args: Record<string, unknown>; reason: string; role: RoleName; taskId: string };
    tool_call_id: string;
  }>(
    `SELECT id, run_id, status, created_at, preview, tool_call_id FROM approval WHERE id = $1`,
    [input.approvalId],
  );
  const approval = rows[0];
  if (!approval) throw new ApprovalError(`no approval ${input.approvalId}`);
  if (approval.status !== 'pending') {
    // Idempotent by refusal rather than by silence: a double-tap on a phone
    // must not send the same email twice.
    throw new ApprovalError(`approval ${input.approvalId} was already ${approval.status}`);
  }

  const ageDays = (now.getTime() - new Date(approval.created_at).getTime()) / 86_400_000;
  if (input.decision === 'approve' && ageDays > STALE_AFTER_DAYS && !input.confirmStale) {
    throw new ApprovalError(
      `this has been waiting ${Math.floor(ageDays)} days — confirm you still want it sent`,
    );
  }

  const audit = new PgAudit(sql);
  const role = approval.preview.role;
  const call: ToolCall = {
    id: `toolu_${approval.tool_call_id}`,
    name: approval.preview.tool,
    args: approval.preview.args,
  };

  await sql.query(`UPDATE approval SET status = $2, decided_at = now(), reason = $3 WHERE id = $1`, [
    approval.id,
    input.decision === 'approve' ? 'approved' : 'rejected',
    input.reason ?? null,
  ]);
  await audit.record({
    actor: 'founder',
    action: `approval.${input.decision}`,
    subject: approval.id,
    detail: { tool: call.name, reason: input.reason ?? null },
  });

  const base = deps.context({ runId: approval.run_id, role });
  const messages = await loadMessages(sql, approval.run_id);

  let toolOutput: string;
  let executed = false;

  if (input.decision === 'approve') {
    try {
      // Facts are re-read here rather than reused from the park. Hours may
      // have passed; the branch that was checked out when the agent asked is
      // not necessarily the one checked out now, and `runTool` re-classifies
      // against whatever this returns.
      const facts = base.readFacts ? await base.readFacts() : base.facts;
      const result = await runTool(call, {
        role,
        policy: base.policy,
        facts,
        audit,
        runId: approval.run_id,
        ...(base.sinks ? { sinks: base.sinks } : {}),
        ...(base.workspace ? { workspace: base.workspace } : {}),
      });
      executed = result.ok;
      toolOutput = result.output;
      await sql.query(`UPDATE tool_call SET ok = $2, result_hash = $3, ms = $4, approved_by = 'founder' WHERE id = $1`, [
        approval.tool_call_id,
        result.ok,
        result.resultHash,
        result.ms,
      ]);
    } catch (err) {
      // The world moved between the approval and the execution — the
      // re-classification inside runTool caught it. Say so plainly rather than
      // resuming as though it had worked.
      if (err instanceof PolicyViolation) {
        await setTaskStatus(sql, approval.preview.taskId, 'blocked');
        await audit.record({
          actor: 'system',
          action: 'approval.refused_at_execution',
          subject: approval.id,
          detail: { tool: call.name, reason: err.message },
        });
        throw err;
      }
      throw err;
    }
  } else {
    toolOutput =
      `The founder declined this. Reason: ${input.reason ?? 'none given'}. ` +
      `Do not retry the same action — either take a different approach or stop and explain.`;
    // Told once, remembered afterwards. The reason goes into the role's
    // charter so the next run starts already knowing it, rather than the
    // founder rejecting the same thing every week.
    if (input.reason) {
      await recordLesson(sql, { role, reason: input.reason, about: call.name });
    }
  }

  messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: call.id,
        content: toolOutput,
        ...(input.decision === 'reject' ? { is_error: true } : {}),
      },
    ],
  });

  const resumed = await runAgent(messages, { ...base, runId: approval.run_id, role, audit });

  await finishRun(sql, {
    runId: approval.run_id,
    status: resumed.outcome.kind === 'done' ? 'done' : 'parked',
    usage: resumed.usage,
    costUsd: resumed.costUsd,
    summary: resumed.outcome.kind === 'done' ? resumed.outcome.text.slice(0, 500) : resumed.outcome.kind,
  });
  await addSpend(sql, {
    usd: resumed.costUsd,
    inputTokens: resumed.usage.input + resumed.usage.cachedInput + resumed.usage.cacheWrite,
    outputTokens: resumed.usage.output,
  });
  await saveMessages(sql, approval.run_id, resumed.messages);
  await setTaskStatus(
    sql,
    approval.preview.taskId,
    resumed.outcome.kind === 'done' ? 'review' : 'blocked',
  );

  return { executed, toolOutput, resumed };
}
