import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ActiveSession } from '../auth/session.ts';

/**
 * The router, and the two things every handler needs.
 *
 * Node's own server and a regex table, rather than a framework: the route
 * list is short, it is all one consumer, and a dependency here would be more
 * code than it saves.
 */

/**
 * What a route demands of the caller.
 *
 * - `public`  — reachable signed out. Sign-in and health, and nothing else.
 * - `session` — a valid session cookie.
 * - `fresh`   — a session that authenticated within the last fifteen minutes.
 *               The four dangerous settings, per §4 of the plan.
 */
export type AuthLevel = 'public' | 'session' | 'fresh';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  /** Present on everything but `public` routes. */
  session: ActiveSession | null;
  ip: string | null;
}

export type Handler = (ctx: Ctx) => Promise<void> | void;

export interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: AuthLevel;
  handler: Handler;
}

export function route(method: string, path: string, auth: AuthLevel, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:[a-zA-Z]+/g, (m) => {
        keys.push(m.slice(1));
        return '([^/]+)';
      }) +
      '/?$',
  );
  return { method, pattern, keys, auth, handler };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A body larger than this is a bug or an attack, not a real request.
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export function userAgent(req: IncomingMessage): string | null {
  const value = req.headers['user-agent'];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * A short, honest device name for the sessions panel.
 *
 * Not user-agent parsing in any serious sense — just enough that "Revoke" on
 * a phone tells you which row is the phone.
 */
export function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Browser';
}
