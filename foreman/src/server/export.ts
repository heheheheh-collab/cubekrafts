import type { Sql } from '../db/sql.ts';
import { CHARTERS, DEFAULT_CANON, TOOL_PREAMBLE, CONCIERGE_PREAMBLE } from '../agents/charters.ts';
import { SECRET_SETTINGS } from '../claude/runtime.ts';
import { CONNECTION_SECRET_SETTINGS } from './connections.ts';

/** Every settings key whose value must never leave the machine in a file. */
const NEVER_IN_EXPORT = [...SECRET_SETTINGS, ...CONNECTION_SECRET_SETTINGS];

/**
 * Everything, in one file.
 *
 * The promise in §1 of the plan is that you can leave. That is only true if
 * leaving is one button rather than a research project, so this dumps every
 * table, every charter, and the manifest of every artifact as a single JSON
 * document you could reconstruct the whole thing from.
 *
 * Deliberately not a database backup: a pg_dump is only useful to Postgres,
 * and the point is that your business data is yours in a form anything can
 * read.
 */

/** Everything worth taking. Order is for reading, not for restoring. */
const TABLES = [
  'goal',
  'initiative',
  'task',
  'run',
  'tool_call',
  'message',
  'artifact',
  'review',
  'approval',
  'question',
  'lead',
  'email_message',
  'email_suppression',
  'email_event',
  'audit',
  'auth_event',
  'setting',
  'spend_day',
  'role',
  'charter',
  'tool_grant',
] as const;

/**
 * Tables holding secrets, which are the whole reason this is an explicit list
 * rather than a query against the catalogue. `session` holds token hashes,
 * `credential` holds public keys tied to a device, `recovery_code` holds the
 * hash of the one way back in. None of them mean anything elsewhere, and all
 * of them are worth not writing to a file that gets emailed around.
 */
const NEVER_EXPORTED = ['session', 'credential', 'recovery_code', 'auth_challenge', 'rate_counter'];

export interface Archive {
  exportedAt: string;
  foreman: { version: string };
  charters: Record<string, string>;
  tables: Record<string, unknown[]>;
  omitted: string[];
  counts: Record<string, number>;
}

export async function buildArchive(sql: Sql, version = '0.0.0'): Promise<Archive> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const table of TABLES) {
    // Table names are from the constant above, never from a caller, which is
    // why interpolating them here is safe — and why the list is a constant.
    const { rows } = await sql.query(`SELECT * FROM ${table}`);
    // Settings mix configuration with the one secret the app stores — the
    // API key pasted into ⋯ → Model. The export is a file that gets kept and
    // forwarded, which is exactly where a live key must not be.
    tables[table] =
      table === 'setting'
        ? rows.filter((r) => !NEVER_IN_EXPORT.includes(String((r as { key?: unknown }).key)))
        : rows;
    counts[table] = tables[table].length;
  }

  return {
    exportedAt: new Date().toISOString(),
    foreman: { version },
    // The prompts are the part that is genuinely yours and genuinely hard to
    // reconstruct, so they go in as text rather than as a table dump.
    charters: {
      _preamble: TOOL_PREAMBLE,
      _concierge: CONCIERGE_PREAMBLE,
      _canon: DEFAULT_CANON,
      ...Object.fromEntries(Object.entries(CHARTERS).filter(([, v]) => typeof v === 'string')),
    },
    tables,
    omitted: NEVER_EXPORTED,
    counts,
  };
}
