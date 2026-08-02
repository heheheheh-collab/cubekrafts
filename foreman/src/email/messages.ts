import { createHash } from 'node:crypto';
import type { Sql } from '../db/sql.ts';
import { id } from '../db/repo.ts';

/**
 * Drafting, freezing, and the rules about who may be written to.
 *
 * The freeze is the load-bearing idea. A drafted message is immutable — the
 * database refuses to change its body — so "the founder approved this exact
 * text" is a fact about a row rather than a promise about a code path. The
 * hash exists so the sender can check its own reading of the row against the
 * one that was hashed at drafting time, and refuse if they differ.
 */

export interface Draft {
  leadId: string;
  toAddress: string;
  subject: string;
  body: string;
  taskId?: string;
}

export interface StoredMessage {
  id: string;
  leadId: string;
  toAddress: string;
  subject: string;
  body: string;
  payloadHash: string;
  status: 'draft' | 'sent' | 'failed' | 'suppressed';
  idempotencyKey: string;
  createdAt: Date;
  sentAt: Date | null;
  providerId: string | null;
}

/**
 * The canonical form that gets hashed.
 *
 * Length-prefixed rather than delimited, so no combination of subject and body
 * can be rearranged into a different message with the same hash. Addresses are
 * lowercased because that is how they are compared everywhere else.
 */
export function canonical(payload: {
  toAddress: string;
  subject: string;
  body: string;
}): string {
  const parts = [payload.toAddress.trim().toLowerCase(), payload.subject, payload.body];
  return parts.map((p) => `${p.length}:${p}`).join('|');
}

export function payloadHash(payload: {
  toAddress: string;
  subject: string;
  body: string;
}): string {
  return createHash('sha256').update(canonical(payload), 'utf8').digest('hex');
}

/** Not a validator — just enough that an obvious mistake never reaches a provider. */
export function looksLikeAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value.trim());
}

export class EmailError extends Error {}

// ── leads ───────────────────────────────────────────────────────────────────

export async function upsertLead(
  sql: Sql,
  input: { email: string; name?: string; source?: string; consent?: string },
): Promise<string> {
  if (!looksLikeAddress(input.email)) throw new EmailError(`${input.email} is not an address`);
  const leadId = id('lead');
  // A person who opted out and then filled the form in again comes back
  // already opted out. The suppression list would refuse the send either way,
  // but a lead row claiming otherwise is a second source of truth that
  // disagrees with the first, and one of them will eventually be believed.
  const { rows } = await sql.query<{ id: string }>(
    `INSERT INTO lead (id, email, name, source, consent, unsubscribed_at)
          VALUES ($1, $2, $3, $4, $5,
                  (SELECT created_at FROM email_suppression
                    WHERE address = lower($2) AND reason = ANY($6)))
     ON CONFLICT (lower(email)) DO UPDATE SET name = COALESCE(EXCLUDED.name, lead.name)
     RETURNING id`,
    [
      leadId,
      input.email.trim(),
      input.name ?? null,
      input.source ?? 'unknown',
      input.consent ?? 'enquiry',
      PERSON_LEVEL_SUPPRESSION,
    ],
  );
  return rows[0]!.id;
}

export async function findLead(sql: Sql, leadId: string): Promise<{ id: string; email: string; unsubscribedAt: Date | null } | null> {
  const { rows } = await sql.query<{ id: string; email: string; unsubscribed_at: Date | null }>(
    `SELECT id, email, unsubscribed_at FROM lead WHERE id = $1`,
    [leadId],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, unsubscribedAt: row.unsubscribed_at } : null;
}

// ── suppression ─────────────────────────────────────────────────────────────

export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual';

/**
 * Suppressions that are about the person rather than the mailbox.
 *
 * An unsubscribe or a spam complaint is somebody saying stop, and it follows
 * them to a new address. A bounce is only ever a fact about one mailbox.
 * Stated once, here, because both `suppress` and `upsertLead` need it and two
 * copies would eventually disagree.
 */
