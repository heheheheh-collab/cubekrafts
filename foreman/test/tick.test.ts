import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import { setSetting, addSpend, claimNextTask } from '../src/db/repo.ts';
import { tick, nextTaskStatus, SETTINGS, type TickDeps } from '../src/scheduler/tick.ts';
import { DEFAULT_POLICY } from '../src/domain/types.ts';
import type { TurnResult } from '../src/claude/client.ts';

let pg: PGlite;
let sql: PGlite;
let workspace: string;

function scripted(turns: Partial<TurnResult>[]) {
  let i = 0;
  return {
    calls: () => i,
    turn: async () => {
      const next = turns[i++] ?? { finish: 'end' as const, text: 'ok' };
      return {
        finish: 'end',
        text: '',
        toolCalls: [],
        usage: { input: 100, cachedInput: 900, cacheWrite: 0, output: 50 },
        costUsd: 0.25,
        raw: [],
        ...next,
      } as TurnResult;
    },
  };
}

beforeAll(async () => {
  pg = new PGlite();
  sql = pg;
  await migrate(pg, defaultMigrationsDir());
  workspace = await mkdtemp(join(tmpdir(), 'foreman-tick-'));
}, 120_000);

afterAll(async () => {
  await pg.close();
  await rm(workspace, { recursive: true, force: true });
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM tool_call; DELETE FROM run; DELETE FROM task;
    DELETE FROM audit; DELETE FROM spend_day; DELETE FROM setting; DELETE FROM role;
  `);
  await pg.query(
    `INSERT INTO role (id, name, model) VALUES ('content','content','claude-sonnet-5')`,
  );
});

async function readyTask(id = 't1', role = 'content') {
  await pg.query(
    `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
     VALUES ($1, 'August post', 'write it', '800 words, brand voice', $2, 'ready')`,
    [id, role],
  );
}

function deps(over: Partial<TickDeps> = {}): TickDeps {
  return {
    sql,
    claude: scripted([{ finish: 'end', text: 'wrote the post' }]),
    policy: { ...DEFAULT_POLICY, allowedRoots: { content: [workspace] } },
    roles: {
      content: { name: 'content', tier: 'mid', effort: 'high', stableSystem: ['preamble', 'charter'] },
    },
    ...over,
  };
}

async function status(taskId: string): Promise<string> {
  const { rows } = await pg.query<{ status: string }>(`SELECT status FROM task WHERE id = $1`, [taskId]);
  return rows[0]!.status;
}

describe('the gates in front of the claim', () => {
  it('does nothing when paused, and does not touch the task', async () => {
    await readyTask();
    await setSetting(sql, SETTINGS.paused, true);
    expect(await tick(deps())).toEqual({ ran: false, why: 'paused' });
    expect(await status('t1')).toBe('ready');
  });

  it('stops before claiming once the daily cap is reached', async () => {
    await readyTask();
    await setSetting(sql, SETTINGS.dailyCapUsd, 1);
    await addSpend(sql, { usd: 1.2, inputTokens: 0, outputTokens: 0 });
    const r = await tick(deps());
    expect(r).toMatchObject({ ran: false, why: 'cap_reached' });
    // the task is still claimable rather than stuck in `running`
    expect(await status('t1')).toBe('ready');
  });

  it('reports no work when the queue is empty', async () => {
    expect(await tick(deps())).toEqual({ ran: false, why: 'no_work' });
  });

  it('blocks rather than stranding a task whose role has no configuration', async () => {
    await readyTask('t1');
    const r = await tick(deps({ roles: {} }));
    expect(r).toMatchObject({ ran: false, why: 'no_role_config' });
    // not left in `running` with nothing working on it
    expect(await status('t1')).toBe('blocked');
  });
});

describe('a run that finishes', () => {
  it('records the run, the spend, and moves the task to review', async () => {
    await readyTask();
    const r = await tick(deps());
    expect(r.ran).toBe(true);

    // a role never marks its own work done — the COO reviews it
    expect(await status('t1')).toBe('review');

    const { rows } = await pg.query<Record<string, unknown>>(
      `SELECT status, cached_input_tokens, output_tokens, cost_usd, summary FROM run`,
    );
    expect(rows[0]).toMatchObject({
      status: 'done',
      cached_input_tokens: 900,
      output_tokens: 50,
      summary: 'wrote the post',
    });

    const { rows: spend } = await pg.query<{ usd: string }>(`SELECT usd FROM spend_day`);
    expect(Number(spend[0]!.usd)).toBeCloseTo(0.25, 6);
  });

  it('writes the definition of done into the prompt the agent sees', async () => {
    await readyTask();
    let seen = '';
    const claude = {
      turn: async (t: { messages: Array<{ content: unknown }> }) => {
        seen = String(t.messages[0]!.content);
        return {
          finish: 'end' as const,
          text: 'ok',
          toolCalls: [],
          usage: { input: 1, cachedInput: 0, cacheWrite: 0, output: 1 },
          costUsd: 0,
          raw: [],
        };
      },
    };
    await tick(deps({ claude }));
    expect(seen).toContain('800 words, brand voice');
    expect(seen).toContain('ask_founder');
  });
});

describe('a run that stops for the founder', () => {
  it('parks the run and blocks the task when a question is asked', async () => {
    await readyTask();
    const claude = scripted([
      {
        finish: 'tool_calls',
        toolCalls: [{ id: 'tc1', name: 'ask_founder', args: { question: 'Which product line?' } }],
      },
    ]);
    const r = await tick(deps({ claude, sinks: { async askFounder() { return { id: 'q1' }; } } }));
    expect(r).toMatchObject({ ran: true, outcome: { kind: 'awaiting_founder' } });
    expect(await status('t1')).toBe('blocked');
    const { rows } = await pg.query<{ status: string }>(`SELECT status FROM run`);
    expect(rows[0]!.status).toBe('parked');
  });
});

describe('a run that crashes', () => {
  it('closes the run and frees the task instead of leaving it running', async () => {
    await readyTask();
    const claude = {
      turn: async () => {
        throw new Error('connection reset');
      },
    };
    await expect(tick(deps({ claude }))).rejects.toThrow('connection reset');

    expect(await status('t1')).toBe('blocked');
    const { rows } = await pg.query<{ status: string; error: string }>(
      `SELECT status, error FROM run`,
    );
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'connection reset' });
  });
});

describe('task status mapping', () => {
  it('never closes a task off the back of the agent saying it is done', () => {
    expect(nextTaskStatus({ kind: 'done', text: '' })).toBe('review');
  });

  it('returns an aborted task to the queue, since stopping is not rejecting', () => {
    expect(nextTaskStatus({ kind: 'aborted', reason: 'stopped' })).toBe('ready');
  });

  it('blocks anything waiting on a person or ended badly', () => {
    expect(nextTaskStatus({ kind: 'awaiting_founder', question: 'q' })).toBe('blocked');
    expect(nextTaskStatus({ kind: 'refused', reason: 'r' })).toBe('blocked');
    expect(nextTaskStatus({ kind: 'exhausted', reason: 'r' })).toBe('blocked');
  });
});

describe('dependencies', () => {
  it('will not run a task whose dependency no longer exists', async () => {
    // A dangling id must count as unsatisfied. An inner join would drop the
    // row and silently unblock the task.
    await pg.query(
      `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status, blocked_by)
       VALUES ('orphan','x','y','z','content','ready', ARRAY['deleted-task'])`,
    );
    expect(await claimNextTask(sql)).toBeNull();
    expect(await tick(deps())).toEqual({ ran: false, why: 'no_work' });
  });
});
