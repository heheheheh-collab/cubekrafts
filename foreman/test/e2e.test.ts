import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import { createApp } from '../src/server/app.ts';
import { EventBus } from '../src/server/events.ts';
import { makeSinks } from '../src/tools/sinks.ts';
import { stableSystemFor } from '../src/agents/charters.ts';
import { DEFAULT_POLICY } from '../src/domain/types.ts';
import { CATALOG } from '../src/claude/catalog.ts';
import type { TurnResult } from '../src/claude/client.ts';
import type { TickDeps } from '../src/scheduler/tick.ts';
import { COOKIE, createSession } from '../src/auth/session.ts';

/**
 * Phase 0's success condition, end to end and through the real HTTP surface:
 *
 *   you type a goal, an agent writes a post, it stops at a guarded action,
 *   you approve it, and the whole thing is in the audit log.
 *
 * Claude is scripted — the point is the machinery around the model, not the
 * model — but everything else is real: real Postgres, real files, real HTTP,
 * real classifier.
 */

let pg: PGlite;
let home: string;
let server: Server;
let base: string;
let cookie: string;
let turns: Partial<TurnResult>[] = [];

const claude = {
  turn: async () => {
    const next = turns.shift() ?? { finish: 'end' as const, text: 'nothing left to do' };
    return {
      finish: 'end',
      text: '',
      toolCalls: [],
      usage: { input: 120, cachedInput: 8000, cacheWrite: 0, output: 300 },
      costUsd: 0.006,
      raw: [],
      ...next,
    } as TurnResult;
  },
};

/**
 * A signed-in, same-origin request — what the real UI sends.
 *
 * Both headers are load-bearing: without the cookie the gate answers 401, and
 * without `origin` a state-changing request is refused as cross-site. Passing
 * `{ signedIn: false }` or `{ origin: … }` is how the tests below prove that.
 */
