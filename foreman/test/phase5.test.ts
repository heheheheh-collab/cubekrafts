import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import { setSetting, getSetting } from '../src/db/repo.ts';
import { buildStandup, narrate, standupIfDue, SETTINGS_LAST_STANDUP } from '../src/scheduler/standup.ts';
import { buildArchive } from '../src/server/export.ts';
import {
  MAX_NOTES,
  charterWithLessons,
  lessonsFor,
  recordLesson,
  stableSystemWithLessons,
} from '../src/agents/learned.ts';
import { upsertLead, draft } from '../src/email/messages.ts';
import { sendApproved } from '../src/email/send.ts';
import { RecordingTransport } from '../src/email/transport.ts';

/**
 * The standup, the export, and the learned notes.
 *
 * All three are about what happens over time rather than in one request: the
 * morning after, the day you leave, and the week after you rejected something.
 */

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg, defaultMigrationsDir());
}, 120_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM email_event; DELETE FROM email_message; DELETE FROM email_suppression;
    DELETE FROM lead; DELETE FROM review; DELETE FROM approval; DELETE FROM message;
    DELETE FROM tool_call; DELETE FROM run; DELETE FROM question; DELETE FROM artifact;
    DELETE FROM task; DELETE FROM initiative; DELETE FROM goal; DELETE FROM audit;
    DELETE FROM spend_day; DELETE FROM setting; DELETE FROM charter; DELETE FROM tool_grant;
    DELETE FROM role;
  `);
  await pg.exec(`
    INSERT INTO role (id, name, model) VALUES
      ('coo','coo','claude-opus-5'), ('content','content','claude-sonnet-5'),
      ('sales','sales','claude-sonnet-5');
  `);
});

// ── the standup ─────────────────────────────────────────────────────────────

const empty = {
  finished: 0,
  started: 0,
  inReview: 0,
  blocked: 0,
  waiting: 0,
  questions: 0,
  emailsSent: 0,
  spentUsd: 0,
  oldestWaitHours: null,
};

describe('what the standup says', () => {
  it('leads with what needs you, not with what happened', () => {
    const text = narrate({ ...empty, waiting: 2, finished: 3 }, 5);
    expect(text.indexOf('waiting on you')).toBeLessThan(text.indexOf('finished'));
  });

  it('says plainly when nothing moved', () => {
    expect(narrate(empty, 5)).toBe('Nothing moved overnight.');
  });

  it('mentions how long the oldest thing has waited, once it is embarrassing', () => {
    expect(narrate({ ...empty, waiting: 1, oldestWaitHours: 2 }, 5)).not.toMatch(/hours/);
    expect(narrate({ ...empty, waiting: 1, oldestWaitHours: 30 }, 5)).toMatch(/30 hours/);
  });

  it('gets its plurals right, because a report that reads wrong is not read', () => {
    expect(narrate({ ...empty, waiting: 1 }, 5)).toContain('1 thing waiting');
    expect(narrate({ ...empty, waiting: 2 }, 5)).toContain('2 things waiting');
    expect(narrate({ ...empty, finished: 1, started: 1 }, 5)).toContain('1 task finished');
  });

  it('stays quiet about money until it is worth mentioning', () => {
    // A daily "you spent forty cents" trains you to skip the whole thing.
    expect(narrate({ ...empty, finished: 1, started: 1, spentUsd: 0.4 }, 5)).not.toContain('$');
    expect(narrate({ ...empty, finished: 1, started: 1, spentUsd: 4 }, 5)).toContain(
      '$4.00 of the $5.00 cap',
    );
  });
});

describe('building the standup', () => {
  it('counts from the database rather than asking a model', async () => {
    await pg.exec(`
      INSERT INTO task (id, title, spec, definition_of_done, owner_role, status, closed_at)
           VALUES ('t1','Done','s','d','content','done', now());
      INSERT INTO task (id, title, spec, definition_of_done, owner_role, status)
           VALUES ('t2','Waiting','s','d','content','review'),
                  ('t3','Stuck','s','d','content','blocked');
      INSERT INTO question (id, task_id, role_id, text) VALUES ('q1','t3','content','Price?');
    `);
    const standup = await buildStandup(pg);
    expect(standup.rows).toContainEqual(['Finished', '1']);
    expect(standup.rows).toContainEqual(['In review', '1']);
    expect(standup.rows).toContainEqual(['Blocked', '1']);
    expect(standup.needsYou).toBe(1);
  });

  it('counts email that actually went out', async () => {
    const leadId = await upsertLead(pg, { email: 'ravi@example.com' });
    const message = await draft(pg, { leadId, toAddress: '', subject: 's', body: 'b' });
    await sendApproved({ sql: pg, transport: new RecordingTransport() }, message.id);
    expect((await buildStandup(pg)).rows).toContainEqual(['Emails sent', '1']);
  });

  it('is written once a morning, whatever happens to the process', async () => {
    // A restart, a redeploy, or a second tick must not produce two.
    const first = await standupIfDue(pg);
    expect(first).not.toBeNull();
    expect(await standupIfDue(pg)).toBeNull();
    expect(await getSetting<string | null>(pg, SETTINGS_LAST_STANDUP, null)).toBe(
      new Date().toISOString().slice(0, 10),
    );
  });

  it('writes itself into the audit log, so an old one is still readable', async () => {
    await standupIfDue(pg);
    const { rows } = await pg.query<{ action: string; subject: string }>(
      `SELECT action, subject FROM audit WHERE action = 'standup'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toBe(new Date().toISOString().slice(0, 10));
  });

  it('comes back the next day', async () => {
    await standupIfDue(pg);
    const tomorrow = new Date(Date.now() + 25 * 3600 * 1000);
    expect(await standupIfDue(pg, tomorrow)).not.toBeNull();
  });
});

