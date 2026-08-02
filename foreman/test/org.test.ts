import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import { makeSinks } from '../src/tools/sinks.ts';
import { classify } from '../src/tools/effects.ts';
import { DEFAULT_POLICY } from '../src/domain/types.ts';
import { toolsFor } from '../src/tools/registry.ts';
import { ask, situation } from '../src/concierge/ask.ts';
import { stableSystemFor, CONCIERGE_PREAMBLE } from '../src/agents/charters.ts';
import { EMPTY_SNAPSHOT } from '../src/concierge/snapshot.ts';
import type { TurnResult } from '../src/claude/client.ts';

/**
 * The work graph and the slow half of the conversation.
 *
 * Real Postgres throughout, because every one of these tools is a statement
 * whose correctness is the statement's, not the wrapper's. Claude is scripted:
 * what is under test is what happens around the model.
 */

let pg: PGlite;
let home: string;
let sinks: ReturnType<typeof makeSinks>;

const call = (name: string, args: Record<string, unknown>) => ({ id: 't1', name, args });
const policy = DEFAULT_POLICY;

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg, defaultMigrationsDir());
  home = await mkdtemp(join(tmpdir(), 'foreman-org-'));
  sinks = makeSinks(pg, home);
}, 120_000);

afterAll(async () => {
  await pg.close();
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM review; DELETE FROM approval; DELETE FROM message; DELETE FROM tool_call;
    DELETE FROM run; DELETE FROM question; DELETE FROM artifact; DELETE FROM task;
    DELETE FROM initiative; DELETE FROM goal; DELETE FROM audit; DELETE FROM spend_day;
    DELETE FROM setting; DELETE FROM role;
  `);
  await pg.exec(`
    INSERT INTO role (id, name, model, enabled) VALUES
      ('coo','coo','claude-opus-5', TRUE),
      ('content','content','claude-sonnet-5', TRUE);
  `);
});

// ── who holds what ──────────────────────────────────────────────────────────

describe('the concierge tool set', () => {
  it('can read and dispatch, and cannot reach outside the building', () => {
    const held = toolsFor('concierge').map((t) => t.name);
    expect(held).toContain('org.look_up');
    expect(held).toContain('org.dispatch');
    expect(held).toContain('org.control');
    for (const outward of ['email.send', 'git.push', 'artifact.publish', 'shell.run', 'fs.write']) {
      expect({ outward, held: held.includes(outward) }).toEqual({ outward, held: false });
    }
  });

  it('is refused those tools by the classifier too, not merely unlisted', () => {
    // Two independent defences: the registry does not offer it, and the
    // classifier would refuse it if something offered it anyway.
    for (const outward of ['email.send', 'git.push', 'artifact.publish']) {
      const verdict = classify('concierge', call(outward, { draft_id: 'd', title: 'x', body: 'y' }), policy);
      expect({ outward, effect: verdict.effect }).toEqual({ outward, effect: 'forbidden' });
    }
  });

  it('cannot review its own dispatches — that is the COO’s job', () => {
    expect(classify('concierge', call('org.review', { task_id: 't', verdict: 'accept', notes: 'x' }), policy).effect).toBe(
      'forbidden',
    );
  });

  it('gets its own preamble and no worker charter', () => {
    const blocks = stableSystemFor('concierge');
    expect(blocks[0]).toBe(CONCIERGE_PREAMBLE);
    expect(blocks.join('\n')).not.toContain('You are one role inside a small company');
  });

  it('gives the COO a charter that is specific about definitions of done', () => {
    expect(stableSystemFor('coo').join('\n')).toMatch(/definition of done is a test/);
  });
});

describe('classifying the work graph', () => {
  it('accepts the views it knows and refuses the ones it does not', () => {
    expect(classify('concierge', call('org.look_up', { view: 'tasks' }), policy).effect).toBe('safe');
    expect(classify('concierge', call('org.look_up', { view: 'passwords' }), policy).effect).toBe(
      'forbidden',
    );
    expect(classify('concierge', call('org.look_up', {}), policy).effect).toBe('forbidden');
  });

  it('will not dispatch to somebody who does not exist', () => {
    const base = { title: 't', spec: 's', definition_of_done: 'd' };
    expect(classify('coo', call('org.dispatch', { ...base, owner_role: 'content' }), policy).effect).toBe('safe');
    expect(classify('coo', call('org.dispatch', { ...base, owner_role: 'legal' }), policy).effect).toBe('forbidden');
  });

  it('will not dispatch to the COO or the concierge, which have no queue', () => {
    const base = { title: 't', spec: 's', definition_of_done: 'd' };
    expect(classify('coo', call('org.dispatch', { ...base, owner_role: 'coo' }), policy).effect).toBe('forbidden');
    expect(classify('coo', call('org.dispatch', { ...base, owner_role: 'concierge' }), policy).effect).toBe('forbidden');
  });

  it('refuses a task with no definition of done before the database has to', () => {
    expect(
      classify('coo', call('org.dispatch', { title: 't', spec: 's', owner_role: 'content' }), policy)
        .effect,
    ).toBe('forbidden');
  });

  it('refuses a review verdict it does not recognise', () => {
    const ok = classify('coo', call('org.review', { task_id: 't', verdict: 'revise', notes: 'n' }), policy);
    expect(ok.effect).toBe('safe');
    expect(
      classify('coo', call('org.review', { task_id: 't', verdict: 'approve', notes: 'n' }), policy).effect,
    ).toBe('forbidden');
  });

  it('insists org.control is told true or false, not a string', () => {
    expect(classify('concierge', call('org.control', { paused: true }), policy).effect).toBe('safe');
    expect(classify('concierge', call('org.control', { paused: 'yes' }), policy).effect).toBe('forbidden');
  });
});

// ── the sinks ───────────────────────────────────────────────────────────────

async function makeTask(status = 'review'): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
          VALUES ('task_1','Post','Write it','600 words','content',$1) RETURNING id`,
    [status],
  );
  return rows[0]!.id;
}

