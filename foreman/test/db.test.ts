import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate, appliedMigrations, MigrationDrift, defaultMigrationsDir } from '../src/db/migrate.ts';
import {
  claimNextTask,
  startRun,
  finishRun,
  addSpend,
  spendToday,
  recordToolCall,
  PgAudit,
} from '../src/db/repo.ts';
import type { Sql } from '../src/db/sql.ts';

let pg: PGlite;
let sql: Sql;

beforeAll(async () => {
  pg = new PGlite();
  sql = pg as unknown as Sql;
  await migrate(sql, defaultMigrationsDir());
}, 120_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM tool_call; DELETE FROM run; DELETE FROM task;
    DELETE FROM audit; DELETE FROM spend_day; DELETE FROM role;
  `);
  await pg.query(`INSERT INTO role (id, name, model) VALUES ('content','content','claude-sonnet-5')`);
});

async function task(
  id: string,
  over: { status?: string; priority?: number; blocked_by?: string[] } = {},
) {
  await pg.query(
    `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status, priority, blocked_by)
     VALUES ($1, $1, 'spec', 'done when written', 'content', $2, $3, $4)`,
    [id, over.status ?? 'ready', over.priority ?? 100, over.blocked_by ?? []],
  );
}

describe('migrations', () => {
  it('applied the schema and recorded it', async () => {
    const applied = await appliedMigrations(sql);
    expect(applied.map((a) => a.name)).toContain('001_init.sql');
    expect(applied[0]!.checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is idempotent — a second run applies nothing', async () => {
    expect(await migrate(sql, defaultMigrationsDir())).toEqual([]);
  });

  it('refuses loudly when a committed migration has been edited', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    const db = new PGlite();
    const s = db as unknown as Sql;
    try {
      await writeFile(join(dir, '001_a.sql'), 'CREATE TABLE a (x INT);');
      expect(await migrate(s, dir)).toEqual(['001_a.sql']);

      await writeFile(join(dir, '001_a.sql'), 'CREATE TABLE a (x INT, y INT);');
      await expect(migrate(s, dir)).rejects.toThrow(MigrationDrift);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('leaves nothing behind when a migration fails halfway', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    const db = new PGlite();
    const s = db as unknown as Sql;
    try {
      await writeFile(join(dir, '001_ok.sql'), 'CREATE TABLE ok (x INT);');
      await writeFile(join(dir, '002_bad.sql'), 'CREATE TABLE good (x INT); CREATE TABLE ;');
      await expect(migrate(s, dir)).rejects.toThrow(/002_bad/);

      // the first migration stuck, the broken one left no partial table
      expect((await appliedMigrations(s)).map((a) => a.name)).toEqual(['001_ok.sql']);
      await expect(s.query('SELECT 1 FROM good')).rejects.toThrow();
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('claiming a task', () => {
  it('takes the highest priority ready task and marks it running', async () => {
    await task('t-low', { priority: 200 });
    await task('t-high', { priority: 10 });
    const claimed = await claimNextTask(sql);
    expect(claimed?.id).toBe('t-high');
    const { rows } = await pg.query<{ status: string }>(`SELECT status FROM task WHERE id='t-high'`);
    expect(rows[0]!.status).toBe('running');
  });

  it('never returns the same task twice', async () => {
    await task('t1');
    expect((await claimNextTask(sql))?.id).toBe('t1');
    expect(await claimNextTask(sql)).toBeNull();
  });

  it('ignores tasks that are not ready', async () => {
    await task('draft', { status: 'draft' });
    await task('blocked', { status: 'blocked' });
    expect(await claimNextTask(sql)).toBeNull();
  });

  it('will not claim a task whose dependency is unfinished', async () => {
    await task('dep', { status: 'ready' });
    await task('needs-dep', { blocked_by: ['dep'] });
    // 'dep' is claimable, 'needs-dep' is not
    expect((await claimNextTask(sql))?.id).toBe('dep');
    expect(await claimNextTask(sql)).toBeNull();
  });

  it('claims it once the dependency is done', async () => {
    await task('dep', { status: 'done' });
    await task('needs-dep', { blocked_by: ['dep'] });
    expect((await claimNextTask(sql))?.id).toBe('needs-dep');
  });

  it('can be filtered to one role', async () => {
    await pg.query(`INSERT INTO role (id, name, model) VALUES ('sales','sales','claude-sonnet-5')`);
    await task('for-content');
    await pg.query(
      `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
       VALUES ('for-sales','x','y','z','sales','ready')`,
    );
    expect((await claimNextTask(sql, { role: 'sales' }))?.id).toBe('for-sales');
  });
});

describe('runs', () => {
  it('records a run and closes it with usage split by cache', async () => {
    await task('t1');
    const runId = await startRun(sql, {
      taskId: 't1',
      roleId: 'content',
      model: 'claude-sonnet-5',
      effort: 'high',
    });
    await finishRun(sql, {
      runId,
      status: 'done',
      usage: { input: 300, cachedInput: 12_000, cacheWrite: 100, output: 700 },
      costUsd: 0.0123,
      summary: 'wrote the post',
    });
    const { rows } = await pg.query<Record<string, unknown>>(
      `SELECT status, input_tokens, cached_input_tokens, output_tokens, cost_usd, summary
         FROM run WHERE id = $1`,
      [runId],
    );
    expect(rows[0]).toMatchObject({
      status: 'done',
      input_tokens: 400, // fresh input plus cache writes, both billed at full rate
      cached_input_tokens: 12_000,
      output_tokens: 700,
      summary: 'wrote the post',
    });
    expect(Number(rows[0]!['cost_usd'])).toBeCloseTo(0.0123, 6);
  });

  it('stores a tool call with its classification and reason', async () => {
    await task('t1');
    const runId = await startRun(sql, {
      taskId: 't1',
      roleId: 'content',
      model: 'm',
      effort: 'high',
    });
    const callId = await recordToolCall(sql, {
      runId,
      seq: 1,
      tool: 'fs.write',
      args: { path: 'a.md' },
      effect: 'safe',
      reason: 'fs.write within workspace',
      ok: true,
      resultHash: 'abc123',
      ms: 4,
    });
    const { rows } = await pg.query<Record<string, unknown>>(
      `SELECT tool, effect_class, reason, ok FROM tool_call WHERE id = $1`,
      [callId],
    );
    expect(rows[0]).toMatchObject({ tool: 'fs.write', effect_class: 'safe', ok: true });
  });
});

describe('spend', () => {
  it('accumulates rather than overwriting', async () => {
    expect(await addSpend(sql, { usd: 1.5, inputTokens: 10, outputTokens: 5 })).toBeCloseTo(1.5, 6);
    expect(await addSpend(sql, { usd: 2.25, inputTokens: 10, outputTokens: 5 })).toBeCloseTo(3.75, 6);
    expect(await spendToday(sql)).toBeCloseTo(3.75, 6);
  });

  it('reports zero before anything has been spent', async () => {
    expect(await spendToday(sql)).toBe(0);
  });
});

describe('the audit table', () => {
  it('stores an entry the same shape the in-memory one does', async () => {
    const audit = new PgAudit(sql);
    await audit.record({
      actor: 'content',
      action: 'tool.attempt',
      subject: 'run_1',
      detail: { tool: 'fs.write' },
    });
    const { rows } = await pg.query<Record<string, unknown>>(
      `SELECT actor, action, subject, detail FROM audit`,
    );
    expect(rows[0]).toMatchObject({
      actor: 'content',
      action: 'tool.attempt',
      subject: 'run_1',
      detail: { tool: 'fs.write' },
    });
  });
});
