import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import {
  COOKIE,
  FRESH_MINUTES,
  createSession,
  verifySession,
  revokeSession,
  revokeAll,
  listSessions,
  sessionCookie,
  clearCookie,
  readCookie,
  safeEqual,
} from '../src/auth/session.ts';
import { AUTH_LIMITS, checkAuthAttempt, hit, sweep } from '../src/auth/ratelimit.ts';
import {
  issueRecoveryCode,
  redeemRecoveryCode,
  hasRecoveryCode,
  normalise,
} from '../src/auth/recovery.ts';
import {
  AuthError,
  beginAuthentication,
  beginRegistration,
  finishAuthentication,
  finishRegistration,
  isClaimed,
  listCredentials,
  removeCredential,
  configFromEnv,
  sweepChallenges,
  type WebAuthnConfig,
} from '../src/auth/passkey.ts';
import { checkOrigin, contentSecurityPolicy, applySecurityHeaders } from '../src/server/security.ts';
import { clientIp, recordAuthEvent, recentAuthEvents } from '../src/auth/log.ts';
import { deviceName } from '../src/server/http.ts';

/**
 * Authentication, against a real Postgres.
 *
 * The WebAuthn signatures themselves are the library's problem and are
 * covered by its own suite; what is tested here is everything around them —
 * the single-owner rule, the single-use challenge, the counters, the rate
 * limiter, the recovery code, and the cross-site defence. Those are the parts
 * that are mine to get wrong.
 */

let pg: PGlite;