describe('dispatch', () => {
  it('creates a task that is immediately claimable', async () => {
    const { id } = await sinks.dispatch({
      title: 'August post',
      spec: 'Write it',
      definition_of_done: '600 words',
      owner_role: 'content',
    });
    const { rows } = await pg.query<{ status: string; priority: number }>(
      `SELECT status, priority FROM task WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({ status: 'ready', priority: 100 });
  });

  it('honours a priority so urgent work runs first', async () => {
    await sinks.dispatch({
      title: 'Urgent',
      spec: 's',
      definition_of_done: 'd',
      owner_role: 'content',
      priority: 1,
    });
    const { rows } = await pg.query<{ title: string }>(
      `SELECT title FROM task WHERE status = 'ready' ORDER BY priority LIMIT 1`,
    );
    expect(rows[0]!.title).toBe('Urgent');
  });
});

describe('review', () => {
  it('closes an accepted task and stamps when', async () => {
    const taskId = await makeTask();
    expect(await sinks.review({ task_id: taskId, verdict: 'accept', notes: 'Good.' })).toEqual({
      status: 'done',
    });
    const { rows } = await pg.query<{ status: string; closed_at: Date | null }>(
      `SELECT status, closed_at FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]!.status).toBe('done');
    expect(rows[0]!.closed_at).not.toBeNull();
  });

  it('puts the reason where the next run will read it', async () => {
    // A rejection filed somewhere the agent never looks changes nothing about
    // what it writes next time.
    const taskId = await makeTask();
    await sinks.review({ task_id: taskId, verdict: 'revise', notes: 'Cut the opening claim.' });
    const { rows } = await pg.query<{ spec: string; status: string; revision_count: number }>(
      `SELECT spec, status, revision_count FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]!.status).toBe('revise');
    expect(rows[0]!.spec).toContain('Cut the opening claim.');
    expect(rows[0]!.revision_count).toBe(1);
  });

  it('records the verdict against the artifact as well', async () => {
    const taskId = await makeTask();
    await pg.query(
      `INSERT INTO artifact (id, task_id, kind, title, storage_key) VALUES ('art_1',$1,'post','P','k')`,
      [taskId],
    );
    await sinks.review({ task_id: taskId, verdict: 'accept', notes: 'Ship it.' });
    const { rows } = await pg.query<{ verdict: string }>(`SELECT verdict FROM review`);
    expect(rows[0]!.verdict).toBe('accept');
    const { rows: art } = await pg.query<{ status: string }>(`SELECT status FROM artifact`);
    expect(art[0]!.status).toBe('accepted');
  });

  it('refuses to review something that is not waiting on one', async () => {
    const taskId = await makeTask('done');
    await expect(sinks.review({ task_id: taskId, verdict: 'accept', notes: 'x' })).rejects.toThrow(
      /not waiting on a review/,
    );
  });

  it('blocks rather than closes when the problem is the task itself', async () => {
    const taskId = await makeTask();
    expect(await sinks.review({ task_id: taskId, verdict: 'escalate', notes: 'Needs a price.' })).toEqual(
      { status: 'blocked' },
    );
  });
});

describe('answering a parked question', () => {
  it('unblocks the task and puts the answer in its spec', async () => {
    const taskId = await makeTask('blocked');
    await pg.query(
      `INSERT INTO question (id, task_id, role_id, text) VALUES ('q_1',$1,'content','What is the price?')`,
      [taskId],
    );
    expect(await sinks.answer({ question_id: 'q_1', answer: '£12,000 delivered.' })).toEqual({
      taskId,
    });

    const { rows } = await pg.query<{ status: string; spec: string }>(
      `SELECT status, spec FROM task WHERE id = $1`,
      [taskId],
    );
    expect(rows[0]!.status).toBe('ready');
    expect(rows[0]!.spec).toContain('£12,000 delivered.');
  });

  it('cannot be answered twice', async () => {
    const taskId = await makeTask('blocked');
    await pg.query(
      `INSERT INTO question (id, task_id, role_id, text) VALUES ('q_1',$1,'content','?')`,
      [taskId],
    );
    await sinks.answer({ question_id: 'q_1', answer: 'first' });
    expect(await sinks.answer({ question_id: 'q_1', answer: 'second' })).toEqual({ taskId: null });
    const { rows } = await pg.query<{ answer: string }>(`SELECT answer FROM question`);
    expect(rows[0]!.answer).toBe('first');
  });
});

describe('look_up', () => {
  it('carries ids, so the next tool call can refer to what it saw', async () => {
    const { id } = await sinks.dispatch({
      title: 'August post',
      spec: 's',
      definition_of_done: 'd',
      owner_role: 'content',
    });
    const text = await sinks.lookUp({ view: 'tasks' });
    expect(text).toContain(id);
    expect(text).toContain('August post');
  });

  it('says so plainly when there is nothing, rather than returning blank', async () => {
    for (const view of ['tasks', 'runs', 'approvals', 'questions', 'goals', 'artifacts', 'activity']) {
      const text = await sinks.lookUp({ view });
      expect({ view, empty: text.trim().length === 0 }).toEqual({ view, empty: false });
    }
  });

  it('hides finished work from the task list', async () => {
    const taskId = await makeTask('done');
    expect(await sinks.lookUp({ view: 'tasks' })).not.toContain(taskId);
  });

  it('filters by title when asked', async () => {
    await sinks.dispatch({ title: 'August post', spec: 's', definition_of_done: 'd', owner_role: 'content' });
    await sinks.dispatch({ title: 'Pricing page', spec: 's', definition_of_done: 'd', owner_role: 'content' });
    const text = await sinks.lookUp({ view: 'tasks', query: 'pricing' });
    expect(text).toContain('Pricing page');
    expect(text).not.toContain('August post');
  });

  it('reports spend against the cap', async () => {
    expect(await sinks.lookUp({ view: 'spend' })).toBe('$0.00 spent today, cap $5.00.');
  });
});

describe('control', () => {
  it('stops and restarts work', async () => {
    await sinks.control({ paused: true });
    const { rows } = await pg.query<{ value: boolean }>(
      `SELECT value FROM setting WHERE key = 'paused'`,
    );
    expect(rows[0]!.value).toBe(true);
    await sinks.control({ paused: false });
    const { rows: after } = await pg.query<{ value: boolean }>(
      `SELECT value FROM setting WHERE key = 'paused'`,
    );
    expect(after[0]!.value).toBe(false);
  });
});

// ── the slow half of the conversation ───────────────────────────────────────

function scripted(turns: Partial<TurnResult>[]) {
  const queue = [...turns];
  return {
    turn: async () =>
      ({
        finish: 'end',
        text: '',
        toolCalls: [],
        usage: { input: 200, cachedInput: 1800, cacheWrite: 0, output: 40 },
        costUsd: 0.0004,
        raw: [],
        ...(queue.shift() ?? { finish: 'end', text: 'nothing else' }),
      }) as TurnResult,
  };
}

const askDeps = (turns: Partial<TurnResult>[]) => ({
  sql: pg,
  claude: scripted(turns),
  policy,
  sinks,
});

describe('the concierge asking the model', () => {
  it('answers, and says what it actually did', async () => {
    const result = await ask(
      'how are we doing',
      EMPTY_SNAPSHOT,
      askDeps([
        { finish: 'tool_calls', toolCalls: [{ id: 'c1', name: 'org.look_up', args: { view: 'tasks' } }] },
        { finish: 'end', text: 'Two tasks open, nothing blocked.' },
      ]),
    );
    expect(result.speech).toBe('Two tasks open, nothing blocked.');
    expect(result.did).toEqual(['looked up tasks']);
  });

  it('dispatches work when told to, and the task is really there', async () => {
    const result = await ask(
      'get the August post written',
      EMPTY_SNAPSHOT,
      askDeps([
        {
          finish: 'tool_calls',
          toolCalls: [
            {
              id: 'c1',
              name: 'org.dispatch',
              args: {
                title: 'August post',
                spec: 'Write the August post.',
                definition_of_done: '600 words, ends with a call to action.',
                owner_role: 'content',
              },
            },
          ],
        },
        { finish: 'end', text: 'Content has it.' },
      ]),
    );
    expect(result.did).toEqual(['gave content a task: August post']);
    const { rows } = await pg.query<{ status: string }>(`SELECT status FROM task WHERE title = 'August post'`);
    expect(rows[0]!.status).toBe('ready');
  });

  it('is refused when it reaches for something outside the building', async () => {
    const result = await ask(
      'send that email',
      EMPTY_SNAPSHOT,
      askDeps([
        {
          finish: 'tool_calls',
          toolCalls: [{ id: 'c1', name: 'email.send', args: { draft_id: 'd1' } }],
        },
      ]),
    );
    expect(result.speech).toMatch(/not allowed/);
    expect(result.speech).toMatch(/not granted to concierge/);
  });

  it('bills what it spent against the day', async () => {
    await ask('hello', EMPTY_SNAPSHOT, askDeps([{ finish: 'end', text: 'Morning.' }]));
    const { rows } = await pg.query<{ usd: string }>(`SELECT usd FROM spend_day WHERE date = current_date`);
    expect(Number(rows[0]!.usd)).toBeCloseTo(0.0004, 6);
  });

  it('admits going round in circles rather than returning nothing', async () => {
    const looping = Array.from({ length: 10 }, () => ({
      finish: 'tool_calls' as const,
      toolCalls: [{ id: 'c', name: 'org.look_up', args: { view: 'tasks' } }],
    }));
    const result = await ask('what is going on', EMPTY_SNAPSHOT, {
      ...askDeps(looping),
      maxSteps: 3,
    });
    expect(result.speech).toMatch(/round in circles/);
  });

  it('logs the conversation to the audit trail like any other run', async () => {
    await ask('hello', EMPTY_SNAPSHOT, askDeps([{ finish: 'end', text: 'Morning.' }]));
    const { rows } = await pg.query<{ actor: string; action: string }>(
      `SELECT actor, action FROM audit ORDER BY at`,
    );
    expect(rows.map((r) => r.action)).toContain('run.start');
    expect(rows[0]!.actor).toBe('concierge');
  });
});

describe('the situation block', () => {
  it('states the clock, the counts, and whether work is stopped', () => {
    const text = situation(
      {
        ...EMPTY_SNAPSHOT,
        approvals: [{ id: 'ap_1', kind: 'email.send', summary: 'reply to Sharma', role: 'sales', waitingMinutes: 40 }],
        paused: true,
        spendTodayUsd: 1.5,
        spendCapUsd: 5,
      },
      new Date('2026-08-02T09:00:00Z'),
    );
    expect(text).toContain('2026-08-02T09:00:00.000Z');
    expect(text).toContain('ap_1 email.send (sales) — reply to Sharma');
    expect(text).toContain('$1.50 of $5.00');
    expect(text).toContain('PAUSED');
  });

  it('tells the model to look things up rather than trust the snapshot blindly', () => {
    expect(situation(EMPTY_SNAPSHOT)).toMatch(/look it up rather than guessing/);
  });

  it('does not run away with a hundred approvals in the prompt', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `ap_${i}`,
      kind: 'email.send',
      summary: 'x',
      role: 'sales',
      waitingMinutes: 1,
    }));
    const text = situation({ ...EMPTY_SNAPSHOT, approvals: many });
    expect(text).toContain('approvals waiting on the founder: 50');
    expect(text).toContain('ap_7');
    expect(text).not.toContain('ap_9');
  });
});
