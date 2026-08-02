import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Sql } from '../db/sql.ts';
import { id, getSetting, setSetting, PgAudit, SETTINGS, DEFAULT_CAP_USD } from '../db/repo.ts';
import type { ToolSinks } from './execute.ts';
import { draft } from '../email/messages.ts';
import { sendApproved } from '../email/send.ts';
import type { Transport } from '../email/transport.ts';
import { syncInquiries, fetchInquiries, type CubekraftsConfig } from '../cubekrafts/inquiries.ts';

/**
 * The tools that produce records rather than touching a workspace.
 *
 * Artifacts are written to disk *and* recorded in the database: the file is
 * what you read, the row is what the work graph refers to. Keeping the body
 * out of Postgres keeps the transcripts readable and the backups small.
 */
export function makeSinks(
  sql: Sql,
  home: string,
  transport?: Transport,
  cubekrafts?: CubekraftsConfig,
): ToolSinks {
  const files = join(home, 'files');

  return {
    async createArtifact({ kind, title, body }) {
      const artifactId = id('art');
      const key = join(files, `${artifactId}.md`);
      await mkdir(dirname(key), { recursive: true });
      await writeFile(key, body, 'utf8');
      await sql.query(
        `INSERT INTO artifact (id, kind, title, storage_key, status) VALUES ($1, $2, $3, $4, 'review')`,
        [artifactId, kind, title, key],
      );
      return { id: artifactId };
    },

    async askFounder({ question }) {
      const questionId = id('q');
      // The task is attached by the caller when it parks; here we only need
      // the question itself to exist and be findable.
      await sql.query(
        `INSERT INTO question (id, task_id, role_id, text)
         SELECT $1, t.id, t.owner_role, $2
           FROM task t WHERE t.status = 'running'
          ORDER BY t.created_at DESC LIMIT 1`,
        [questionId, question],
      );
      return { id: questionId };
    },

    async saveDraft({ lead_id, subject, body }) {
      // Frozen the moment it is written: the database refuses to change the
      // body afterwards, which is what makes "the founder approved this exact
      // text" a fact rather than a promise. See src/email/messages.ts.
      const message = await draft(sql, { leadId: lead_id, toAddress: '', subject, body });
      return { id: message.id };
    },

    async sendEmail({ draft_id }) {
      if (!transport) {
        return { sent: false, detail: 'no email transport is configured on this instance' };
      }
      const result = await sendApproved({ sql, transport, audit: new PgAudit(sql) }, draft_id);
      return {
        sent: result.sent,
        detail: result.sent
          ? `provider id ${result.providerId}`
          : (result.refusedBecause ?? 'refused'),
      };
    },

    async listInquiries({ limit }) {
      if (!cubekrafts) return 'This instance is not connected to Cubekrafts, so there are no enquiries to read.';
      // Synced first, so every address on screen is one Sales can actually
      // draft to — an enquiry with no lead row behind it is a dead end.
      await syncInquiries(sql, cubekrafts, limit === undefined ? {} : { limit });
      const inquiries = await fetchInquiries(cubekrafts, limit === undefined ? {} : { limit });
      if (inquiries.length === 0) return 'No enquiries yet.';

      const { rows } = await sql.query<{ id: string; email: string }>(
        `SELECT id, email FROM lead WHERE source = 'cubekrafts'`,
      );
      const leadByAddress = new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));

      return inquiries
        .map((i) => {
          const leadId = leadByAddress.get(i.email.toLowerCase()) ?? '(no lead — bad address)';
          const when = i.at ? ` on ${i.at}` : '';
          return `${leadId} ${i.name ?? 'someone'} <${i.email}>${when}\n    ${i.message ?? '(no message)'}`;
        })
        .join('\n');
    },

    async searchMemory({ query }) {
      const { rows } = await sql.query<{ title: string; kind: string; created_at: Date }>(
        `SELECT title, kind, created_at FROM artifact
          WHERE title ILIKE '%' || $1 || '%' ORDER BY created_at DESC LIMIT 10`,
        [query],
      );
      if (rows.length === 0) return 'No earlier work matches that.';
      return rows.map((r) => `${r.kind}: ${r.title}`).join('\n');
    },

    // ── the work graph ──────────────────────────────────────────────────────

    async lookUp({ view, query }) {
      return await readView(sql, view, query);
    },

    async setGoal({ title, why }) {
      const goalId = id('goal');
      await sql.query(`INSERT INTO goal (id, title, why) VALUES ($1, $2, $3)`, [
        goalId,
        title,
        why ?? null,
      ]);
      return { id: goalId };
    },

    async dispatch({ title, spec, definition_of_done, owner_role, priority }) {
      const taskId = id('task');
      await sql.query(
        `INSERT INTO task (id, title, spec, definition_of_done, owner_role, status, priority)
              VALUES ($1, $2, $3, $4, $5, 'ready', $6)`,
        [taskId, title, spec, definition_of_done, owner_role, priority ?? 100],
      );
      return { id: taskId };
    },

    async review({ task_id, verdict, notes }) {
      const next = verdict === 'accept' ? 'done' : verdict === 'revise' ? 'revise' : 'blocked';
      // The reason goes onto the spec, where the next run will actually read
      // it. A review row nobody opens does not change what the role writes.
      const { rows } = await sql.query<{ id: string }>(
        `UPDATE task
            SET status = $2,
                revision_count = revision_count + CASE WHEN $2 = 'revise' THEN 1 ELSE 0 END,
                closed_at = CASE WHEN $2 = 'done' THEN now() ELSE closed_at END,
                spec = CASE WHEN $2 = 'revise' THEN spec || E'\n\n## Sent back\n' || $3 ELSE spec END
          WHERE id = $1 AND status IN ('review', 'running', 'revise', 'blocked')
          RETURNING id`,
        [task_id, next, notes],
      );
      if (rows.length === 0) throw new Error(`task ${task_id} is not waiting on a review`);

      const { rows: artifacts } = await sql.query<{ id: string }>(
        `SELECT id FROM artifact WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [task_id],
      );
      const artifactId = artifacts[0]?.id;
      if (artifactId !== undefined) {
        await sql.query(
          `INSERT INTO review (artifact_id, reviewer, kind, verdict, notes)
                VALUES ($1, 'coo', 'coo', $2, $3)`,
          [artifactId, verdict === 'escalate' ? 'escalate' : verdict, notes],
        );
        await sql.query(`UPDATE artifact SET status = $2 WHERE id = $1`, [
          artifactId,
          verdict === 'accept' ? 'accepted' : 'rejected',
        ]);
      }
      return { status: next };
    },

    async answer({ question_id, answer }) {
      const { rows } = await sql.query<{ task_id: string }>(
        `UPDATE question SET answer = $2, answered_at = now()
          WHERE id = $1 AND answered_at IS NULL RETURNING task_id`,
        [question_id, answer],
      );
      const taskId = rows[0]?.task_id ?? null;
      if (taskId === null) return { taskId: null };

      // Same reasoning as a sent-back review: the answer has to be in the
      // spec, or the task comes back and asks the same question again.
      await sql.query(
        `UPDATE task
            SET spec = spec || E'\n\n## You asked; the founder answered\n' || $2,
                status = CASE WHEN status IN ('blocked', 'draft') THEN 'ready' ELSE status END
          WHERE id = $1`,
        [taskId, answer],
      );
      return { taskId };
    },

    async control({ paused }) {
      await setSetting(sql, SETTINGS.paused, paused);
    },
  };
}

/**
 * The read side of the work graph, rendered for a model rather than a screen.
 *
 * Short lines, ids included so the next tool call can refer to them, and a
 * hard limit on rows — a concierge answering "what's going on" does not need
 * two hundred tasks, and paying to put them in a prompt would be silly.
 */
async function readView(sql: Sql, view: string, query?: string): Promise<string> {
  const like = query ? `%${query}%` : null;

  const lines = async <T extends Record<string, unknown>>(
    text: string,
    params: unknown[],
    format: (row: T) => string,
    empty: string,
  ): Promise<string> => {
    const { rows } = await sql.query<T>(text, params);
    return rows.length === 0 ? empty : rows.map(format).join('\n');
  };

  switch (view) {
    case 'tasks':
      return lines<{ id: string; title: string; status: string; owner_role: string }>(
        `SELECT id, title, status, owner_role FROM task
          WHERE ($1::text IS NULL OR title ILIKE $1)
            AND status NOT IN ('done', 'cancelled')
          ORDER BY priority, created_at LIMIT 30`,
        [like],
        (r) => `${r.id} [${r.status}] ${r.owner_role}: ${r.title}`,
        'No open tasks.',
      );

    case 'runs':
      return lines<{ id: string; title: string; role_id: string; status: string; started_at: Date }>(
        `SELECT r.id, t.title, r.role_id, r.status, r.started_at
           FROM run r JOIN task t ON t.id = r.task_id
          ORDER BY r.started_at DESC LIMIT 15`,
        [],
        (r) => `${r.id} [${r.status}] ${r.role_id}: ${r.title}`,
        'Nothing has run yet.',
      );

    case 'approvals':
      return lines<{ id: string; tool: string; reason: string; created_at: Date }>(
        `SELECT a.id, c.tool, c.reason, a.created_at
           FROM approval a JOIN tool_call c ON c.id = a.tool_call_id
          WHERE a.status = 'pending' ORDER BY a.created_at LIMIT 20`,
        [],
        (r) => `${r.id} ${r.tool}: ${r.reason}`,
        'Nothing is waiting on the founder.',
      );

    case 'questions':
      return lines<{ id: string; role_id: string; text: string }>(
        `SELECT id, role_id, text FROM question WHERE answered_at IS NULL
          ORDER BY asked_at LIMIT 20`,
        [],
        (r) => `${r.id} ${r.role_id} asks: ${r.text}`,
        'Nobody has asked anything.',
      );

    case 'goals':
      return lines<{ id: string; title: string; status: string }>(
        `SELECT id, title, status FROM goal WHERE status = 'open'
          ORDER BY created_at DESC LIMIT 20`,
        [],
        (r) => `${r.id}: ${r.title}`,
        'No goals are set.',
      );

    case 'artifacts':
      return lines<{ id: string; kind: string; title: string; status: string }>(
        `SELECT id, kind, title, status FROM artifact
          WHERE ($1::text IS NULL OR title ILIKE $1)
          ORDER BY created_at DESC LIMIT 20`,
        [like],
        (r) => `${r.id} [${r.status}] ${r.kind}: ${r.title}`,
        'Nothing has been produced yet.',
      );

    case 'spend': {
      const { rows } = await sql.query<{ usd: string }>(
        `SELECT usd FROM spend_day WHERE date = current_date`,
      );
      const cap = await getSetting<number>(sql, SETTINGS.dailyCapUsd, DEFAULT_CAP_USD);
      return `$${Number(rows[0]?.usd ?? 0).toFixed(2)} spent today, cap $${cap.toFixed(2)}.`;
    }

    case 'activity':
      return lines<{ at: Date; actor: string; action: string; subject: string | null }>(
        `SELECT at, actor, action, subject FROM audit ORDER BY at DESC LIMIT 25`,
        [],
        (r) => `${new Date(r.at).toISOString()} ${r.actor} ${r.action}${r.subject ? ` ${r.subject}` : ''}`,
        'Nothing has happened yet.',
      );

    default:
      // The classifier already rejected unknown views, so reaching here means
      // the two lists have drifted apart.
      throw new Error(`no such view: ${view}`);
  }
}
