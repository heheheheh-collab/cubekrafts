import type { Sql } from '../db/sql.ts';

/**
 * Rate limiting for the auth routes.
 *
 * Fixed windows in the database rather than a counter in memory: the limit
 * then holds across a restart and across two processes, which is the whole
 * point of having one. The cost is a row per bucket per window, swept lazily.
 *
 * Two buckets on every attempt — the caller's IP, and a global one. The
 * global bucket is what stops a distributed attempt from getting a fresh
 * allowance per address.
 */

export interface Limit {
  /** Attempts allowed inside one window. */
  max: number;
  windowSeconds: number;
}

export const AUTH_LIMITS = {
  perIp: { max: 10, windowSeconds: 60 } satisfies Limit,
  global: { max: 60, windowSeconds: 60 } satisfies Limit,
};

export interface LimitResult {
  ok: boolean;
  /** Attempts left in the current window; zero when blocked. */
  remaining: number;
  retryAfterSeconds: number;
}

function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Count one attempt against a bucket.
 *
 * The increment and the read are a single statement, so two requests arriving
 * together cannot both see the same count and both decide there was room.
 */
export async function hit(
  sql: Sql,
  bucket: string,
  limit: Limit,
  now: Date = new Date(),
): Promise<LimitResult> {
  const start = windowStart(now, limit.windowSeconds);
  const { rows } = await sql.query<{ hits: number }>(
    `INSERT INTO rate_counter (bucket, window_start, hits) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_counter.hits + 1
     RETURNING hits`,
    [bucket, start],
  );
  const hits = rows[0]?.hits ?? 1;
  const elapsed = (now.getTime() - start.getTime()) / 1000;
  return {
    ok: hits <= limit.max,
    remaining: Math.max(0, limit.max - hits),
    retryAfterSeconds: Math.max(1, Math.ceil(limit.windowSeconds - elapsed)),
  };
}

/** Both buckets, failing on whichever is exhausted first. */
export async function checkAuthAttempt(
  sql: Sql,
  ip: string,
  now: Date = new Date(),
): Promise<LimitResult> {
  const perIp = await hit(sql, `auth:ip:${ip}`, AUTH_LIMITS.perIp, now);
  const global = await hit(sql, 'auth:global', AUTH_LIMITS.global, now);
  if (!perIp.ok) return perIp;
  if (!global.ok) return global;
  return perIp;
}

/** Drop windows nobody can be inside any more. Called on a timer, not per request. */
export async function sweep(sql: Sql, olderThanSeconds = 3600): Promise<number> {
  const { rows } = await sql.query<{ bucket: string }>(
    `DELETE FROM rate_counter
      WHERE window_start < now() - make_interval(secs => $1) RETURNING bucket`,
    [olderThanSeconds],
  );
  return rows.length;
}
