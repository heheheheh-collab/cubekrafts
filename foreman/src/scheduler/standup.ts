import type { Sql } from '../db/sql.ts';
import { getSetting, setSetting, SETTINGS, DEFAULT_CAP_USD } from '../db/repo.ts';

/**
 * The standup.
 *
 * Written from the database, not by a model. It is a report of what happened,
 * and a model asked to summarise numbers it can already see would sometimes
 * get them wrong, cost money, and take a second — for a paragraph that has
 * exactly one correct version.
 *
 * It exists because the app is hosted rather than local: work happens while
 * you are asleep, and the first thing you want in the morning is what changed
 * and what needs you.
 */

export const SETTINGS_LAST_STANDUP = 'last_standup_date';

export interface Standup {
  /** The day being reported on, as `YYYY-MM-DD`. */
  date: string;
  /** Two or three sentences, ready to be read aloud. */
  speech: string;
  rows: Array<[string, string]>;
  needsYou: number;
}

interface Counts {
  finished: number;
  started: number;
  inReview: number;
  blocked: number;
  waiting: number;
  questions: number;
  emailsSent: number;
  spentUsd: number;
  oldestWaitHours: number | null;
}

async function counts(sql: Sql, since: string): Promise<Counts> {
  const { rows } = await sql.query<Record<string, string | null>>(
    `SELECT
       (SELECT count(*) FROM task WHERE status = 'done'  AND closed_at  >= $1::date) AS finished,
       (SELECT count(*) FROM run  WHERE started_at >= $1::date)                      AS started,
       (SELECT count(*) FROM task WHERE status = 'review')                           AS in_review,
       (SELECT count(*) FROM task WHERE status = 'blocked')                          AS blocked,
       (SELECT count(*) FROM approval WHERE status = 'pending')                      AS waiting,
       (SELECT count(*) FROM question WHERE answered_at IS NULL)                     AS questions,
       (SELECT count(*) FROM email_message WHERE status = 'sent' AND sent_at >= $1::date) AS emails,
       (SELECT coalesce(sum(usd), 0) FROM spend_day WHERE date >= $1::date)          AS spent,
       (SELECT extract(epoch from now() - min(created_at)) / 3600 FROM approval
         WHERE status = 'pending')                                                   AS oldest`,
    [since],
  );
  const row = rows[0] ?? {};
  const n = (key: string) => Number(row[key] ?? 0);
  return {
    finished: n('finished'),
    started: n('started'),
    inReview: n('in_review'),
    blocked: n('blocked'),
    waiting: n('waiting'),
    questions: n('questions'),
    emailsSent: n('emails'),
    spentUsd: n('spent'),
    oldestWaitHours: row['oldest'] === null ? null : n('oldest'),
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The sentences.
 *
 * Ordered by what a person actually wants first: what needs them, then what
 * happened, then what it cost. A standup that opens with token counts is a
 * dashboard wearing a sentence.
 */
export function narrate(c: Counts, capUsd: number): string {
  const parts: string[] = [];

  if (c.waiting > 0) {
    const age =
      c.oldestWaitHours !== null && c.oldestWaitHours >= 12
        ? `, the oldest for ${Math.round(c.oldestWaitHours)} hours`
        : '';
    parts.push(`${plural(c.waiting, 'thing')} waiting on you${age}.`);
  }
  if (c.questions > 0) parts.push(`${plural(c.questions, 'question')} unanswered.`);

  if (c.finished > 0 || c.started > 0) {
    const bits = [];
    if (c.finished > 0) bits.push(`${plural(c.finished, 'task')} finished`);
    if (c.inReview > 0) bits.push(`${c.inReview} in review`);
    if (c.blocked > 0) bits.push(`${c.blocked} blocked`);
    if (c.emailsSent > 0) bits.push(`${plural(c.emailsSent, 'email')} sent`);
    parts.push(`${bits.join(', ')}.`);
  } else if (c.waiting === 0 && c.questions === 0) {
    parts.push('Nothing moved overnight.');
  }

  // Only mentioned when it is worth mentioning. A daily "you spent forty
  // cents" trains you to skip the whole thing.
  const share = capUsd > 0 ? c.spentUsd / capUsd : 0;
  if (share >= 0.5) {
    parts.push(`$${c.spentUsd.toFixed(2)} of the $${capUsd.toFixed(2)} cap.`);
  }

  return parts.join(' ');
}

export async function buildStandup(sql: Sql, now = new Date()): Promise<Standup> {
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const c = await counts(sql, since);
  const capUsd = await getSetting<number>(sql, SETTINGS.dailyCapUsd, DEFAULT_CAP_USD);

  return {
    date: now.toISOString().slice(0, 10),
    speech: narrate(c, capUsd),
    rows: [
      ['Waiting on you', String(c.waiting)],
      ['Unanswered questions', String(c.questions)],
      ['Finished', String(c.finished)],
      ['In review', String(c.inReview)],
      ['Blocked', String(c.blocked)],
      ['Emails sent', String(c.emailsSent)],
      ['Spent', `$${c.spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`],
    ],
    needsYou: c.waiting + c.questions,
  };
}

/**
 * Write today's, once.
 *
 * The date is recorded so a restart, a redeploy, or a second scheduler tick
 * cannot produce two standups for the same morning.
 */
export async function standupIfDue(sql: Sql, now = new Date()): Promise<Standup | null> {
  const today = now.toISOString().slice(0, 10);
  if ((await getSetting<string | null>(sql, SETTINGS_LAST_STANDUP, null)) === today) return null;

  const standup = await buildStandup(sql, now);
  await setSetting(sql, SETTINGS_LAST_STANDUP, today);
  await sql.query(
    `INSERT INTO audit (actor, action, subject, detail) VALUES ('system','standup',$1,$2)`,
    [today, JSON.stringify({ speech: standup.speech, needsYou: standup.needsYou })],
  );
  return standup;
}
