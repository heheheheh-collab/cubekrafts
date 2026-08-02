import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Sql } from '../db/sql.ts';
import { id } from '../db/repo.ts';
import type { ToolSinks } from './execute.ts';

/**
 * The tools that produce records rather than touching a workspace.
 *
 * Artifacts are written to disk *and* recorded in the database: the file is
 * what you read, the row is what the work graph refers to. Keeping the body
 * out of Postgres keeps the transcripts readable and the backups small.
 */
export function makeSinks(sql: Sql, home: string): ToolSinks {
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
      const draftId = id('draft');
      await sql.query(
        `INSERT INTO artifact (id, task_id, kind, title, storage_key, status)
              VALUES ($1, NULL, 'draft_email', $2, $3, 'draft')`,
        [draftId, subject, `lead:${lead_id}`],
      );
      const key = join(files, `${draftId}.txt`);
      await mkdir(dirname(key), { recursive: true });
      await writeFile(key, body, 'utf8');
      return { id: draftId };
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
  };
}
