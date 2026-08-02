import type { Sql } from '../db/sql.ts';
import type { Audit } from '../guards/audit.ts';
import { getSetting } from '../db/repo.ts';
import { EmailError, isSuppressed, loadMessage, verifyFrozen } from './messages.ts';
import { TransportError, type Transport } from './transport.ts';

/**
 * Sending.
 *
 * Six gates, in this order, and every one of them can only refuse:
 *
 *   1. the message exists
 *   2. it has not already been sent          — idempotency
 *   3. its body still hashes to what was frozen
 *   4. the recipient is not suppressed        — bounced, complained, unsubscribed
 *   5. the person has not unsubscribed
 *   6. today's send count is under the cap
 *
 * Only then does anything leave. Nothing in this file can rewrite a message,
 * pick a different recipient, or raise the cap; the whole job is to check and
 * then hand the frozen row to the transport verbatim.
 */

export const SETTINGS_DAILY_SENDS = 'daily_email_cap';
export const DEFAULT_DAILY_SENDS = 20;

export interface SendDeps {
  sql: Sql;
  transport: Transport;
  audit?: Audit;
}

export interface SendResult {
  sent: boolean;
  providerId?: string;
  /** Present when a gate refused; phrased for the model and the audit log. */
  refusedBecause?: string;
}

export async function sentToday(sql: Sql): Promise<number> {
  const { rows } = await sql.query<{ n: string }>(
    `SELECT count(*) AS n FROM email_message
      WHERE status = 'sent' AND sent_at >= date_trunc('day', now())`,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function sendApproved(
  deps: SendDeps,
  messageId: string,
): Promise<SendResult> {
  const { sql } = deps;

  const message = await loadMessage(sql, messageId);
  if (!message) throw new EmailError(`no message ${messageId}`);

  // Already gone. Not an error — a retry, a double tap, a resumed run — and
  // reporting the original provider id is what makes it idempotent rather
  // than merely safe.
  if (message.status === 'sent') {
    return { sent: true, ...(message.providerId ? { providerId: message.providerId } : {}) };
  }
  if (message.status !== 'draft') {
    return { sent: false, refusedBecause: `that message is ${message.status}` };
  }

  if (!verifyFrozen(message)) {
    // The database trigger should make this impossible. If it happens anyway,
    // something is wrong at a level this code cannot reason about, and the
    // only safe move is to refuse and say so loudly.
    await deps.audit?.record({
      actor: 'system',
      action: 'email.hash_mismatch',
      subject: message.id,
      detail: { expected: message.payloadHash },
    });
    await fail(sql, message.id, 'the body no longer matches what was approved');
    return { sent: false, refusedBecause: 'the body no longer matches what was approved' };
  }

  const suppression = await isSuppressed(sql, message.toAddress);
  if (suppression) {
    await mark(sql, message.id, 'suppressed', `suppressed: ${suppression}`);
    return { sent: false, refusedBecause: `${message.toAddress} is suppressed (${suppression})` };
  }

  const { rows: unsub } = await sql.query<{ unsubscribed_at: Date | null }>(
    `SELECT unsubscribed_at FROM lead WHERE id = $1`,
    [message.leadId],
  );
  if (unsub[0]?.unsubscribed_at) {
    await mark(sql, message.id, 'suppressed', 'the lead unsubscribed');
    return { sent: false, refusedBecause: 'that person unsubscribed while this was waiting' };
  }

  const cap = await getSetting<number>(sql, SETTINGS_DAILY_SENDS, DEFAULT_DAILY_SENDS);
  const already = await sentToday(sql);
  if (already >= cap) {
    // Not marked failed: the message is still perfectly good tomorrow, and
    // failing it would lose work the founder already read and approved.
    return { sent: false, refusedBecause: `today's send cap of ${cap} is used up` };
  }

  let providerId: string;
  try {
    const sent = await deps.transport.send({
      to: message.toAddress,
      subject: message.subject,
      body: message.body,
      idempotencyKey: message.idempotencyKey,
    });
    providerId = sent.providerId;
  } catch (err) {
    const retryable = err instanceof TransportError && err.retryable;
    const detail = err instanceof Error ? err.message : String(err);
    // A retryable failure leaves the row as a draft so the same approved
    // message can go out later under the same idempotency key. A permanent
    // one is recorded as failed, because retrying it would fail identically.
    if (!retryable) await fail(sql, message.id, detail);
    await deps.audit?.record({
      actor: 'sales',
      action: 'email.send_failed',
      subject: message.id,
      detail: { retryable, error: detail },
    });
    return { sent: false, refusedBecause: `the provider refused it: ${detail}` };
  }

  await sql.query(
    `UPDATE email_message SET status = 'sent', sent_at = now(), provider_id = $2 WHERE id = $1`,
    [message.id, providerId],
  );
  await deps.audit?.record({
    actor: 'sales',
    action: 'email.sent',
    subject: message.id,
    detail: { to: message.toAddress, subject: message.subject, providerId },
  });

  return { sent: true, providerId };
}

async function mark(sql: Sql, messageId: string, status: string, error: string): Promise<void> {
  await sql.query(`UPDATE email_message SET status = $2, error = $3 WHERE id = $1`, [
    messageId,
    status,
    error,
  ]);
}

const fail = (sql: Sql, messageId: string, error: string) =>
  mark(sql, messageId, 'failed', error);

// ── what the provider tells us afterwards ───────────────────────────────────

export type ProviderEventKind = 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked';

/**
 * A bounce or a complaint suppresses the address permanently.
 *
 * Immediately and without asking, because the alternative is a sending
 * reputation that quietly degrades until nothing arrives anywhere.
 */
export async function recordProviderEvent(
  sql: Sql,
  event: { kind: ProviderEventKind; providerId?: string; address?: string; detail?: unknown },
): Promise<{ suppressed: boolean }> {
  const { rows } = await sql.query<{ id: string; to_address: string }>(
    `SELECT id, to_address FROM email_message WHERE provider_id = $1`,
    [event.providerId ?? ''],
  );
  const message = rows[0];

  await sql.query(
    `INSERT INTO email_event (message_id, provider_id, kind, detail) VALUES ($1, $2, $3, $4)`,
    [message?.id ?? null, event.providerId ?? null, event.kind, JSON.stringify(event.detail ?? {})],
  );

  const address = message?.to_address ?? event.address;
  if (address && (event.kind === 'bounced' || event.kind === 'complained')) {
    const { suppress } = await import('./messages.ts');
    await suppress(sql, address, event.kind === 'bounced' ? 'bounce' : 'complaint');
    return { suppressed: true };
  }
  return { suppressed: false };
}
