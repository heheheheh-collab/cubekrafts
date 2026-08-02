import type { PolicyConfig, RoleName, RuntimeFacts } from '../domain/types.ts';
import type { Sql } from '../db/sql.ts';
import type { Claude } from '../claude/client.ts';
import type { ToolSinks } from '../tools/execute.ts';
import { modelFor, type Effort, type Tier } from '../claude/catalog.ts';
import { runAgent, type Outcome } from '../agents/loop.ts';
import { parkRun, saveMessages } from '../agents/approvals.ts';
import { supervise } from './supervise.ts';
import { PgAudit } from '../db/repo.ts';
import {
  addSpend,
  claimNextTask,
  finishRun,
  getSetting,
  setTaskStatus,
  spendToday,
  startRun,
  SETTINGS,
  DEFAULT_CAP_USD,
} from '../db/repo.ts';

/**
 * The tick.
 *
 * One task per tick, claimed atomically, run to an outcome, recorded. Every
 * exit is a state the task can be resumed from, and the two gates in front of
 * the claim — paused, and the daily spend cap — are checked before any money
 * is spent rather than after.
 *
 * Server-side and always on, so this runs overnight. That is the whole reason
 * the standup is written before you wake up, and also why the cap is a hard
 * stop rather than a warning nobody is awake to read.
 */

export interface RoleConfig {
  name: RoleName;
  tier: Tier;
  effort: Effort;
  /** Stable, cacheable prefix: tool preamble, charter, canon. */
  stableSystem: string[];
}

export interface TickDeps {
  sql: Sql;
  claude: Pick<Claude, 'turn'>;
  policy: PolicyConfig;
  facts?: RuntimeFacts;
  roles: Partial<Record<RoleName, RoleConfig>>;
  sinks?: Partial<ToolSinks>;
  signal?: AbortSignal;
  /** Overridden in tests; the real one reads the wall clock. */
  now?: () => Date;
}

export type TickResult =
  | { ran: false; why: 'paused' | 'cap_reached' | 'no_work' | 'no_role_config'; detail?: string }
  | {
      ran: true;
      /** `supervision` is the COO's pass, which belongs to no task. */
      kind: 'task' | 'supervision';
      taskId: string | null;
      runId: string;
      outcome: Outcome;
      costUsd: number;
    };

// Re-exported because callers reach for `SETTINGS` from the scheduler, which
// is where it used to live; the definition sits beside the accessors now.
export { SETTINGS, DEFAULT_CAP_USD };

/**
 * How a run's ending maps onto the task's next state.
 *
 * Nothing here silently closes a task. `done` goes to review rather than done,
 * because in this design a role never marks its own work complete — the COO
 * does, against the definition of done.
 */
export function nextTaskStatus(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'done':
      return 'review';
    case 'awaiting_approval':
    case 'awaiting_founder':
      return 'blocked';
    case 'aborted':
      // Stopping something is not rejecting it; it goes back in the queue.
      return 'ready';
    case 'refused':
    case 'exhausted':
      return 'blocked';
  }
}

function runStatus(outcome: Outcome): 'done' | 'parked' | 'failed' | 'aborted' {
  switch (outcome.kind) {
    case 'done':
      return 'done';
    case 'awaiting_approval':
    case 'awaiting_founder':
      return 'parked';
    case 'aborted':
      return 'aborted';
    case 'refused':
    case 'exhausted':
      return 'failed';
  }
}

function summarise(outcome: Outcome): string {
  switch (outcome.kind) {
    case 'done':
      return outcome.text.slice(0, 500);
    case 'awaiting_approval':
      return `waiting on approval: ${outcome.reason}`;
    case 'awaiting_founder':
      return `waiting on an answer: ${outcome.question}`;
    case 'refused':
      return `refused: ${outcome.reason}`;
    case 'aborted':
      return outcome.reason;
    case 'exhausted':
      return outcome.reason;
  }
}