const config: WebAuthnConfig = {
  rpID: 'localhost',
  rpName: 'Foreman test',
  origin: 'http://localhost:7777',
};

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg, defaultMigrationsDir());
}, 120_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM auth_challenge; DELETE FROM rate_counter; DELETE FROM auth_event;
    DELETE FROM session; DELETE FROM recovery_code; DELETE FROM credential; DELETE FROM owner;
  `);
});

// ── sessions ────────────────────────────────────────────────────────────────

describe('sessions', () => {
  it('accepts the token it issued and nothing else', async () => {
    const { token, id } = await createSession(pg, { device: 'iPhone' });
    expect(await verifySession(pg, token)).toMatchObject({ id });
    expect(await verifySession(pg, 'not-the-token')).toBeNull();
    expect(await verifySession(pg, undefined)).toBeNull();
  });

  it('stores only a hash, so the table is not a set of keys', async () => {
    const { token } = await createSession(pg);
    const { rows } = await pg.query<{ token_hash: string }>(`SELECT token_hash FROM session`);
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toHaveLength(64);
  });

  it('stops accepting a revoked session immediately', async () => {
    const { token, id } = await createSession(pg);
    await revokeSession(pg, id);
    expect(await verifySession(pg, token)).toBeNull();
  });

  it('revokes every session at once', async () => {
    const a = await createSession(pg);
    const b = await createSession(pg);
    expect(await revokeAll(pg)).toBe(2);
    expect(await verifySession(pg, a.token)).toBeNull();
    expect(await verifySession(pg, b.token)).toBeNull();
    expect(await listSessions(pg)).toHaveLength(0);
  });

  it('refuses one that has sat unused past its window', async () => {
    const { token, id } = await createSession(pg);
    await pg.query(`UPDATE session SET last_seen_at = now() - interval '31 days' WHERE id = $1`, [
      id,
    ]);
    expect(await verifySession(pg, token)).toBeNull();
  });

  it('slides the window on use, so a phone in daily use stays signed in', async () => {
    const { token, id } = await createSession(pg);
    await pg.query(`UPDATE session SET last_seen_at = now() - interval '29 days' WHERE id = $1`, [
      id,
    ]);
    expect(await verifySession(pg, token)).not.toBeNull();

    const { rows } = await pg.query<{ age: number }>(
      `SELECT extract(epoch from now() - last_seen_at) AS age FROM session WHERE id = $1`,
      [id],
    );
    expect(Number(rows[0]!.age)).toBeLessThan(5);
  });

  it('measures freshness from sign-in, not from last use', async () => {
    // The distinction the dangerous four rest on: a browser left open all day
    // is a valid session but not a recent authentication.
    const { token, id } = await createSession(pg);
    expect((await verifySession(pg, token))!.fresh).toBe(true);

    await pg.query(
      `UPDATE session SET created_at = now() - make_interval(mins => $2) WHERE id = $1`,
      [id, FRESH_MINUTES + 1],
    );
    const stale = await verifySession(pg, token);
    expect(stale).not.toBeNull();
    expect(stale!.fresh).toBe(false);
  });
});

describe('the session cookie', () => {
  it('is http-only, same-site, and secure by default', () => {
    const c = sessionCookie('abc');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Secure');
  });

  it('drops Secure only when told to, for plain http in development', () => {
    expect(sessionCookie('abc', { secure: false })).not.toContain('Secure');
  });

  it('expires immediately when cleared', () => {
    expect(clearCookie()).toContain('Max-Age=0');
  });

  it('finds its own cookie among others', () => {
    expect(readCookie(`theme=dark; ${COOKIE}=xyz; other=1`)).toBe('xyz');
    expect(readCookie('theme=dark')).toBeUndefined();
    expect(readCookie(undefined)).toBeUndefined();
  });

  it('is not confused by a cookie whose name ends the same way', () => {
    expect(readCookie(`not_${COOKIE}=wrong; ${COOKIE}=right`)).toBe('right');
  });
});

describe('safeEqual', () => {
  it('compares without leaking length through a throw', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

// ── rate limiting ───────────────────────────────────────────────────────────

describe('rate limiting', () => {
  it('allows the budget and then refuses', async () => {
    const limit = { max: 3, windowSeconds: 60 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(pg, 'b', limit));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
  });

  it('gives the caller a Retry-After worth obeying', async () => {
    const r = await hit(pg, 'b', { max: 1, windowSeconds: 60 });
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('starts a fresh allowance in the next window', async () => {
    const limit = { max: 1, windowSeconds: 60 };
    const now = new Date('2026-01-01T00:00:30Z');
    expect((await hit(pg, 'b', limit, now)).ok).toBe(true);
    expect((await hit(pg, 'b', limit, now)).ok).toBe(false);
    expect((await hit(pg, 'b', limit, new Date('2026-01-01T00:01:05Z'))).ok).toBe(true);
  });

  it('counts each address separately', async () => {
    for (let i = 0; i < AUTH_LIMITS.perIp.max; i++) await checkAuthAttempt(pg, '10.0.0.1');
    expect((await checkAuthAttempt(pg, '10.0.0.1')).ok).toBe(false);
    expect((await checkAuthAttempt(pg, '10.0.0.2')).ok).toBe(true);
  });

  it('still stops an attempt spread across many addresses', async () => {
    // The point of the global bucket: a fresh address must not buy a fresh
    // allowance forever.
    let refused = false;
    for (let i = 0; i < AUTH_LIMITS.global.max + 2; i++) {
      const r = await checkAuthAttempt(pg, `10.0.1.${i}`);
      if (!r.ok) refused = true;
    }
    expect(refused).toBe(true);
  });

  it('survives a restart, because the counter is in the database', async () => {
    const limit = { max: 2, windowSeconds: 60 };
    await hit(pg, 'b', limit);
    await hit(pg, 'b', limit);
    // Nothing in memory to lose — a new caller sees the same count.
    expect((await hit(pg, 'b', limit)).ok).toBe(false);
  });

  it('cannot be raced past its budget', async () => {
    const limit = { max: 5, windowSeconds: 60 };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => hit(pg, 'race', limit)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it('sweeps windows nobody can be inside', async () => {
    await hit(pg, 'old', { max: 1, windowSeconds: 60 }, new Date('2020-01-01T00:00:00Z'));
    await hit(pg, 'new', { max: 1, windowSeconds: 60 });
    expect(await sweep(pg)).toBe(1);
    const { rows } = await pg.query<{ bucket: string }>(`SELECT bucket FROM rate_counter`);
    expect(rows.map((r) => r.bucket)).toEqual(['new']);
  });
});

// ── recovery ────────────────────────────────────────────────────────────────

describe('the recovery code', () => {
  it('is readable, grouped, and free of letters that look like digits', async () => {
    const code = await issueRecoveryCode(pg);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+(-[0-9A-HJKMNP-TV-Z]+){3}$/);
    expect(normalise(code)).not.toMatch(/[ILOU]/);
  });

  it('is stored hashed, so the table is not a way in', async () => {
    const code = await issueRecoveryCode(pg);
    const { rows } = await pg.query<{ hash: string }>(`SELECT hash FROM recovery_code`);
    expect(rows[0]!.hash).not.toContain(normalise(code));
  });

  it('works however it is typed back', async () => {
    const code = await issueRecoveryCode(pg);
    expect(await redeemRecoveryCode(pg, code.toLowerCase().replace(/-/g, ' '))).toBe(true);
  });

  it('spends exactly once', async () => {
    const code = await issueRecoveryCode(pg);
    expect(await redeemRecoveryCode(pg, code)).toBe(true);
    expect(await redeemRecoveryCode(pg, code)).toBe(false);
  });

  it('cannot be redeemed twice by two requests arriving together', async () => {
    const code = await issueRecoveryCode(pg);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => redeemRecoveryCode(pg, code)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('refuses an empty or junk code without touching the table', async () => {
    await issueRecoveryCode(pg);
    expect(await redeemRecoveryCode(pg, '')).toBe(false);
    expect(await redeemRecoveryCode(pg, '----')).toBe(false);
    expect(await redeemRecoveryCode(pg, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ')).toBe(false);
    expect(await hasRecoveryCode(pg)).toBe(true);
  });

  it('supersedes the previous one, so there is only ever one way in', async () => {
    const first = await issueRecoveryCode(pg);
    const second = await issueRecoveryCode(pg);
    expect(await redeemRecoveryCode(pg, first)).toBe(false);
    expect(await redeemRecoveryCode(pg, second)).toBe(true);
  });

  it('knows whether one is outstanding', async () => {
    expect(await hasRecoveryCode(pg)).toBe(false);
    const code = await issueRecoveryCode(pg);
    expect(await hasRecoveryCode(pg)).toBe(true);
    await redeemRecoveryCode(pg, code);
    expect(await hasRecoveryCode(pg)).toBe(false);
  });

  it('is different every time', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(await issueRecoveryCode(pg));
    expect(seen.size).toBe(20);
  });
});

// ── the ceremonies ──────────────────────────────────────────────────────────

async function claimOwner(): Promise<void> {
  await pg.query(`INSERT INTO owner (id, email) VALUES ('own_1', 'owner@example.com')`);
  await pg.query(
    `INSERT INTO credential (id, owner_id, public_key, label) VALUES ('cred_1', 'own_1', '\\x00'::bytea, 'Laptop')`,
  );
}

describe('registration', () => {
  it('offers options and remembers the challenge it chose', async () => {
    const { challengeId, options } = await beginRegistration(pg, config);
    expect(options.challenge).toBeTruthy();
    expect(options.rp.id).toBe('localhost');
    expect(options.authenticatorSelection?.userVerification).toBe('required');

    const { rows } = await pg.query<{ challenge: string; purpose: string }>(
      `SELECT challenge, purpose FROM auth_challenge WHERE id = $1`,
      [challengeId],
    );
    expect(rows[0]).toMatchObject({ challenge: options.challenge, purpose: 'register' });
  });

  it('refuses a second owner — there is no signup', async () => {
    await claimOwner();
    await expect(beginRegistration(pg, config)).rejects.toThrow(/already has an owner/);
    await expect(
      finishRegistration(pg, config, { challengeId: 'x', response: {} as never }),
    ).rejects.toThrow(/already has an owner/);
  });

  it('lets a signed-in owner add a device, and excludes the ones already here', async () => {
    await claimOwner();
    const { options } = await beginRegistration(pg, config, { authenticated: true });
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual(['cred_1']);
  });

  it('answers 403 rather than 400 for the second-owner refusal', async () => {
    await claimOwner();
    await expect(beginRegistration(pg, config)).rejects.toMatchObject({ status: 403 });
  });
});

describe('the challenge', () => {
  it('is spent by the first attempt and gone for the second', async () => {
    const { challengeId } = await beginRegistration(pg, config);
    // A garbage response, so the ceremony fails — but the challenge is still
    // consumed, which is the point: a failed attempt must not leave a live
    // challenge for a second try.
    await expect(
      finishRegistration(pg, config, { challengeId, response: {} as never }),
    ).rejects.toThrow();
    await expect(
      finishRegistration(pg, config, { challengeId, response: {} as never }),
    ).rejects.toThrow(/expired/);
  });

  it('expires', async () => {
    const { challengeId } = await beginRegistration(pg, config);
    await pg.query(`UPDATE auth_challenge SET expires_at = now() - interval '1 second'`);
    await expect(
      finishRegistration(pg, config, { challengeId, response: {} as never }),
    ).rejects.toThrow(/expired/);
  });

  it('cannot be used for the other half of the wrong ceremony', async () => {
    await claimOwner();
    const { challengeId } = await beginAuthentication(pg, config);
    // An authenticate challenge presented to the register route: the purpose
    // is part of the claim, so it does not match.
    await expect(
      finishRegistration(pg, config, { challengeId, response: {} as never, authenticated: true }),
    ).rejects.toThrow(/expired/);
  });

  it('cannot be claimed twice by two requests arriving together', async () => {
    const { challengeId } = await beginRegistration(pg, config);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        finishRegistration(pg, config, { challengeId, response: {} as never }),
      ),
    );
    // Every one fails, but exactly one of them got far enough to fail on the
    // response rather than on the missing challenge.
    const expired = results.filter(
      (r) => r.status === 'rejected' && /expired/.test(String(r.reason)),
    );
    expect(expired).toHaveLength(5);
  });

  it('sweeps long-dead challenges and leaves live ones', async () => {
    await beginRegistration(pg, config);
    await pg.query(
      `INSERT INTO auth_challenge (id, purpose, challenge, expires_at)
            VALUES ('chal_old', 'register', 'x', now() - interval '2 hours')`,
    );
    expect(await sweepChallenges(pg)).toBe(1);
    const { rows } = await pg.query(`SELECT id FROM auth_challenge`);
    expect(rows).toHaveLength(1);
  });
});

describe('authentication', () => {
  it('will not start before anyone has set this up', async () => {
    await expect(beginAuthentication(pg, config)).rejects.toMatchObject({ status: 404 });
  });

  it('offers the registered passkeys once there is an owner', async () => {
    await claimOwner();
    const { options } = await beginAuthentication(pg, config);
    expect(options.allowCredentials?.map((c) => c.id)).toEqual(['cred_1']);
    expect(options.userVerification).toBe('required');
  });

  it('refuses a credential it has never seen, without checking a signature', async () => {
    await claimOwner();
    const { challengeId } = await beginAuthentication(pg, config);
    await expect(
      finishAuthentication(pg, config, {
        challengeId,
        response: { id: 'someone-elses-key' } as never,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('passkeys', () => {
  it('will not let you remove the last one and lock yourself out', async () => {
    await claimOwner();
    await expect(removeCredential(pg, 'cred_1')).rejects.toThrow(/only passkey/);
    expect(await listCredentials(pg)).toHaveLength(1);
  });

  it('removes one when there is a spare', async () => {
    await claimOwner();
    await pg.query(
      `INSERT INTO credential (id, owner_id, public_key, label) VALUES ('cred_2','own_1','\\x00'::bytea,'Phone')`,
    );
    await removeCredential(pg, 'cred_1');
    expect((await listCredentials(pg)).map((c) => c.id)).toEqual(['cred_2']);
  });

  it('404s a passkey that is not there', async () => {
    await claimOwner();
    await pg.query(
      `INSERT INTO credential (id, owner_id, public_key, label) VALUES ('cred_2','own_1','\\x00'::bytea,'Phone')`,
    );
    await expect(removeCredential(pg, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('knows whether anyone has claimed this Foreman', async () => {
    expect(await isClaimed(pg)).toBe(false);
    await claimOwner();
    expect(await isClaimed(pg)).toBe(true);
  });
});

describe('the relying party config', () => {
  it('derives the domain from the origin, port and all', () => {
    expect(configFromEnv({ FOREMAN_ORIGIN: 'https://foreman.example.com' })).toMatchObject({
      rpID: 'foreman.example.com',
      origin: 'https://foreman.example.com',
    });
    // The RP ID is a domain, so the port must not come along with it.
    expect(configFromEnv({ FOREMAN_ORIGIN: 'http://localhost:7777' }).rpID).toBe('localhost');
  });

  it('takes the whole free Fly subdomain as the relying party', () => {
    // `fly.dev` is on the Public Suffix List, so this subdomain is its own
    // registrable domain: a valid RP ID, and cookies no other Fly app can
    // read. Truncating to `fly.dev` would be neither.
    const config = configFromEnv({ FOREMAN_ORIGIN: 'https://cubekrafts-foreman.fly.dev' });
    expect(config.rpID).toBe('cubekrafts-foreman.fly.dev');
    expect(config.origin).toBe('https://cubekrafts-foreman.fly.dev');
  });

  it('produces a secure cookie for that origin and a plain one for localhost', () => {
    const deployed = configFromEnv({ FOREMAN_ORIGIN: 'https://cubekrafts-foreman.fly.dev' });
    expect(sessionCookie('t', { secure: deployed.origin.startsWith('https:') })).toContain('Secure');

    const local = configFromEnv({ FOREMAN_ORIGIN: 'http://localhost:7777' });
    expect(sessionCookie('t', { secure: local.origin.startsWith('https:') })).not.toContain(
      'Secure',
    );
  });
});

// ── cross-site defence ──────────────────────────────────────────────────────

function request(method: string, headers: Record<string, string>): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = method;
  Object.assign(req.headers, headers);
  return req;
}

const security = { origin: 'https://foreman.example.com', https: true };

describe('the origin check', () => {
  it('waves reads through', () => {
    expect(checkOrigin(request('GET', {}), security).ok).toBe(true);
    expect(checkOrigin(request('HEAD', {}), security).ok).toBe(true);
  });

  it('accepts a write from our own page', () => {
    expect(checkOrigin(request('POST', { origin: security.origin }), security).ok).toBe(true);
  });

  it('refuses a write from anywhere else', () => {
    const check = checkOrigin(request('POST', { origin: 'https://evil.example' }), security);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/evil\.example/);
  });

  it('refuses a write with no origin, because browsers always send one', () => {
    expect(checkOrigin(request('POST', {}), security).ok).toBe(false);
  });

  it('falls back to the referer, compared by origin and not by prefix', () => {
    expect(
      checkOrigin(request('POST', { referer: `${security.origin}/settings` }), security).ok,
    ).toBe(true);
    // The classic near-miss: our origin appearing inside somebody else's URL.
    expect(
      checkOrigin(
        request('POST', { referer: `https://evil.example/?next=${security.origin}` }),
        security,
      ).ok,
    ).toBe(false);
  });

  it('refuses an unreadable referer rather than guessing', () => {
    expect(checkOrigin(request('POST', { referer: 'not a url' }), security).ok).toBe(false);
  });
});