export const PERSON_LEVEL_SUPPRESSION: readonly SuppressionReason[] = ['unsubscribe', 'complaint'];

export async function suppress(
  sql: Sql,
  address: string,
  reason: SuppressionReason,
  detail?: string,
): Promise<void> {
  await sql.query(
    `INSERT INTO email_suppression (address, reason, detail) VALUES (lower($1), $2, $3)
     ON CONFLICT (address) DO NOTHING`,
    [address.trim(), reason, detail ?? null],
  );
  // The person said stop, so the lead is marked as well as the address.
  if (PERSON_LEVEL_SUPPRESSION.includes(reason)) {
    await sql.query(`UPDATE lead SET unsubscribed_at = now() WHERE lower(email) = lower($1)`, [
      address.trim(),
    ]);
  }
}

export async function isSuppressed(sql: Sql, address: string): Promise<SuppressionReason | null> {
  const { rows } = await sql.query<{ reason: SuppressionReason }>(
    `SELECT reason FROM email_suppression WHERE address = lower($1)`,
    [address.trim()],
  );
  return rows[0]?.reason ?? null;
}

// ── drafting ────────────────────────────────────────────────────────────────

/**
 * Write a message down and freeze it.
 *
 * Suppression is checked here as well as at send time. Checking twice is not
 * redundancy for its own sake: refusing at draft time means the founder is
 * never shown, and never approves, a message that could not have gone out.
 */
export async function draft(sql: Sql, input: Draft): Promise<StoredMessage> {
  const lead = await findLead(sql, input.leadId);
  if (!lead) throw new EmailError(`no lead ${input.leadId}`);

  const to = input.toAddress.trim() || lead.email;
  if (!looksLikeAddress(to)) throw new EmailError(`${to} is not an address`);

  // Suppression first, because it carries the more specific reason — "this
  // address bounced" is more useful to the agent than "that person opted out".
  const reason = await isSuppressed(sql, to);
  if (reason) throw new EmailError(`${to} is suppressed (${reason})`);
  if (lead.unsubscribedAt) throw new EmailError('that person has unsubscribed');

  const messageId = id('msg');
  const hash = payloadHash({ toAddress: to, subject: input.subject, body: input.body });

  const { rows } = await sql.query<Row>(
    `INSERT INTO email_message
       (id, lead_id, task_id, to_address, subject, body, payload_hash, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      messageId,
      lead.id,
      input.taskId ?? null,
      to,
      input.subject,
      input.body,
      hash,
      // The message id is already unique forever and never reused, which is
      // exactly what an idempotency key has to be.
      `msg:${messageId}`,
    ],
  );
  return hydrate(rows[0]!);
}

interface Row {
  id: string;
  lead_id: string;
  to_address: string;
  subject: string;
  body: string;
  payload_hash: string;
  status: StoredMessage['status'];
  idempotency_key: string;
  created_at: Date;
  sent_at: Date | null;
  provider_id: string | null;
}

function hydrate(row: Row): StoredMessage {
  return {
    id: row.id,
    leadId: row.lead_id,
    toAddress: row.to_address,
    subject: row.subject,
    body: row.body,
    payloadHash: row.payload_hash,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at),
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    providerId: row.provider_id,
  };
}

export async function loadMessage(sql: Sql, messageId: string): Promise<StoredMessage | null> {
  const { rows } = await sql.query<Row>(`SELECT * FROM email_message WHERE id = $1`, [messageId]);
  return rows[0] ? hydrate(rows[0]) : null;
}

/**
 * Re-derive the hash and compare.
 *
 * The database trigger already refuses to change a frozen row, so this should
 * never fail. It is here because "should never" is not the standard for the
 * one action that reaches a real person, and because a restore from a backup
 * taken mid-write is a real way for the two to disagree.
 */
export function verifyFrozen(message: StoredMessage): boolean {
  return (
    payloadHash({
      toAddress: message.toAddress,
      subject: message.subject,
      body: message.body,
    }) === message.payloadHash
  );
}
