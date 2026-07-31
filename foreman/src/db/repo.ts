import { randomUUID } from 'node:crypto';
import type { Sql } from './sql.ts';
import type { Audit, AuditEntry } from '../guards/audit.ts';
import type { Usage } from '../claude/catalog.ts';

/** Short, sortable, readable ids. `run_01H…` beats a bare uuid in a log. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export interface ClaimedTask {
  id: string;
  title: string;
  spec: string;
  definition_of_done: string;
  owner_role: string;
}

/**
 * Claim exactly one runnable task, atomically.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes this safe to call from more than one
 * worker without two of them picking up the same task — the second skips the
 * locked row instead of blocking on it. Concurrency is 1 today, but this is
 * the kind of thing that is free to get right now and painful to retrofit.
 *
 * A task is only claimable when every id in `blocked_by` has actually
 * finished, which is checked here rather than trusted from a status column
 * somebody forgot to update.
 */
export async function claimNextTask(
  sql: Sql,
  opts: { role?: string } = {},
): Promise<ClaimedTask | null> {
  const { rows } = await sql.query<ClaimedTask>(
    `UPDATE task
        SET status = 'running'
      WHERE id = (
        SELECT t.id
          FROM task t
         WHERE t.status = 'ready'
           AND ($1::text IS NULL OR t.owner_role = $1)
           AND NOT EXISTS (
                 SELECT 1
                   FROM unnest(t.blocked_by) AS dep(id)
                   JOIN task b ON b.id = dep.id
                  WHERE b.status <> 'done'
               )
         ORDER BY t.priority, t.created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
  RETURNING id, title, spec, definition_of_done, owner_role`,
    [opts.role ?? null],
  );
  return rows[0] ?? null;
}

export async function startRun(
  sql: Sql,
  input: { taskId: string; roleId: string; model: string; effort: string },
): Promise<string> {
  const runId = id('run');
  await sql.query(
    `INSERT INTO run (id, task_id, role_id, model, effort) VALUES ($1, $2, $3, $4, $5)`,
    [runId, input.taskId, input.roleId, input.model, input.effort],
  );
  return runId;
}

export async function finishRun(
  sql: Sql,
  input: {
    runId: string;
    status: 'done' | 'parked' | 'failed' | 'aborted';
    usage: Usage;
    costUsd: number;
    summary?: string;
    error?: string;
  },
): Promise<void> {
  await sql.query(
    `UPDATE run
        SET status = $2, ended_at = now(),
            input_tokens = $3, cached_input_tokens = $4, output_tokens = $5,
            cost_usd = $6, summary = $7, error = $8
      WHERE id = $1`,
    [
      input.runId,
      input.status,
      input.usage.input + input.usage.cacheWrite,
      input.usage.cachedInput,
      input.usage.output,
      input.costUsd,
      input.summary ?? null,
      input.error ?? null,
    ],
  );
}

/**
 * Add today's spend and report the new total.
 *
 * Done as one upsert rather than read-then-write so two concurrent runs cannot
 * both read $4.90 and both decide there is room under a $5 cap.
 */
export async function addSpend(
  sql: Sql,
  input: { usd: number; inputTokens: number; outputTokens: number },
): Promise<number> {
  const { rows } = await sql.query<{ usd: string }>(
    `INSERT INTO spend_day (date, usd, input_tokens, output_tokens)
          VALUES (CURRENT_DATE, $1, $2, $3)
     ON CONFLICT (date) DO UPDATE
            SET usd = spend_day.usd + EXCLUDED.usd,
                input_tokens = spend_day.input_tokens + EXCLUDED.input_tokens,
                output_tokens = spend_day.output_tokens + EXCLUDED.output_tokens
       RETURNING usd`,
    [input.usd, input.inputTokens, input.outputTokens],
  );
  return Number(rows[0]?.usd ?? 0);
}

export async function spendToday(sql: Sql): Promise<number> {
  const { rows } = await sql.query<{ usd: string }>(
    `SELECT usd FROM spend_day WHERE date = CURRENT_DATE`,
  );
  return Number(rows[0]?.usd ?? 0);
}

/** The Audit port, backed by the append-only table. */
export class PgAudit implements Audit {
  constructor(private readonly sql: Sql) {}

  async record(entry: Omit<AuditEntry, 'at'> & { at?: Date }): Promise<void> {
    await this.sql.query(
      `INSERT INTO audit (at, actor, action, subject, detail)
            VALUES (COALESCE($1, now()), $2, $3, $4, $5)`,
      [
        entry.at ?? null,
        entry.actor,
        entry.action,
        entry.subject ?? null,
        JSON.stringify(entry.detail ?? {}),
      ],
    );
  }
}

export async function recordToolCall(
  sql: Sql,
  input: {
    runId: string;
    seq: number;
    tool: string;
    args: unknown;
    effect: string;
    reason: string;
    ok?: boolean;
    resultHash?: string;
    ms?: number;
    approvedBy?: string;
  },
): Promise<string> {
  const callId = id('tc');
  await sql.query(
    `INSERT INTO tool_call
       (id, run_id, seq, tool, args, effect_class, reason, ok, result_hash, ms, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      callId,
      input.runId,
      input.seq,
      input.tool,
      JSON.stringify(input.args ?? {}),
      input.effect,
      input.reason,
      input.ok ?? null,
      input.resultHash ?? null,
      input.ms ?? null,
      input.approvedBy ?? null,
    ],
  );
  return callId;
}