describe('security headers', () => {
  it('allows nothing off-origin and no framing', () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('promises HSTS only where there is TLS to promise it about', () => {
    const set: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (set[k] = v) } as never;

    applySecurityHeaders(res, { origin: 'https://x', https: true });
    expect(set['strict-transport-security']).toMatch(/max-age=31536000/);

    const dev: Record<string, string> = {};
    applySecurityHeaders({ setHeader: (k: string, v: string) => (dev[k] = v) } as never, {
      origin: 'http://localhost:7777',
      https: false,
    });
    expect(dev['strict-transport-security']).toBeUndefined();
    expect(dev['x-frame-options']).toBe('DENY');
  });

  it('leaves WebAuthn usable while shutting the rest of the device off', () => {
    const set: Record<string, string> = {};
    applySecurityHeaders({ setHeader: (k: string, v: string) => (set[k] = v) } as never, security);
    expect(set['permissions-policy']).toContain('publickey-credentials-get=(self)');
    expect(set['permissions-policy']).toContain('camera=()');
  });
});

// ── the log ─────────────────────────────────────────────────────────────────

describe('the auth log', () => {
  it('records what happened, newest first', async () => {
    await recordAuthEvent(pg, 'signin.finish', true, { ip: '10.0.0.1', userAgent: 'Safari' });
    await recordAuthEvent(pg, 'signin.finish', false, { ip: '10.0.0.2' });
    const events = await recentAuthEvents(pg);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'signin.finish', ok: false, ip: '10.0.0.2' });
  });

  it('keeps the event even when the address is unusable', async () => {
    // Losing the event to a constraint violation would be worse than losing
    // the address.
    await recordAuthEvent(pg, 'signin.finish', false, { ip: 'not-an-address' });
    const events = await recentAuthEvents(pg);
    expect(events).toHaveLength(1);
    expect(events[0]!.ip).toBeNull();
  });

  it('truncates a user agent long enough to be a payload', async () => {
    await recordAuthEvent(pg, 'signin.begin', true, { userAgent: 'x'.repeat(5000) });
    expect((await recentAuthEvents(pg))[0]!.userAgent).toHaveLength(500);
  });
});

describe('the caller address', () => {
  it('ignores a forwarded-for header when nothing trustworthy set it', () => {
    // Otherwise the per-IP limit is free to bypass: claim a new address each
    // time and the bucket is always empty.
    const req = request('POST', { 'x-forwarded-for': '1.2.3.4' });
    expect(clientIp(req, false)).not.toBe('1.2.3.4');
  });

  it('reads it when a proxy is genuinely in front', () => {
    expect(clientIp(request('POST', { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), true)).toBe(
      '1.2.3.4',
    );
    expect(clientIp(request('POST', { 'fly-client-ip': '5.6.7.8' }), true)).toBe('5.6.7.8');
  });
});

describe('device names', () => {
  it('says enough to tell one row from another', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)')).toBe('Mac');
    expect(deviceName(null)).toBe('Unknown device');
  });
});

describe('AuthError', () => {
  it('carries the status the route should answer with', () => {
    expect(new AuthError('nope').status).toBe(400);
    expect(new AuthError('nope', 403).status).toBe(403);
  });
});
