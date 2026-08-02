import type { Sql } from '../db/sql.ts';
import { runAgent, type Outcome } from '../agents/loop.ts';
import { modelFor } from '../claude/catalog.ts';
import { PgAudit, addSpend, finishRun, startRun } from '../db/repo.ts';
import { saveMessages } from '../agents/approvals.ts';
import type { TickDeps } from './tick.ts';

/**
 * The COO's supervision pass.
 *
 * Not everything the COO does is a task. Reviewing finished work, planning a
 * goal that has no work under it, and unblocking what it can are all real runs
 * — they cost money and they can go wrong — but none of them belongs to a task
 * row, which is why `run.task_id` is nullable.
 *
 * It runs only when there is something to supervise. A COO that wakes up every
 * ten minutes to confirm there is nothing to do is a standing charge on the
 * daily cap, and the cap is what stops the whole thing at 3am.
 */

export interface SupervisionNeed {
  /** Finished work waiting on a verdict. */
  inReview: number;
  /** Goals with no task under them at all. */
  unplannedGoals: number;
  /** Tasks that came back blocked and nobody has looked at. */
  blocked: number;
}

export async function whatNeedsSupervision(sql: Sql): Promise<SupervisionNeed> {
  const { rows } = await sql.query<{ in_review: string; unplanned: string; blocked: string }>(
    `SELECT
       (SELECT count(*) FROM task WHERE status = 'review')  AS in_review,
       (SELECT count(*) FROM goal g
         WHERE g.status = 'open'
           AND NOT EXISTS (
             SELECT 1 FROM initiative i JOIN task t ON t.initiative_id = i.id
              WHERE i.goal_id = g.id))                      AS unplanned,
       (SELECT count(*) FROM task WHERE status = 'blocked') AS blocked`,
  );
  const row = rows[0];
  return {
    inReview: Number(row?.in_review ?? 0),
    unplannedGoals: Number(row?.unplanned ?? 0),
    blocked: Number(row?.blocked ?? 0),
  };
}

export function isIdle(need: SupervisionNeed): boolean {
  return need.inReview === 0 && need.unplannedGoals === 0 && need.blocked === 0;
}

/** What the COO is looking at, written out rather than left to be discovered. */
export function supervisionPrompt(need: SupervisionNeed): string {
  const jobs: string[] = [];
  if (need.inReview > 0) {
    jobs.push(
      `${need.inReview} task(s) are finished and waiting on your verdict. Look each one ` +
        `up, read it against its own definition of done, and call org.review. Accept what ` +
        `meets it.`,
    );
  }
  if (need.unplannedGoals > 0) {
    jobs.push(
      `${need.unplannedGoals} goal(s) have no work under them. Break each into three to ` +
        `six tasks with org.dispatch, each with a definition of done a role can check ` +
        `itself against.`,
    );
  }
  if (need.blocked > 0) {
    jobs.push(
      `${need.blocked} task(s) are blocked. Look at why. If it is something you can fix — ` +
        `a vague spec, a missing piece of context — dispatch a corrected task. If it needs ` +
        `the founder, ask_founder once, specifically.`,
    );
  }

  return [
    'Supervision pass. Nothing is queued for the roles, so this is your turn.',
    '',
    ...jobs.map((j, i) => `${i + 1}. ${j}`),
    '',
    'Start by looking things up — the numbers above are counts, not the work itself.',
    'Do these jobs and stop. Do not invent work to fill the pass.',
  ].join('\n');
}

export interface SupervisionResult {
  runId: string;
  outcome: Outcome;
  costUsd: number;
  need: SupervisionNeed;
}

export async function supervise(deps: TickDeps): Promise<SupervisionResult | null> {
  const { sql } = deps;
  const coo = deps.roles['coo'];
  if (!coo) return null;

  const need = await whatNeedsSupervision(sql);
  if (isIdle(need)) return null;

  const audit = new PgAudit(sql);
  const model = modelFor(coo.tier);
  const runId = await startRun(sql, {
    taskId: null,
    roleId: 'coo',
    model: model.model,
    effort: coo.effort,
  });

  let result;
  try {
    result = await runAgent([{ role: 'user', content: supervisionPrompt(need) }], {
      runId,
      role: 'coo',
      claude: deps.claude,
      model,
      effort: coo.effort,
      policy: deps.policy,
      facts: deps.facts ?? {},
      audit,
      autonomy: () => 'approve',
      ...(deps.sinks ? { sinks: deps.sinks } : {}),
      stableSystem: coo.stableSystem,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch (err) {
    // Same reasoning as the task path: an unexpected throw must still close
    // the run, or the dashboard shows a COO that has been thinking for a week.
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(sql, {
      runId,
      status: 'failed',
      usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
      costUsd: 0,
      error: message,
    });
    throw err;
  }

  await saveMessages(sql, runId, result.messages);
  await finishRun(sql, {
    runId,
    status: result.outcome.kind === 'done' ? 'done' : 'failed',
    usage: result.usage,
    costUsd: result.costUsd,
    ...(result.outcome.kind === 'done' ? { summary: result.outcome.text.slice(0, 500) } : {}),
  });
  await addSpend(sql, {
    usd: result.costUsd,
    inputTokens: result.usage.input + result.usage.cachedInput + result.usage.cacheWrite,
    outputTokens: result.usage.output,
  });

  return { runId, outcome: result.outcome, costUsd: result.costUsd, need };
}
