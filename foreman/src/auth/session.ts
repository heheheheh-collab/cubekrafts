import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Sql } from '../db/sql.ts';
import { id } from '../db/repo.ts';

/**
 * Sessions.
 *
 * The cookie carries an opaque random token; the database stores only its
 * hash. A dump of the session table therefore does not let anyone sign in,
 * and revocation is a row update rather than a key rotation.
 *
 * Thirty-day sliding expiry, because this has to be pleasant to use from a
 * phone, and the four dangerous settings ask for re-authentication anyway.
 */

export const COOKIE = 'foreman_session';
export const SESSION_DAYS = 30;
/** Re-authentication is required for the dangerous four beyond this age. */
export const FRESH_MINUTES = 15;

export interface SessionRecord {
  id: string;
  device: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(
  sql: Sql,
  opts: { device?: string; ip?: string } = {},
): Promise<{ token: string; id: string }> {
  const token = newToken();
  const sessionId = id('sess');
  await sql.query(
    `INSERT INTO session (id, token_hash, device, ip) VALUES ($1, $2, $3, $4)`,
    [sessionId, hash(token), opts.device ?? null, opts.ip ?? null],
  );
  return { token, id: sessionId };
}

export interface ActiveSession {
  id: string;
  lastSeenAt: Date;
  createdAt: Date;
  /** True when the session is recent enough to change something dangerous. */
  fresh: boolean;
}

/**
 * Look up a session and slide its expiry.
 *
 * Returns null for anything unusable — unknown, revoked, or past its window —
 * so callers cannot accidentally treat "expired" as "valid but old".
 */
export async function verifySession(sql: Sql, token: string | undefined): Promise<ActiveSession | null> {
  if (!token) return null;
  const { rows } = await sql.query<{
    id: string;
    created_at: Date;
    last_seen_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, created_at, last_seen_at, revoked_at FROM session WHERE token_hash = $1`,
    [hash(token)],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;

  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Date.now() - lastSeen > SESSION_DAYS * 86_400_000) return null;

  await sql.query(`UPDATE session SET last_seen_at = now() WHERE id = $1`, [row.id]);

  return {
    id: row.id,
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
    // Freshness is measured from when the passkey was presented, not from
    // when the session was last used. A session slides its expiry on every
    // request, so measuring from last-seen would make a browser left open
    // permanently fresh — which is exactly what the dangerous four are meant
    // to prevent. A session row is created at sign-in and never re-used for
    // a second sign-in, so `created_at` is the authentication time.
    fresh: Date.now() - new Date(row.created_at).getTime() < FRESH_MINUTES * 60_000,
  };
}

export async function revokeSession(sql: Sql, sessionId: string): Promise<void> {
  await sql.query(`UPDATE session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
    sessionId,
  ]);
}

export async function revokeAll(sql: Sql): Promise<number> {
  const { rows } = await sql.query<{ id: string }>(
    `UPDATE session SET revoked_at = now() WHERE revoked_at IS NULL RETURNING id`,
  );
  return rows.length;
}

export async function listSessions(sql: Sql): Promise<SessionRecord[]> {
  const { rows } = await sql.query<{
    id: string;
    device: string | null;
    created_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT id, device, created_at, last_seen_at FROM session
      WHERE revoked_at IS NULL ORDER BY last_seen_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    device: r.device,
    createdAt: new Date(r.created_at),
    lastSeenAt: new Date(r.last_seen_at),
  }));
}

/** `Set-Cookie` for a fresh session. Secure unless explicitly running plain http. */
export function sessionCookie(token: string, opts: { secure?: boolean } = {}): string {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86_400}`,
  ];
  if (opts.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | undefined, name = COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Constant-time compare, for the recovery code and the CSRF token. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
