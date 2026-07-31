import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * The schema is tested against a real Postgres engine (PGlite, the same
 * codebase compiled to WASM) rather than eyeballed. The constraints below are
 * load-bearing — they restate rules that also live in application code, so if
 * one drifts the other still holds.
 */

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  const sql = readFileSync(new URL('../src/db/migrations/001_init.sql', import.meta.url), 'utf8');
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

async function seedRole(id = 'content') {
  await db.query(`INSERT INTO role (id, name, model) VALUES ($1, $1, 'claude-sonnet-5')`, [id]);
  return id;
}

describe('owner is a singleton', () => {
  it('accepts the first owner and rejects a second', async () => {
    await db.query(`INSERT INTO owner (id, email) VALUES ('o1', 'a@example.com')`);
    await expect(
      db.query(`INSERT INTO owner (id, email) VALUES ('o2', 'b@example.com')`),
    ).rejects.toThrow();
  });
});

describe('tool_grant never lets the outward-facing tools run unattended', () => {
  it('rejects promoting email.send above approve', async () => {
    const role = await seedRole('sales');
    await expect(
      db.query(`INSERT INTO tool_grant (role_id, tool, autonomy) VALUES ($1, 'email.send', 'auto')`, [
        role,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO tool_grant (role_id, tool, autonomy) VALUES ($1, 'email.send', 'notify')`,
        [role],
      ),
    ).rejects.toThrow();
  });

  it('rejects promoting git.push above approve', async () => {
    const role = await seedRole('developer');
    await expect(
      db.query(`INSERT INTO tool_grant (role_id, tool, autonomy) VALUES ($1, 'git.push', 'auto')`, [
        role,
      ]),
    ).rejects.toThrow();
  });

  it('allows those tools at approve, and ordinary tools anywhere', async () => {
    const role = await seedRole('marketing');
    await db.query(
      `INSERT INTO tool_grant (role_id, tool, autonomy) VALUES ($1, 'email.send', 'approve')`,
      [role],
    );
    await db.query(
      `INSERT INTO tool_grant (role_id, tool, autonomy) VALUES ($1, 'fs.read', 'auto')`,
      [role],
    );
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM tool_grant WHERE role_id = $1`, [
      role,
    ]);
    expect((rows[0] as { n: number }).n).toBe(2);
  });

  it('also blocks promotion via UPDATE, not just INSERT', async () => {
    const role = await seedRole('finance');
    await db.query(
      `INSERT INTO tool_grant (role_id, tool, autonomy) VALUES ($1, 'email.send', 'approve')`,
      [role],
    );
    await expect(
      db.query(`UPDATE tool_grant SET autonomy = 'auto' WHERE role_id = $1 AND tool = 'email.send'`, [
        role,
      ]),
    ).rejects.toThrow();
  });
});

describe('a task cannot become runnable without a definition of done', () => {
  it('rejects a ready task with a blank definition of done', async () => {
    const role = await seedRole('coo');
    await expect(
      db.query(
        `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
         VALUES ('t1', 'x', 'y', '   ', $1, 'ready')`,
        [role],
      ),
    ).rejects.toThrow();
  });

  it('allows a draft without one, and a ready task with one', async () => {
    await db.query(
      `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
       VALUES ('t2', 'x', 'y', '', 'coo', 'draft')`,
    );
    await db.query(
      `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
       VALUES ('t3', 'x', 'y', 'a post of 800 words', 'coo', 'ready')`,
    );
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM task`);
    expect((rows[0] as { n: number }).n).toBe(2);
  });
});

describe('an approval decision always records when it was made', () => {
  it('rejects a decided approval with no timestamp', async () => {
    await db.query(
      `INSERT INTO run (id, task_id, role_id, model, effort)
       VALUES ('r1', 't3', 'coo', 'claude-opus-5', 'high')`,
    );
    await db.query(
      `INSERT INTO tool_call (id, run_id, seq, tool, args, effect_class, reason)
       VALUES ('tc1', 'r1', 1, 'email.send', '{}', 'guarded', 'sending')`,
    );
    await expect(
      db.query(
        `INSERT INTO approval (id, run_id, tool_call_id, kind, preview, status)
         VALUES ('a1', 'r1', 'tc1', 'email', '{}', 'approved')`,
      ),
    ).rejects.toThrow();
  });

  it('accepts a pending approval, and its later decision', async () => {
    await db.query(
      `INSERT INTO approval (id, run_id, tool_call_id, kind, preview, status)
       VALUES ('a2', 'r1', 'tc1', 'email', '{}', 'pending')`,
    );
    await db.query(
      `UPDATE approval SET status = 'approved', decided_at = now() WHERE id = 'a2'`,
    );
    const { rows } = await db.query(`SELECT status FROM approval WHERE id = 'a2'`);
    expect((rows[0] as { status: string }).status).toBe('approved');
  });
});
