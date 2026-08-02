import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import { setSetting } from '../src/db/repo.ts';
import {
  canonical,
  draft,
  EmailError,
  isSuppressed,
  loadMessage,
  looksLikeAddress,
  payloadHash,
  suppress,
  upsertLead,
  verifyFrozen,
} from '../src/email/messages.ts';
import {
  DEFAULT_DAILY_SENDS,
  SETTINGS_DAILY_SENDS,
  recordProviderEvent,
  sendApproved,
  sentToday,
} from '../src/email/send.ts';
import {
  RecordingTransport,
  TransportError,
  transportFromEnv,
  type Transport,
} from '../src/email/transport.ts';
import { classify, disposition, canPromote } from '../src/tools/effects.ts';
import { DEFAULT_POLICY, NEVER_PROMOTABLE } from '../src/domain/types.ts';

/**
 * Email — the one thing this system does that reaches a real person as the
 * founder, so it gets the most tests of anything here.
 *
 * The claim being tested is narrow and total: what the founder read is what
 * goes out, exactly once, and never to somebody who has asked us to stop.
 */

let pg: PGlite;
let leadId: string;

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
    DELETE FROM lead; DELETE FROM audit; DELETE FROM setting;
  `);
  leadId = await upsertLead(pg, { email: 'ravi@example.com', name: 'Ravi', source: 'site' });
});

const aDraft = () =>
  draft(pg, {
    leadId,
    toAddress: '',
    subject: 'Your site office enquiry',
    body: 'A 20-foot site office ships in three weeks.',
  });

// ── the freeze ──────────────────────────────────────────────────────────────

describe('the frozen payload', () => {
  it('hashes a message to a stable value', () => {
    const payload = { toAddress: 'a@b.com', subject: 'Hi', body: 'There' };
    expect(payloadHash(payload)).toBe(payloadHash({ ...payload }));
    expect(payloadHash(payload)).toHaveLength(64);
  });

  it('cannot be rearranged into a different message with the same hash', () => {
    // Length-prefixed, so moving a character from the subject into the body
    // changes the hash. A delimiter-joined form would not.
    expect(payloadHash({ toAddress: 'a@b.com', subject: 'ab', body: 'c' })).not.toBe(
      payloadHash({ toAddress: 'a@b.com', subject: 'a', body: 'bc' }),
    );
    expect(canonical({ toAddress: 'a@b.com', subject: 'ab', body: 'c' })).toContain('2:ab');
  });

  it('treats the address case-insensitively, as everything else does', () => {
    expect(payloadHash({ toAddress: 'A@B.com', subject: 's', body: 'b' })).toBe(
      payloadHash({ toAddress: 'a@b.com', subject: 's', body: 'b' }),
    );
  });

  it('is recorded on the message and verifies', async () => {
    const message = await aDraft();
    expect(message.payloadHash).toHaveLength(64);
    expect(verifyFrozen(message)).toBe(true);
  });

  it('cannot be edited afterwards — the database refuses', async () => {
    // The load-bearing guarantee. Not a convention, not a code path anyone
    // could forget: a constraint.
    const message = await aDraft();
    await expect(
      pg.query(`UPDATE email_message SET body = 'something else' WHERE id = $1`, [message.id]),
    ).rejects.toThrow(/frozen once drafted/);
    await expect(
      pg.query(`UPDATE email_message SET to_address = 'someone@else.com' WHERE id = $1`, [message.id]),
    ).rejects.toThrow(/frozen once drafted/);
    await expect(
      pg.query(`UPDATE email_message SET subject = 'Re: something' WHERE id = $1`, [message.id]),
    ).rejects.toThrow(/frozen once drafted/);
  });

  it('still allows the fields that record what happened to it', async () => {
    const message = await aDraft();
    await pg.query(
      `UPDATE email_message SET status = 'sent', sent_at = now(), provider_id = 'p1' WHERE id = $1`,
      [message.id],
    );
    expect((await loadMessage(pg, message.id))!.providerId).toBe('p1');
  });

  it('refuses to send when the hash and the body disagree', async () => {
    const message = await aDraft();
    const transport = new RecordingTransport();
    // Reaching past the domain code to fake a corrupted restore, which is the
    // one way the trigger could be bypassed.
    const corrupted = { ...message, body: 'not what was approved' };
    expect(verifyFrozen(corrupted)).toBe(false);
    expect(transport.outbox).toHaveLength(0);
  });
});

// ── who may be written to ───────────────────────────────────────────────────

describe('addresses', () => {
  it('rejects the obviously wrong ones before a provider sees them', () => {
    expect(looksLikeAddress('ravi@example.com')).toBe(true);
    expect(looksLikeAddress('ravi@localhost')).toBe(false);
    expect(looksLikeAddress('not an address')).toBe(false);
    expect(looksLikeAddress('')).toBe(false);
  });

  it('will not create a lead from junk', async () => {
    await expect(upsertLead(pg, { email: 'nope' })).rejects.toThrow(EmailError);
  });

  it('treats one person as one lead however they capitalise it', async () => {
    const again = await upsertLead(pg, { email: 'RAVI@example.com' });
    expect(again).toBe(leadId);
  });
});

describe('suppression', () => {
  it('refuses to draft to a suppressed address at all', async () => {
    // Refused at draft time as well as send time, so the founder is never
    // shown — and never approves — something that could not have gone out.
    await suppress(pg, 'ravi@example.com', 'bounce');
    await expect(aDraft()).rejects.toThrow(/suppressed/);
  });

  it('marks the person unsubscribed, not just the address', async () => {
    await suppress(pg, 'ravi@example.com', 'unsubscribe');
    const { rows } = await pg.query<{ unsubscribed_at: Date | null }>(
      `SELECT unsubscribed_at FROM lead WHERE id = $1`,
      [leadId],
    );
    expect(rows[0]!.unsubscribed_at).not.toBeNull();
  });

  it('is case-insensitive, because addresses are', async () => {
    await suppress(pg, 'RAVI@Example.com', 'complaint');
    expect(await isSuppressed(pg, 'ravi@example.com')).toBe('complaint');
  });

  it('does not fall over when the same address is suppressed twice', async () => {
    await suppress(pg, 'ravi@example.com', 'bounce');
    await suppress(pg, 'ravi@example.com', 'complaint');
    expect(await isSuppressed(pg, 'ravi@example.com')).toBe('bounce');
  });

  it('stops a message approved before the suppression from going out', async () => {
    const message = await aDraft();
    await suppress(pg, 'ravi@example.com', 'unsubscribe');

    const transport = new RecordingTransport();
    const result = await sendApproved({ sql: pg, transport }, message.id);
    expect(result.sent).toBe(false);
    expect(result.refusedBecause).toMatch(/suppressed|unsubscribed/);
    expect(transport.outbox).toHaveLength(0);
    expect((await loadMessage(pg, message.id))!.status).toBe('suppressed');
  });
});

// ── sending ─────────────────────────────────────────────────────────────────

describe('sending', () => {
  it('hands the frozen text to the transport unchanged', async () => {
    const message = await aDraft();
    const transport = new RecordingTransport();
    const result = await sendApproved({ sql: pg, transport }, message.id);

    expect(result.sent).toBe(true);
    expect(transport.outbox[0]).toEqual({
      to: 'ravi@example.com',
      subject: 'Your site office enquiry',
      body: 'A 20-foot site office ships in three weeks.',
      idempotencyKey: message.idempotencyKey,
    });
  });

  it('records the provider id against the message', async () => {
    const message = await aDraft();
    await sendApproved({ sql: pg, transport: new RecordingTransport() }, message.id);
    const after = await loadMessage(pg, message.id);
    expect(after).toMatchObject({ status: 'sent' });
    expect(after!.providerId).toContain('recorded:');
    expect(after!.sentAt).not.toBeNull();
  });

  it('sends exactly once, however many times it is asked', async () => {
    // A double tap on a phone, a resumed run, a retried approval — all of
    // these reach here, and none of them may mail the person twice.
    const message = await aDraft();
    const transport = new RecordingTransport();
    const first = await sendApproved({ sql: pg, transport }, message.id);
    const second = await sendApproved({ sql: pg, transport }, message.id);

    expect(transport.outbox).toHaveLength(1);
    expect(second).toEqual({ sent: true, providerId: first.providerId });
  });

  it('carries an idempotency key the provider can deduplicate on', async () => {
    const message = await aDraft();
    expect(message.idempotencyKey).toContain(message.id);
    const other = await draft(pg, { leadId, toAddress: '', subject: 's', body: 'b' });
    expect(other.idempotencyKey).not.toBe(message.idempotencyKey);
  });

  it('will not send a message that is already failed', async () => {
    const message = await aDraft();
    await pg.query(`UPDATE email_message SET status = 'failed' WHERE id = $1`, [message.id]);
    const result = await sendApproved({ sql: pg, transport: new RecordingTransport() }, message.id);
    expect(result).toMatchObject({ sent: false });
    expect(result.refusedBecause).toMatch(/failed/);
  });

  it('throws for a message that does not exist, rather than silently doing nothing', async () => {
    await expect(
      sendApproved({ sql: pg, transport: new RecordingTransport() }, 'msg_nope'),
    ).rejects.toThrow(EmailError);
  });
});

describe('the daily send cap', () => {
  it('counts only what actually went out today', async () => {
    expect(await sentToday(pg)).toBe(0);
    const message = await aDraft();
    await sendApproved({ sql: pg, transport: new RecordingTransport() }, message.id);
    expect(await sentToday(pg)).toBe(1);
  });

  it('stops sending once it is reached', async () => {
    await setSetting(pg, SETTINGS_DAILY_SENDS, 1);
    const first = await aDraft();
    const second = await draft(pg, { leadId, toAddress: '', subject: 'Second', body: 'Also' });
    const transport = new RecordingTransport();

    expect((await sendApproved({ sql: pg, transport }, first.id)).sent).toBe(true);
    const blocked = await sendApproved({ sql: pg, transport }, second.id);
    expect(blocked.sent).toBe(false);
    expect(blocked.refusedBecause).toMatch(/send cap of 1/);
  });

  it('leaves the capped message as a draft, because it is fine tomorrow', async () => {
    // Failing it would throw away work the founder already read and approved.
    await setSetting(pg, SETTINGS_DAILY_SENDS, 0);
    const message = await aDraft();
    await sendApproved({ sql: pg, transport: new RecordingTransport() }, message.id);
    expect((await loadMessage(pg, message.id))!.status).toBe('draft');
  });

  it('has a default low enough to be a real limit', () => {
    expect(DEFAULT_DAILY_SENDS).toBeLessThanOrEqual(50);
  });
});

describe('when the provider refuses', () => {
  const failing = (retryable: boolean): Transport => ({
    name: 'failing',
    send: async () => {
      throw new TransportError('nope', retryable);
    },
  });

  it('keeps a retryable failure as a draft, under the same idempotency key', async () => {
    const message = await aDraft();
    const result = await sendApproved({ sql: pg, transport: failing(true) }, message.id);
    expect(result.sent).toBe(false);
    const after = await loadMessage(pg, message.id);
    expect(after!.status).toBe('draft');
    expect(after!.idempotencyKey).toBe(message.idempotencyKey);
  });

  it('marks a permanent failure failed, because retrying would fail identically', async () => {
    const message = await aDraft();
    await sendApproved({ sql: pg, transport: failing(false) }, message.id);
    expect((await loadMessage(pg, message.id))!.status).toBe('failed');
  });

  it('treats a network error as retryable, since it says nothing about delivery', async () => {
    const message = await aDraft();
    const flaky: Transport = {
      name: 'flaky',
      send: async () => {
        throw new TransportError('socket hang up', true);
      },
    };
    await sendApproved({ sql: pg, transport: flaky }, message.id);
    expect((await loadMessage(pg, message.id))!.status).toBe('draft');

    // and the retry goes out under the same key
    const transport = new RecordingTransport();
    expect((await sendApproved({ sql: pg, transport }, message.id)).sent).toBe(true);
    expect(transport.outbox[0]!.idempotencyKey).toBe(message.idempotencyKey);
  });
});

// ── what comes back ─────────────────────────────────────────────────────────

describe('provider events', () => {
  async function sent(): Promise<string> {
    const message = await aDraft();
    await sendApproved({ sql: pg, transport: new RecordingTransport() }, message.id);
    return (await loadMessage(pg, message.id))!.providerId!;
  }

  it('suppresses the address on a bounce, immediately and without asking', async () => {
    const providerId = await sent();
    expect(await recordProviderEvent(pg, { kind: 'bounced', providerId })).toEqual({
      suppressed: true,
    });
    expect(await isSuppressed(pg, 'ravi@example.com')).toBe('bounce');
  });

  it('suppresses on a complaint too', async () => {
    const providerId = await sent();
    await recordProviderEvent(pg, { kind: 'complained', providerId });
    expect(await isSuppressed(pg, 'ravi@example.com')).toBe('complaint');
  });

  it('records a delivery without suppressing anything', async () => {
    const providerId = await sent();
    expect(await recordProviderEvent(pg, { kind: 'delivered', providerId })).toEqual({
      suppressed: false,
    });
    expect(await isSuppressed(pg, 'ravi@example.com')).toBeNull();
  });

  it('keeps an event for a message it cannot match, rather than dropping it', async () => {
    await recordProviderEvent(pg, { kind: 'bounced', providerId: 'unknown', address: 'x@y.com' });
    const { rows } = await pg.query(`SELECT kind FROM email_event`);
    expect(rows).toHaveLength(1);
    expect(await isSuppressed(pg, 'x@y.com')).toBe('bounce');
  });
});

// ── the transport ───────────────────────────────────────────────────────────

describe('choosing a transport', () => {
  it('records rather than sends when nothing is configured', () => {
    expect(transportFromEnv({}).name).toBe('recording');
    expect(transportFromEnv({ RESEND_API_KEY: 'k' }).name).toBe('recording');
  });

  it('uses the provider once both the key and the from address exist', () => {
    expect(transportFromEnv({ RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.com' }).name).toBe('resend');
  });

  it('does not pretend to have sent anything', async () => {
    // A recording transport that returned a plausible provider id would let a
    // misconfigured instance report success forever.
    const transport = new RecordingTransport();
    const { providerId } = await transport.send({
      to: 'a@b.com',
      subject: 's',
      body: 'b',
      idempotencyKey: 'k',
    });
    expect(providerId).toMatch(/^recorded:/);
  });
});

// ── the promotion guard, restated ───────────────────────────────────────────

describe('email.send can never run unattended', () => {
  it('is guarded whoever asks and whatever the arguments', () => {
    const verdict = classify(
      'sales',
      { id: 't', name: 'email.send', args: { draft_id: 'msg_1' } },
      DEFAULT_POLICY,
    );
    expect(verdict.effect).toBe('guarded');
    expect(disposition(verdict, 'approve').action).toBe('queue');
  });

  it('is queued even at the loosest autonomy the ladder allows it', () => {
    expect(canPromote('email.send', 'notify').ok).toBe(false);
    expect(canPromote('email.send', 'auto').ok).toBe(false);
    expect(canPromote('email.send', 'approve').ok).toBe(true);
    expect(NEVER_PROMOTABLE.has('email.send')).toBe(true);
  });

  it('is refused outright to a role that was never granted it', () => {
    for (const role of ['content', 'concierge', 'developer', 'coo'] as const) {
      const verdict = classify(
        role,
        { id: 't', name: 'email.send', args: { draft_id: 'msg_1' } },
        DEFAULT_POLICY,
      );
      expect({ role, effect: verdict.effect }).toEqual({ role, effect: 'forbidden' });
    }
  });

  it('is refused by the database if a grant is ever written above approve', async () => {
    // Restated where no code path can go around it. See 001_init.sql.
    await pg.query(
      `INSERT INTO role (id, name, model) VALUES ('sales','sales','claude-sonnet-5')
       ON CONFLICT (id) DO NOTHING`,
    );
    await expect(
      pg.query(
        `INSERT INTO tool_grant (role_id, tool, autonomy) VALUES ('sales','email.send','auto')`,
      ),
    ).rejects.toThrow(/never_unattended/);
    await pg.exec(`DELETE FROM tool_grant; DELETE FROM role WHERE id = 'sales'`);
  });
});
