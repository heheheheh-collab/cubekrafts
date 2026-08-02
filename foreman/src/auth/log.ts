import type { IncomingMessage } from 'node:http';
import type { Sql } from '../db/sql.ts';

/**
 * The auth log.
 *
 * Every sign-in, every failure, every revocation, with address and user
 * agent. It is on the dashboard rather than in a file, because the point is
 * that you notice a failed attempt without going looking for one.
 */

export type AuthEventKind =
  | 'register.begin'
  | 'register.finish'
  | 'signin.begin'
  | 'signin.finish'
  | 'signin.recovery'
  | 'signout'
  | 'session.revoked'
  | 'sessions.revoked_all'
  | 'credential.removed'
  | 'recovery.issued'
  | 'rate_limited';

export async function recordAuthEvent(
  sql: Sql,
  kind: AuthEventKind,
  ok: boolean,
  ctx: { ip?: string | null; userAgent?: string | null; detail?: Record<string, unknown> } = {},
): Promise<void> {
  await sql.query(
    `INSERT INTO auth_event (kind, ip, user_agent, ok, detail) VALUES ($1, $2, $3, $4, $5)`,
    [
      kind,
      // The column is INET; anything unparseable would abort the insert and
      // lose the event, which matters more than the address does.
      isAddress(ctx.ip) ? ctx.ip : null,
      ctx.userAgent?.slice(0, 500) ?? null,
      ok,
      JSON.stringify(ctx.detail ?? {}),
    ],
  );
}

export interface AuthEventRow {
  at: Date;
  kind: string;
  ip: string | null;
  userAgent: string | null;
  ok: boolean;
  detail: Record<string, unknown>;
}

export async function recentAuthEvents(sql: Sql, limit = 100): Promise<AuthEventRow[]> {
  const { rows } = await sql.query<{
    at: Date;
    kind: string;
    ip: string | null;
    user_agent: string | null;
    ok: boolean;
    detail: Record<string, unknown>;
  }>(`SELECT at, kind, ip, user_agent, ok, detail FROM auth_event ORDER BY at DESC LIMIT $1`, [
    limit,
  ]);
  return rows.map((r) => ({
    at: new Date(r.at),
    kind: r.kind,
    ip: r.ip,
    userAgent: r.user_agent,
    ok: r.ok,
    detail: r.detail,
  }));
}

function isAddress(value: string | null | undefined): value is string {
  if (!value) return false;
  // Deliberately loose: enough to keep junk out of an INET column, not a
  // validator. Postgres does the real parsing.
  return /^[0-9a-fA-F:.]+$/.test(value) && value.length <= 45;
}

/**
 * The caller's address.
 *
 * Behind Fly and Cloudflare the socket address is a proxy, so the real one
 * arrives in a header. That header is only trustworthy because nothing but
 * the proxy can reach the app — which is why the plan puts Cloudflare Access
 * in front of the origin. When running without a proxy, `trustProxy` is off
 * and the socket wins, because otherwise anyone could claim any address and
 * walk straight through the per-IP rate limit.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = req.headers['fly-client-ip'] ?? req.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? null;
}
