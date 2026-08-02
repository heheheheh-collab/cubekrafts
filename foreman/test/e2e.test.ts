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

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg, defaultMigrationsDir());
  home = await mkdtemp(join(tmpdir(), 'foreman-e2e-'));

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

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
  `);
  await pg.query(
    `INSERT INTO role (id, name, model, enabled) VALUES ('content','content','claude-sonnet-5', TRUE)`,
  );
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

  it('404s an unknown route with the method and path', async () => {
    const res = await api('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/GET \/api\/nope/);
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
