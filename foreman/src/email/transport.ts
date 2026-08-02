/**
 * The thing that actually hands a message to a provider.
 *
 * An interface with two implementations, because the sending *rules* — the
 * freeze, the suppression list, the cap, the idempotency key — are the part
 * worth testing, and testing them against a real provider would mean either
 * mailing strangers or mocking the wire format of a service that changes.
 */

export interface Outbound {
  to: string;
  subject: string;
  body: string;
  /** Provider-side deduplication. The same key never sends twice. */
  idempotencyKey: string;
}

export interface Sent {
  providerId: string;
}

export interface Transport {
  readonly name: string;
  send(message: Outbound): Promise<Sent>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    /** True when trying again later could plausibly work. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * What runs until an ESP account exists.
 *
 * Deliberately not a silent no-op: it records what would have gone out and
 * returns an id that says so, because a system that reports "sent" when
 * nothing was sent is worse than one that will not send at all.
 */
export class RecordingTransport implements Transport {
  readonly name = 'recording';
  readonly outbox: Outbound[] = [];

  async send(message: Outbound): Promise<Sent> {
    this.outbox.push(message);
    return { providerId: `recorded:${message.idempotencyKey}` };
  }
}

export interface ResendConfig {
  apiKey: string;
  /** `Cubekrafts <hello@cubekrafts.com>` — must be a verified domain. */
  from: string;
  replyTo?: string;
}

/**
 * Resend.
 *
 * Chosen because the free tier covers this volume and because it takes an
 * idempotency key, which is what makes a retry safe rather than merely
 * unlikely to duplicate.
 */
export class ResendTransport implements Transport {
  readonly name = 'resend';

  constructor(private readonly config: ResendConfig) {}

  async send(message: Outbound): Promise<Sent> {
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          subject: message.subject,
          text: message.body,
          ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // A network failure or a timeout says nothing about whether the message
      // went out, which is exactly why the idempotency key matters.
      throw new TransportError(err instanceof Error ? err.message : 'network failure', true);
    }

    const text = await response.text();
    if (!response.ok) {
      // 4xx is our mistake and will fail again identically; 5xx and 429 are
      // theirs and may not.
      const retryable = response.status >= 500 || response.status === 429;
      throw new TransportError(`resend refused it (${response.status}): ${text.slice(0, 300)}`, retryable);
    }

    let parsed: { id?: string };
    try {
      parsed = JSON.parse(text) as { id?: string };
    } catch {
      throw new TransportError('resend returned something that was not JSON', false);
    }
    if (!parsed.id) throw new TransportError('resend accepted it but returned no id', false);
    return { providerId: parsed.id };
  }
}

/** Build a transport from the environment, or the recording one if unconfigured. */
export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): Transport {
  const apiKey = env['RESEND_API_KEY'];
  const from = env['EMAIL_FROM'];
  if (!apiKey || !from) return new RecordingTransport();
  return new ResendTransport({
    apiKey,
    from,
    ...(env['EMAIL_REPLY_TO'] ? { replyTo: env['EMAIL_REPLY_TO'] } : {}),
  });
}