export async function tick(deps: TickDeps): Promise<TickResult> {
  const { sql } = deps;
  const audit = new PgAudit(sql);

  if (await getSetting<boolean>(sql, SETTINGS.paused, false)) {
    return { ran: false, why: 'paused' };
  }

  const cap = await getSetting<number>(sql, SETTINGS.dailyCapUsd, DEFAULT_CAP_USD);
  const spent = await spendToday(sql);
  if (spent >= cap) {
    // Checked before claiming so a capped system does not leave a task stuck
    // in `running` with nothing working on it.
    await audit.record({
      actor: 'system',
      action: 'tick.cap_reached',
      detail: { spentUsd: spent, capUsd: cap },
    });
    return { ran: false, why: 'cap_reached', detail: `$${spent.toFixed(2)} of $${cap.toFixed(2)}` };
  }

  const task = await claimNextTask(sql);
  if (!task) {
    // Nothing queued for the roles, so it is the COO's turn — but only if
    // there is something to supervise. A COO that wakes every ten minutes to
    // confirm there is nothing to do is a standing charge on the daily cap.
    const pass = await supervise(deps);
    if (!pass) return { ran: false, why: 'no_work' };
    return {
      ran: true,
      kind: 'supervision',
      taskId: null,
      runId: pass.runId,
      outcome: pass.outcome,
      costUsd: pass.costUsd,
    };
  }

  const role = deps.roles[task.owner_role as RoleName];
  if (!role) {
    // Claimed but unrunnable. Put it back rather than leaving it `running`
    // forever because a role was disabled between planning and execution.
    await setTaskStatus(sql, task.id, 'blocked');
    await audit.record({
      actor: 'system',
      action: 'tick.no_role_config',
      subject: task.id,
      detail: { role: task.owner_role },
    });
    return { ran: false, why: 'no_role_config', detail: task.owner_role };
  }

  const model = modelFor(role.tier);
  const runId = await startRun(sql, {
    taskId: task.id,
    roleId: role.name,
    model: model.model,
    effort: role.effort,
  });

  const prompt =
    `Task: ${task.title}\n\n${task.spec}\n\n` +
    `Definition of done:\n${task.definition_of_done}\n\n` +
    `When the work is finished, record it with artifact.create. ` +
    `If a decision is genuinely not yours to make, use ask_founder rather than guessing.`;

  let result;
  try {
    result = await runAgent([{ role: 'user', content: prompt }], {
      runId,
      role: role.name,
      claude: deps.claude,
      model,
      effort: role.effort,
      policy: deps.policy,
      facts: deps.facts ?? {},
      audit,
      autonomy: () => 'approve',
      ...(deps.sinks ? { sinks: deps.sinks } : {}),
      stableSystem: role.stableSystem,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch (err) {
    // An unexpected throw must still close the run and free the task, or the
    // next tick finds a task stuck in `running` and quietly does nothing.
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(sql, {
      runId,
      status: 'failed',
      usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
      costUsd: 0,
      error: message,
    });
    await setTaskStatus(sql, task.id, 'blocked');
    await audit.record({
      actor: 'system',
      action: 'tick.crashed',
      subject: runId,
      detail: { task: task.id, error: message },
    });
    throw err;
  }

  // A run that stopped for the founder has to survive the wait, so the
  // conversation goes to the database along with the pending call. Everything
  // else still stores its transcript, because replaying a run after editing a
  // charter is how agent behaviour gets debugged.
  if (result.outcome.kind === 'awaiting_approval') {
    await parkRun(sql, {
      runId,
      taskId: task.id,
      role: role.name,
      call: result.outcome.call,
      reason: result.outcome.reason,
      messages: result.messages,
      seq: result.steps,
    });
  } else {
    await saveMessages(sql, runId, result.messages);
  }

  await finishRun(sql, {
    runId,
    status: runStatus(result.outcome),
    usage: result.usage,
    costUsd: result.costUsd,
    summary: summarise(result.outcome),
  });

  await addSpend(sql, {
    usd: result.costUsd,
    inputTokens: result.usage.input + result.usage.cachedInput + result.usage.cacheWrite,
    outputTokens: result.usage.output,
  });

  await setTaskStatus(sql, task.id, nextTaskStatus(result.outcome));

  return {
    ran: true,
    kind: 'task',
    taskId: task.id,
    runId,
    outcome: result.outcome,
    costUsd: result.costUsd,
  };
}

/**
 * The loop around the tick.
 *
 * Deliberately serial: one tick at a time, and the next interval is measured
 * from when the last one *finished*, so a slow run cannot stack ticks on top
 * of each other.
 */
export function startScheduler(
  deps: TickDeps,
  opts: { intervalMs?: number; onResult?: (r: TickResult) => void } = {},
): { stop: () => void; runNow: () => Promise<TickResult> } {
  const intervalMs = opts.intervalMs ?? 10 * 60 * 1000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const once = async (): Promise<TickResult> => {
    const result = await tick(deps);
    opts.onResult?.(result);
    return result;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await once();
      } catch {
        // A crashed tick has already recorded itself; the loop must survive it.
      }
      schedule();
    }, intervalMs);
    // Don't hold the process open just for the next tick.
    timer.unref?.();
  };

  schedule();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    runNow: once,
  };
}
