import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import { makeSinks } from '../src/tools/sinks.ts';
import { stableSystemFor } from '../src/agents/charters.ts';
import { DEFAULT_POLICY } from '../src/domain/types.ts';
import { tick, type TickDeps } from '../src/scheduler/tick.ts';
import {
  isIdle,
  supervise,
  supervisionPrompt,
  whatNeedsSupervision,
} from '../src/scheduler/supervise.ts';
import type { TurnResult } from '../src/claude/client.ts';

/**
 * The COO's supervision pass.
 *
 * The load-bearing claim is that it runs when there is something to supervise
 * and does not run when there is not — a COO waking every ten minutes to find
 * nothing to do would eat the daily cap by lunchtime.
 */

let pg: PGlite;
let home: string;

function scripted(turns: Partial<TurnResult>[]) {
  let calls = 0;
  return {
    calls: () => calls,
    turn: async () => {
      const next = turns[calls++] ?? { finish: 'end' as const, text: 'nothing further' };
      return {
        finish: 'end',
        text: '',
        toolCalls: [],
        usage: { input: 400, cachedInput: 6000, cacheWrite: 0, output: 200 },
        costUsd: 0.02,
        raw: [],
        ...next,
      } as TurnResult;
    },
  };
}

function deps(claude: { turn: () => Promise<TurnResult> }): TickDeps {
  return {
    sql: pg,
    claude,
    policy: { ...DEFAULT_POLICY, allowedRoots: { coo: [home], content: [home] } },
    sinks: makeSinks(pg, home),
    roles: {
      coo: { name: 'coo', tier: 'top', effort: 'high', stableSystem: stableSystemFor('coo') },
      content: {
        name: 'content',
        tier: 'mid',
        effort: 'high',
        stableSystem: stableSystemFor('content'),
      },
    },
  };
}

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg, defaultMigrationsDir());
  home = await mkdtemp(join(tmpdir(), 'foreman-sup-'));
}, 120_000);