async function api(
  method: string,
  path: string,
  body?: unknown,
  opts: { signedIn?: boolean; origin?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.signedIn !== false) headers['cookie'] = cookie;
  const origin = opts.origin === undefined ? base : opts.origin;
  if (origin !== null) headers['origin'] = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/**
 * Claim a port before building the app, because the app needs to be told its
 * own origin at construction and the origin contains the port.
 */
async function reservePort(): Promise<number> {
  const { createServer: probeServer } = await import('node:http');
  const probe = probeServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg, defaultMigrationsDir());
  home = await mkdtemp(join(tmpdir(), 'foreman-e2e-'));
  base = `http://127.0.0.1:${await reservePort()}`;

  const sql = pg;
  const sinks = makeSinks(sql, home);
  const policy = { ...DEFAULT_POLICY, allowedRoots: { content: [home] } };
  const roleConfig = {
    name: 'content' as const,
    tier: 'mid' as const,
    effort: 'high' as const,
    stableSystem: stableSystemFor('content'),
  };
  const tickDeps: TickDeps = { sql, claude, policy, sinks, roles: { content: roleConfig } };

  server = createApp({
    sql,
    bus: new EventBus(),
    tickDeps,
    security: { origin: base, https: false },
    webauthn: { rpID: '127.0.0.1', rpName: 'Foreman test', origin: base },
    decideDeps: {
      context: () => ({
        claude,
        model: CATALOG.mid,
        effort: 'high',
        policy,
        facts: {},
        autonomy: () => 'approve',
        sinks,
        stableSystem: roleConfig.stableSystem,
      }),
    },
  });

  await new Promise<void>((resolve) =>
    server.listen(Number(new URL(base).port), '127.0.0.1', resolve),
  );
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pg.close();
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM approval; DELETE FROM message; DELETE FROM tool_call; DELETE FROM run;
    DELETE FROM task; DELETE FROM goal; DELETE FROM artifact; DELETE FROM question;
    DELETE FROM audit; DELETE FROM spend_day; DELETE FROM setting; DELETE FROM role;
    DELETE FROM session; DELETE FROM auth_event; DELETE FROM rate_counter;
  `);
  await pg.query(
    `INSERT INTO role (id, name, model, enabled) VALUES ('content','content','claude-sonnet-5', TRUE)`,
  );
  // Minted directly rather than through a passkey ceremony: driving a real
  // authenticator needs a browser. The gate being exercised here is the same
  // one either way — these tests are about what a signed-in caller can reach,
  // and test/auth.test.ts is about how you become one.
  const { token } = await createSession(pg, { device: 'Test' });
  cookie = `${COOKIE}=${token}`;
  turns = [];
});

describe('the whole loop', () => {
  it('takes a goal, writes a post, stops for approval, and publishes once approved', async () => {
    // 1. The founder states a goal and a task under it.
    const goal = await api('POST', '/api/goals', { title: 'Ship the August post' });
    expect(goal.status).toBe(201);

    const task = await api('POST', '/api/tasks', {
      title: 'August blog post',
      spec: 'Write the August post about modular site offices.',
      definition_of_done: '600 words, brand voice, ends with a call to action.',
      owner_role: 'content',
    });
    expect(task.status).toBe(201);

    // 2. The agent writes a draft, records it, and reaches for publish.
    turns = [
      {
        finish: 'tool_calls',
        toolCalls: [
          { id: 'tu1', name: 'fs.write', args: { path: 'august.md', content: '# Site offices\n600 words here.' } },
        ],
      },
      {
        finish: 'tool_calls',
        toolCalls: [
          {
            id: 'tu2',
            name: 'artifact.create',
            args: { kind: 'post', title: 'Site offices in August', body: '# Site offices' },
          },
        ],
      },
      {
        finish: 'tool_calls',
        toolCalls: [
          { id: 'tu3', name: 'artifact.publish', args: { artifact_id: 'art_x', where: 'blog' } },
        ],
      },
    ];

    const tick = await api('POST', '/api/tick');
    expect(tick.body).toMatchObject({ ran: true, outcome: { kind: 'awaiting_approval' } });

    // The safe work happened; the file is really on disk.
    expect(await readFile(join(home, 'august.md'), 'utf8')).toContain('Site offices');

    // 3. It is waiting on the founder, and says why.
    const pending = await api('GET', '/api/approvals');
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({ tool: 'artifact.publish', role: 'content' });
    expect(pending.body[0].reason).toMatch(/publishing art_x to blog/);

    // The concierge answers the obvious question with no model call.
    const talk = await api('POST', '/api/talk', { text: "what's pending" });
    expect(talk.body.speech).toMatch(/^1 approval waiting\./);

    // 4. The founder approves, and the run carries on from where it stopped.
    turns = [{ finish: 'end', text: 'Published to the blog.' }];
    const decided = await api('POST', `/api/approvals/${pending.body[0].id}/decide`, {
      decision: 'approve',
    });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ outcome: 'done' });

    // 5. The whole thing is in the audit log, in order.
    const audit = await api('GET', '/api/audit');
    const actions = (audit.body as Array<{ action: string }>).map((a) => a.action).reverse();
    expect(actions).toContain('run.start');
    expect(actions).toContain('tool.attempt');
    expect(actions).toContain('run.parked');
    expect(actions).toContain('approval.approve');
    expect(actions).toContain('run.done');

    // and the task moved to review rather than closing itself
    const tasks = await api('GET', '/api/tasks');
    expect(tasks.body[0]).toMatchObject({ status: 'review' });
  });

  it('lets the founder reject with a reason, and the agent hears it', async () => {
    await api('POST', '/api/tasks', {
      title: 'Post',
      spec: 'write it',
      definition_of_done: 'a post',
      owner_role: 'content',
    });
    turns = [
      {
        finish: 'tool_calls',
        toolCalls: [{ id: 'tu1', name: 'artifact.publish', args: { artifact_id: 'a1', where: 'blog' } }],
      },
    ];
    await api('POST', '/api/tick');
    const pending = await api('GET', '/api/approvals');

    let sawRejection = '';
    turns = [{ finish: 'end', text: 'Understood, leaving it as a draft.' }];
    const spy = {
      turn: async (t: { messages: Array<{ content: unknown }> }) => {
        sawRejection = JSON.stringify(t.messages.at(-1)!.content);
        return claude.turn();
      },
    };

    // Rebuild only the piece that needs the spy, to keep the rest real.
    const { decide } = await import('../src/agents/approvals.ts');
    await decide(
      { approvalId: pending.body[0].id, decision: 'reject', reason: 'Too salesy — rewrite the opening.' },
      {
        sql: pg,
        context: () => ({
          claude: spy,
          model: CATALOG.mid,
          effort: 'high',
          policy: { ...DEFAULT_POLICY, allowedRoots: { content: [home] } },
          facts: {},
          autonomy: () => 'approve',
          stableSystem: stableSystemFor('content'),
        }),
      },
    );

    expect(sawRejection).toContain('Too salesy');
    expect(sawRejection).toContain('is_error');
  });

  it('refuses to decide the same approval twice', async () => {
    await api('POST', '/api/tasks', {
      title: 'Post',
      spec: 'write it',
      definition_of_done: 'a post',
      owner_role: 'content',
    });
    turns = [
      {
        finish: 'tool_calls',
        toolCalls: [{ id: 'tu1', name: 'artifact.publish', args: { artifact_id: 'a1', where: 'blog' } }],
      },
    ];
    await api('POST', '/api/tick');
    const pending = await api('GET', '/api/approvals');
    const path = `/api/approvals/${pending.body[0].id}/decide`;

    turns = [{ finish: 'end', text: 'done' }];
    expect((await api('POST', path, { decision: 'approve' })).status).toBe(200);

    // A double tap on a phone must not act twice.
    const second = await api('POST', path, { decision: 'approve' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already approved/);
  });
});

describe('the API refuses bad input plainly', () => {
  it('will not create a task with no definition of done', async () => {
    const res = await api('POST', '/api/tasks', { title: 'vague', spec: 'do something' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/definition of done/);
  });

  it('will not create a goal with no title', async () => {
    expect((await api('POST', '/api/goals', {})).status).toBe(400);
  });

  it('serves the shell signed out, because the shell is what draws the gate', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    // A cached shell after a deploy is an old app talking to a new API.
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('Foreman');
  });

  it('serves the shell for a path the client routes itself', async () => {
    expect((await fetch(`${base}/settings`)).status).toBe(200);
  });

  it('will not serve a file outside the web directory', async () => {
    const res = await fetch(`${base}/../package.json`, { redirect: 'manual' });
    expect(await res.text()).not.toContain('"name": "foreman"');
  });

  it('404s an unknown route with the method and path', async () => {
    const res = await api('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/GET \/api\/nope/);
  });
});

describe('the gate', () => {
  it('turns away every route that is not sign-in or health', async () => {
    const guarded: Array<[string, string]> = [
      ['GET', '/api/snapshot'],
      ['GET', '/api/approvals'],
      ['GET', '/api/tasks'],
      ['GET', '/api/audit'],
      ['GET', '/api/spend'],
      ['POST', '/api/tick'],
      ['POST', '/api/talk'],
      ['POST', '/api/goals'],
      ['POST', '/api/control/pause'],
    ];
    for (const [method, path] of guarded) {
      const res = await api(method, path, method === 'POST' ? {} : undefined, { signedIn: false });
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });

  it('lets health through signed out, because a health check has no cookie', async () => {
    const res = await api('GET', '/api/health', undefined, { signedIn: false });
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('reports whether anyone has claimed it, signed out', async () => {
    const res = await api('GET', '/api/auth/state', undefined, { signedIn: false });
    expect(res.body).toMatchObject({ claimed: false, signedIn: false });
  });

  it('refuses a state-changing request from another origin, cookie or not', async () => {
    const res = await api('POST', '/api/goals', { title: 'x' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/evil\.example/);
  });

  it('refuses a state-changing request with no origin at all', async () => {
    const res = await api('POST', '/api/goals', { title: 'x' }, { origin: null });
    expect(res.status).toBe(403);
  });

  it('still serves a read with no origin header', async () => {
    expect((await api('GET', '/api/tasks', undefined, { origin: null })).status).toBe(200);
  });

  it('sends the security headers on everything', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    // No TLS in the test, so no point promising a year of it.
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('asks for a passkey again before the spend cap moves', async () => {
    const stale = await pg.query<{ id: string }>(
      `UPDATE session SET created_at = now() - interval '2 hours' RETURNING id`,
    );
    expect(stale.rows).toHaveLength(1);

    const res = await api('POST', '/api/spend/cap', { capUsd: 500 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ reauth: true });

    // and the cap did not move
    expect((await api('GET', '/api/spend')).body.capUsd).toBe(5);
  });

  it('moves the cap for a session that just authenticated', async () => {
    const res = await api('POST', '/api/spend/cap', { capUsd: 12 });
    expect(res.status).toBe(200);
    expect((await api('GET', '/api/spend')).body.capUsd).toBe(12);
  });

  it('will not accept a nonsense cap', async () => {
    expect((await api('POST', '/api/spend/cap', { capUsd: -1 })).status).toBe(400);
    expect((await api('POST', '/api/spend/cap', { capUsd: 1e9 })).status).toBe(400);
  });
});

describe('the standup and the export', () => {
  it('reports the morning from the database, with no model involved', async () => {
    const res = await api('GET', '/api/standup');
    expect(res.status).toBe(200);
    expect(res.body.speech).toBeTruthy();
    expect(res.body.rows.map((r: [string, string]) => r[0])).toContain('Waiting on you');
  });

  it('asks for a passkey again before handing over the whole business', async () => {
    await pg.query(`UPDATE session SET created_at = now() - interval '2 hours'`);
    const res = await api('GET', '/api/export');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ reauth: true });
  });

  it('downloads as a file, with nothing secret in it', async () => {
    const res = await fetch(`${base}/api/export`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="foreman-/);
    const archive = (await res.json()) as { tables: Record<string, unknown>; omitted: string[] };
    expect(archive.tables).not.toHaveProperty('session');
    expect(archive.omitted).toContain('recovery_code');
  });
});

describe('the bounce webhook', () => {
  it('is closed when no secret is configured', async () => {
    // This app is built without one; a 404 rather than a 401 says the route
    // does not exist here at all.
    const res = await api('POST', '/api/webhooks/email', { type: 'email.bounced' }, {
      signedIn: false,
    });
    expect(res.status).toBe(404);
  });
});

describe('pause is reachable by conversation', () => {
  it('pauses through the concierge and stops the tick', async () => {
    await api('POST', '/api/tasks', {
      title: 'Post',
      spec: 'x',
      definition_of_done: 'y',
      owner_role: 'content',
    });
    const talk = await api('POST', '/api/talk', { text: 'stop' });
    expect(talk.body.speech).toMatch(/^Paused\./);
    expect((await api('POST', '/api/tick')).body).toEqual({ ran: false, why: 'paused' });

    const resumed = await api('POST', '/api/talk', { text: 'resume' });
    expect(resumed.body.speech).toBe('Running again.');
  });
});
