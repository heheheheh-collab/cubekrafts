import type { Sql } from '../db/sql.ts';
import type { RoleName } from '../domain/types.ts';
import { CHARTERS, DEFAULT_CANON, TOOL_PREAMBLE, CONCIERGE_PREAMBLE } from './charters.ts';

/**
 * What a role has been told off for, folded back into its prompt.
 *
 * The mechanism is deliberately dull: rejections with reasons are appended
 * verbatim under a "Learned" heading. No model rewrites the charter, because a
 * charter that drifts on its own is one nobody can reason about, and because
 * the founder's actual words are better instructions than a paraphrase of them.
 *
 * It sits in the *stable* prefix, which means adding a line invalidates the
 * cache for that role — so notes are capped, and only rejections that carried
 * a reason count. A rejection with no reason teaches nothing anyway.
 */

/** Past this, the oldest note falls off. Long enough to matter, short enough to read. */
export const MAX_NOTES = 12;

/** Below this, a "reason" is a grunt rather than an instruction. */
const MIN_USEFUL_REASON = 12;

export async function recordLesson(
  sql: Sql,
  input: { role: RoleName; reason: string; about: string },
): Promise<boolean> {
  const reason = input.reason.trim();
  if (reason.length < MIN_USEFUL_REASON) return false;

  await sql.query(
    `INSERT INTO audit (actor, action, subject, detail) VALUES ($1, 'learned', $2, $3)`,
    [input.role, input.about, JSON.stringify({ reason })],
  );
  return true;
}

export async function lessonsFor(sql: Sql, role: RoleName): Promise<string[]> {
  const { rows } = await sql.query<{ detail: { reason?: string } }>(
    // The id breaks ties. Two lessons recorded in the same statement-clock
    // tick share an `at`, and ordering on it alone is not a total order — so
    // "the newest twelve" would quietly become "some twelve".
    `SELECT detail FROM audit WHERE actor = $1 AND action = 'learned'
      ORDER BY at DESC, id DESC LIMIT $2`,
    [role, MAX_NOTES],
  );
  // Newest first out of the database, oldest first into the prompt: the
  // charter reads as a history rather than as a stack.
  return rows
    .map((r) => r.detail.reason)
    .filter((r): r is string => typeof r === 'string' && r.length > 0)
    .reverse();
}

/**
 * The charter with its learned notes attached.
 *
 * The placeholder in the charter text is replaced rather than appended to, so
 * the empty case reads as a charter with nothing learned yet rather than one
 * with a stray heading.
 */
export function charterWithLessons(role: RoleName, lessons: readonly string[]): string {
  const charter = CHARTERS[role];
  if (!charter) throw new Error(`no charter for role ${role}`);

  const body =
    lessons.length === 0
      ? '(Nothing yet. Rejections with reasons are added here.)'
      : lessons.map((l) => `- ${l}`).join('\n');

  return charter.includes('## Learned')
    ? charter.replace(/## Learned[\s\S]*$/, `## Learned\n${body}`)
    : `${charter}\n\n## Learned\n${body}`;
}

/** The three cacheable blocks, with whatever this role has been taught. */
export async function stableSystemWithLessons(
  sql: Sql,
  role: RoleName,
  opts: { canon?: string } = {},
): Promise<string[]> {
  if (role === 'concierge') return [CONCIERGE_PREAMBLE, opts.canon ?? DEFAULT_CANON];
  const lessons = await lessonsFor(sql, role);
  return [TOOL_PREAMBLE, charterWithLessons(role, lessons), opts.canon ?? DEFAULT_CANON];
}