afterAll(async () => {
  await pg.close();
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM review; DELETE FROM message; DELETE FROM tool_call; DELETE FROM run;
    DELETE FROM question; DELETE FROM artifact; DELETE FROM task; DELETE FROM initiative;
    DELETE FROM goal; DELETE FROM audit; DELETE FROM spend_day; DELETE FROM setting;
    DELETE FROM role;
  `);
  await pg.exec(`
    INSERT INTO role (id, name, model) VALUES
      ('coo','coo','claude-opus-5'), ('content','content','claude-sonnet-5');
  `);
});

async function task(id: string, status: string): Promise<void> {
  await pg.query(
    `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
          VALUES ($1, 'A post', 'write it', '600 words', 'content', $2)`,
    [id, status],
  );
}

// ── knowing when there is something to do ───────────────────────────────────

describe('what needs supervision', () => {
  it('is nothing on an empty company', async () => {
    const need = await whatNeedsSupervision(pg);
    expect(need).toEqual({ inReview: 0, unplannedGoals: 0, blocked: 0 });
    expect(isIdle(need)).toBe(true);
  });

  it('counts finished work waiting on a verdict', async () => {
    await task('t1', 'review');
    await task('t2', 'ready');
    expect(await whatNeedsSupervision(pg)).toMatchObject({ inReview: 1 });
  });

  it('counts blocked work nobody has looked at', async () => {
    await task('t1', 'blocked');
    expect(await whatNeedsSupervision(pg)).toMatchObject({ blocked: 1 });
  });

  it('counts a goal with no work under it', async () => {
    await pg.query(`INSERT INTO goal (id, title) VALUES ('g1','Ship the August post')`);
    expect(await whatNeedsSupervision(pg)).toMatchObject({ unplannedGoals: 1 });
  });

  it('stops counting a goal once it has work', async () => {
    await pg.exec(`
      INSERT INTO goal (id, title) VALUES ('g1','Ship it');
      INSERT INTO initiative (id, goal_id, title, owner_role) VALUES ('i1','g1','Write','content');
      INSERT INTO task (id, initiative_id, title, spec, definition_of_done, owner_role, status)
           VALUES ('t1','i1','Post','s','d','content','ready');
    `);
    expect(await whatNeedsSupervision(pg)).toMatchObject({ unplannedGoals: 0 });
  });

  it('ignores a goal that has been met or abandoned', async () => {
    await pg.query(`INSERT INTO goal (id, title, status) VALUES ('g1','Old','met')`);
    expect(await whatNeedsSupervision(pg)).toMatchObject({ unplannedGoals: 0 });
  });
});

describe('the supervision prompt', () => {
  it('names only the jobs that actually exist', () => {
    const text = supervisionPrompt({ inReview: 2, unplannedGoals: 0, blocked: 0 });
    expect(text).toContain('2 task(s) are finished');
    expect(text).not.toContain('goal(s) have no work');
    expect(text).not.toContain('are blocked');
  });

  it('tells the COO the numbers are counts, not the work', () => {
    // Otherwise it answers from the prompt and reviews nothing.
    expect(supervisionPrompt({ inReview: 1, unplannedGoals: 1, blocked: 1 })).toMatch(
      /counts, not the work itself/,
    );
  });

  it('tells it to stop rather than invent work', () => {
    expect(supervisionPrompt({ inReview: 1, unplannedGoals: 0, blocked: 0 })).toMatch(
      /Do not invent work/,
    );
  });
});

// ── running it ──────────────────────────────────────────────────────────────

describe('supervising', () => {
  it('does nothing at all when there is nothing to supervise', async () => {
    const claude = scripted([]);
    expect(await supervise(deps(claude))).toBeNull();
    expect(claude.calls()).toBe(0);
  });

  it('does nothing when there is no COO configured', async () => {
    await task('t1', 'review');
    const withoutCoo = { ...deps(scripted([])), roles: {} };
    expect(await supervise(withoutCoo)).toBeNull();
  });

  it('reviews what is waiting, and the task really moves', async () => {
    await task('t1', 'review');
    const claude = scripted([
      {
        finish: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'org.look_up', args: { view: 'tasks' } }],
      },
      {
        finish: 'tool_calls',
        toolCalls: [
          {
            id: 'c2',
            name: 'org.review',
            args: { task_id: 't1', verdict: 'accept', notes: 'Meets the definition of done.' },
          },
        ],
      },
      { finish: 'end', text: 'Accepted one post.' },
    ]);

    const result = await supervise(deps(claude));
    expect(result?.outcome.kind).toBe('done');
    const { rows } = await pg.query<{ status: string }>(`SELECT status FROM task WHERE id = 't1'`);
    expect(rows[0]!.status).toBe('done');
  });

  it('records a run with no task, so the pass is visible like any other', async () => {
    await task('t1', 'review');
    const result = await supervise(deps(scripted([{ finish: 'end', text: 'Nothing to change.' }])));
    const { rows } = await pg.query<{ task_id: string | null; role_id: string; status: string }>(
      `SELECT task_id, role_id, status FROM run WHERE id = $1`,
      [result!.runId],
    );
    expect(rows[0]).toMatchObject({ task_id: null, role_id: 'coo', status: 'done' });
  });

  it('bills the pass against the day', async () => {
    await task('t1', 'review');
    await supervise(deps(scripted([{ finish: 'end', text: 'Done.' }])));
    const { rows } = await pg.query<{ usd: string }>(
      `SELECT usd FROM spend_day WHERE date = current_date`,
    );
    expect(Number(rows[0]!.usd)).toBeCloseTo(0.02, 6);
  });

  it('closes the run even when the loop throws', async () => {
    await task('t1', 'review');
    const exploding = {
      turn: async () => {
        throw new Error('the model fell over');
      },
    };
    await expect(supervise(deps(exploding))).rejects.toThrow('the model fell over');

    const { rows } = await pg.query<{ status: string; error: string }>(
      `SELECT status, error FROM run`,
    );
    expect(rows[0]).toMatchObject({ status: 'failed' });
    expect(rows[0]!.error).toContain('fell over');
  });

  it('keeps the transcript, so a charter change can be replayed against it', async () => {
    await task('t1', 'review');
    const result = await supervise(deps(scripted([{ finish: 'end', text: 'Fine.' }])));
    const { rows } = await pg.query(`SELECT seq FROM message WHERE run_id = $1`, [result!.runId]);
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ── how the tick uses it ────────────────────────────────────────────────────

describe('the tick and the COO', () => {
  it('runs a queued task rather than supervising when there is one', async () => {
    await task('t1', 'ready');
    await task('t2', 'review');
    const result = await tick(deps(scripted([{ finish: 'end', text: 'Written.' }])));
    expect(result).toMatchObject({ ran: true, kind: 'task', taskId: 't1' });
  });

  it('supervises when the queue is empty but something needs a verdict', async () => {
    await task('t1', 'review');
    const result = await tick(deps(scripted([{ finish: 'end', text: 'Reviewed.' }])));
    expect(result).toMatchObject({ ran: true, kind: 'supervision', taskId: null });
  });

  it('reports no work, and spends nothing, when the company is genuinely idle', async () => {
    const claude = scripted([]);
    expect(await tick(deps(claude))).toEqual({ ran: false, why: 'no_work' });
    expect(claude.calls()).toBe(0);
  });

  it('still refuses to supervise while paused', async () => {
    await task('t1', 'review');
    await pg.query(`INSERT INTO setting (key, value) VALUES ('paused','true')`);
    const claude = scripted([]);
    expect(await tick(deps(claude))).toEqual({ ran: false, why: 'paused' });
    expect(claude.calls()).toBe(0);
  });

  it('still refuses to supervise once the cap is reached', async () => {
    await task('t1', 'review');
    await pg.query(
      `INSERT INTO spend_day (date, usd) VALUES (current_date, 99) ON CONFLICT (date) DO UPDATE SET usd = 99`,
    );
    const claude = scripted([]);
    expect(await tick(deps(claude))).toMatchObject({ ran: false, why: 'cap_reached' });
    expect(claude.calls()).toBe(0);
  });
});
