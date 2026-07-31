import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execScript, type Sql } from './sql.ts';

/**
 * Migrations.
 *
 * Numbered `.sql` files applied in filename order, each in its own
 * transaction, recorded so a second run does nothing. A migration that has
 * already been applied is never re-read for content — but its checksum *is*
 * compared, because editing a committed migration is the way a schema quietly
 * diverges between your laptop and production, and it should be loud.
 */

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: Date;
}

const TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    name        TEXT PRIMARY KEY,
    checksum    TEXT        NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

export class MigrationDrift extends Error {}

function checksum(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

export function defaultMigrationsDir(): string {
  return new URL('./migrations/', import.meta.url).pathname;
}

export async function migrate(
  sql: Sql,
  dir: string = defaultMigrationsDir(),
): Promise<string[]> {
  await sql.query(TABLE);

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await sql.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migration',
  );
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));
  const ran: string[] = [];

  for (const name of files) {
    const body = await readFile(join(dir, name), 'utf8');
    const sum = checksum(body);
    const seen = applied.get(name);

    if (seen !== undefined) {
      if (seen !== sum) {
        throw new MigrationDrift(
          `${name} has changed since it was applied (${seen} → ${sum}). ` +
            'Committed migrations are immutable; add a new file instead.',
        );
      }
      continue;
    }

    // Each migration gets its own transaction, so a failure halfway through
    // the set leaves the earlier ones applied and this one not applied at all.
    await sql.query('BEGIN');
    try {
      await execScript(sql, body);
      await sql.query('INSERT INTO schema_migration (name, checksum) VALUES ($1, $2)', [
        name,
        sum,
      ]);
      await sql.query('COMMIT');
    } catch (err) {
      await sql.query('ROLLBACK');
      throw new Error(`migration ${name} failed: ${err instanceof Error ? err.message : err}`);
    }
    ran.push(name);
  }

  return ran;
}

export async function appliedMigrations(sql: Sql): Promise<AppliedMigration[]> {
  await sql.query(TABLE);
  const { rows } = await sql.query<{ name: string; checksum: string; applied_at: Date }>(
    'SELECT name, checksum, applied_at FROM schema_migration ORDER BY name',
  );
  return rows.map((r) => ({ name: r.name, checksum: r.checksum, appliedAt: r.applied_at }));
}
