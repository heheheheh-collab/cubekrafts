import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '../db/sql.ts';

/**
 * The recovery code.
 *
 * One code, shown once, hashed at rest, single-use. That is the entire
 * account-recovery story on purpose: every extra way back in is an extra way
 * in, and this account can send email as the owner and push code.
 *
 * The code is 160 bits of randomness, so a plain sha256 is the right hash —
 * there is no dictionary to attack and no password to be slow about. What
 * protects it is entropy and the rate limiter, not a work factor.
 */

const BYTES = 20;
const GROUPS = 4;

function hash(code: string): string {
  return createHash('sha256').update(normalise(code)).digest('hex');
}

/** Accept the code however the owner types it back: spacing and case are noise. */
export function normalise(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Crockford-ish base32: no I, L, O, U, so nothing reads as something else. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Mint a code, replacing any previous one.
 *
 * Returns the plaintext, which is the only time it exists anywhere. If the
 * caller loses it, the only remedy is to mint another.
 */
export async function issueRecoveryCode(sql: Sql): Promise<string> {
  const raw = encode(randomBytes(BYTES));
  const size = Math.ceil(raw.length / GROUPS);
  const code = Array.from({ length: GROUPS }, (_, i) => raw.slice(i * size, (i + 1) * size))
    .filter(Boolean)
    .join('-');

  // Superseding rather than accumulating: two live codes would mean two live
  // ways in, and the plan says there is one.
  await sql.query(`DELETE FROM recovery_code WHERE used_at IS NULL`);
  await sql.query(`INSERT INTO recovery_code (hash) VALUES ($1)`, [hash(code)]);
  return code;
}

/**
 * Spend the code, or refuse.
 *
 * A single statement so a code cannot be redeemed twice by two requests that
 * arrive together. Marked used rather than deleted, so the auth log can show
 * that recovery happened and when.
 */
export async function redeemRecoveryCode(sql: Sql, code: string): Promise<boolean> {
  if (normalise(code).length === 0) return false;
  const { rows } = await sql.query<{ hash: string }>(
    `UPDATE recovery_code SET used_at = now()
      WHERE hash = $1 AND used_at IS NULL RETURNING hash`,
    [hash(code)],
  );
  return rows.length > 0;
}

/** Whether a code is outstanding — the settings screen offers to mint one if not. */
export async function hasRecoveryCode(sql: Sql): Promise<boolean> {
  const { rows } = await sql.query(`SELECT 1 FROM recovery_code WHERE used_at IS NULL LIMIT 1`);
  return rows.length > 0;
}