// ── the export ──────────────────────────────────────────────────────────────

describe('the export archive', () => {
  it('contains the work, so you could rebuild the company from it', async () => {
    await pg.exec(`
      INSERT INTO goal (id, title) VALUES ('g1','Ship it');
      INSERT INTO task (id, title, spec, definition_of_done, owner_role)
           VALUES ('t1','Post','s','d','content');
    `);
    const archive = await buildArchive(pg);
    expect(archive.counts['goal']).toBe(1);
    expect(archive.counts['task']).toBe(1);
    expect(archive.tables['goal']).toHaveLength(1);
  });

  it('contains the prompts, which are the part that is hard to reconstruct', async () => {
    const archive = await buildArchive(pg);
    expect(archive.charters['content']).toContain('# Content');
    expect(archive.charters['coo']).toContain('# COO');
    expect(archive.charters['_canon']).toContain('Cubekrafts');
  });

  it('never contains a credential, a session, or a recovery code', async () => {
    // The file gets emailed around. Anything in it should be worthless to
    // whoever ends up holding it.
    const archive = await buildArchive(pg);
    for (const secret of ['session', 'credential', 'recovery_code', 'auth_challenge']) {
      expect({ secret, present: secret in archive.tables }).toEqual({ secret, present: false });
      expect(archive.omitted).toContain(secret);
    }
  });

  it('survives being turned into the file that is actually downloaded', async () => {
    const archive = await buildArchive(pg);
    const round = JSON.parse(JSON.stringify(archive)) as typeof archive;
    expect(round.exportedAt).toBe(archive.exportedAt);
  });
});

// ── learned notes ───────────────────────────────────────────────────────────

describe('what a role has been told', () => {
  it('keeps a reason worth keeping', async () => {
    expect(
      await recordLesson(pg, {
        role: 'content',
        reason: 'Never claim a delivery time we have not quoted.',
        about: 'artifact.publish',
      }),
    ).toBe(true);
    expect(await lessonsFor(pg, 'content')).toEqual([
      'Never claim a delivery time we have not quoted.',
    ]);
  });

  it('ignores a grunt, which teaches nothing', async () => {
    expect(await recordLesson(pg, { role: 'content', reason: 'no', about: 'x' })).toBe(false);
    expect(await lessonsFor(pg, 'content')).toEqual([]);
  });

  it('keeps roles apart', async () => {
    await recordLesson(pg, { role: 'content', reason: 'Content-specific lesson here.', about: 'x' });
    await recordLesson(pg, { role: 'sales', reason: 'Sales-specific lesson here.', about: 'y' });
    expect(await lessonsFor(pg, 'sales')).toEqual(['Sales-specific lesson here.']);
  });

  it('drops the oldest once there are too many to read', async () => {
    // These sit in the cached prefix, so every note costs a cache miss on the
    // day it lands. A hundred of them would be a prompt nobody reads either.
    for (let i = 0; i < MAX_NOTES + 5; i++) {
      await recordLesson(pg, { role: 'content', reason: `Lesson number ${i} goes here.`, about: 'x' });
    }
    const lessons = await lessonsFor(pg, 'content');
    expect(lessons).toHaveLength(MAX_NOTES);
    expect(lessons.at(-1)).toContain(`number ${MAX_NOTES + 4}`);
  });

  it('reads oldest first, so the charter is a history rather than a stack', async () => {
    await recordLesson(pg, { role: 'content', reason: 'The first thing learned.', about: 'x' });
    await recordLesson(pg, { role: 'content', reason: 'The second thing learned.', about: 'x' });
    expect(await lessonsFor(pg, 'content')).toEqual([
      'The first thing learned.',
      'The second thing learned.',
    ]);
  });

  it('replaces the placeholder rather than leaving a stray heading', () => {
    const bare = charterWithLessons('content', []);
    expect(bare).toContain('## Learned');
    expect(bare).toContain('Nothing yet');
    expect(bare).not.toContain('appended here automatically');

    const taught = charterWithLessons('content', ['Do not do that.']);
    expect(taught).toContain('- Do not do that.');
    expect(taught).not.toContain('Nothing yet');
    // and the rest of the charter is untouched
    expect(taught).toContain('# Content');
    expect(taught).toContain('## Mission');
  });

  it('puts them into the prefix the role actually runs with', async () => {
    await recordLesson(pg, {
      role: 'content',
      reason: 'Stop opening with a rhetorical question.',
      about: 'artifact.create',
    });
    const blocks = await stableSystemWithLessons(pg, 'content');
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain('Stop opening with a rhetorical question.');
  });

  it('leaves the concierge alone, which has no charter to teach', async () => {
    const blocks = await stableSystemWithLessons(pg, 'concierge');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('front desk');
  });
});

describe('the spend cap setting', () => {
  it('is what the standup measures against', async () => {
    await setSetting(pg, 'daily_cap_usd', 20);
    await pg.query(`INSERT INTO spend_day (date, usd) VALUES (current_date, 15)`);
    expect((await buildStandup(pg)).rows).toContainEqual(['Spent', '$15.00 of $20.00']);
  });
});
