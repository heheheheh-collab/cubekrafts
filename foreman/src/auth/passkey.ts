import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Sql } from '../db/sql.ts';
import { id } from '../db/repo.ts';

/**
 * Passkeys.
 *
 * Two ceremonies, each in two halves. The server picks the challenge, writes
 * it down, and will accept it exactly once — a challenge the client could
 * choose, reuse, or outlive is not a challenge.
 *
 * The half-to-half handle is the challenge row's id. The client holds it and
 * hands it back, which is safe: knowing an id gets you nothing without a
 * signature over the value that id points at, and the id is what keeps two
 * browser tabs from consuming each other's ceremony.
 *
 * There is exactly one owner. Registration is allowed in precisely two
 * situations: nobody is registered yet, or someone already signed in is
 * adding another device. There is no third path, and therefore no code path
 * that creates a second identity.
 */

export interface WebAuthnConfig {
  /** Bare domain, no scheme, no port: `foreman.example.com`. */
  rpID: string;
  rpName: string;
  /** Full origin the browser will report, including scheme and any port. */
  origin: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): WebAuthnConfig {
  const origin = env['FOREMAN_ORIGIN'] ?? 'http://localhost:7777';
  return {
    origin,
    rpID: env['FOREMAN_RP_ID'] ?? new URL(origin).hostname,
    rpName: env['FOREMAN_RP_NAME'] ?? 'Foreman',
  };
}

/** Anything the caller did wrong, or an authenticator that failed to prove itself. */
export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const CHALLENGE_TTL_SECONDS = 300;

async function storeChallenge(
  sql: Sql,
  purpose: 'register' | 'authenticate',
  challenge: string,
): Promise<string> {
  const challengeId = id('chal');
  await sql.query(
    `INSERT INTO auth_challenge (id, purpose, challenge, expires_at)
          VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [challengeId, purpose, challenge, CHALLENGE_TTL_SECONDS],
  );
  return challengeId;
}

/**
 * Consume a challenge, or refuse.
 *
 * One statement, so two requests racing on the same handle cannot both come
 * away believing they claimed it. Expiry is evaluated by the database clock,
 * not this process's.
 */
async function claimChallenge(
  sql: Sql,
  challengeId: string,
  purpose: 'register' | 'authenticate',
): Promise<string> {
  const { rows } = await sql.query<{ challenge: string }>(
    `UPDATE auth_challenge SET used_at = now()
      WHERE id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING challenge`,
    [challengeId, purpose],
  );
  const row = rows[0];
  if (!row) throw new AuthError('that sign-in attempt has expired — start again');
  return row.challenge;
}

export async function ownerId(sql: Sql): Promise<string | null> {
  const { rows } = await sql.query<{ id: string }>(`SELECT id FROM owner LIMIT 1`);
  return rows[0]?.id ?? null;
}

export interface StoredCredential {
  id: string;
  /**
   * The generic parameter is not decoration: the library's own type pins the
   * backing buffer to `ArrayBuffer`, and a bare `Uint8Array` now widens to
   * `ArrayBufferLike`, which includes `SharedArrayBuffer` and will not pass.
   */
  publicKey: Uint8Array<ArrayBuffer>;
  signCount: number;
  label: string;
  transports: AuthenticatorTransportFuture[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listCredentials(sql: Sql): Promise<StoredCredential[]> {
  const { rows } = await sql.query<{
    id: string;
    public_key: Buffer;
    sign_count: string | number;
    label: string;
    transports: string[] | null;
    created_at: Date;
    last_used_at: Date | null;
  }>(
    `SELECT id, public_key, sign_count, label, transports, created_at, last_used_at
       FROM credential ORDER BY created_at`,
  );
  return rows.map((r) => ({
    id: r.id,
    publicKey: Uint8Array.from(r.public_key),
    // BIGINT arrives as a string from `pg`, because it does not fit a double
    // in general. Sign counts do fit, so narrowing here is safe.
    signCount: Number(r.sign_count),
    label: r.label,
    transports: (r.transports ?? []) as AuthenticatorTransportFuture[],
    createdAt: new Date(r.created_at),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
  }));
}

/** Whether anyone at all can sign in yet. Drives the first-run screen. */
export async function isClaimed(sql: Sql): Promise<boolean> {
  return (await ownerId(sql)) !== null;
}

// ── registration ────────────────────────────────────────────────────────────

export interface BeginRegistrationOpts {
  /** Only used when nobody is registered yet; ignored on later devices. */
  email?: string;
  /** True when an already-signed-in owner is adding a device. */
  authenticated?: boolean;
}

export async function beginRegistration(
  sql: Sql,
  config: WebAuthnConfig,
  opts: BeginRegistrationOpts = {},
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const existing = await ownerId(sql);
  if (existing !== null && !opts.authenticated) {
    // The single most important refusal in the file. Without it the setup
    // route is a signup route.
    throw new AuthError('this Foreman already has an owner', 403);
  }

  const credentials = existing === null ? [] : await listCredentials(sql);
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: opts.email ?? 'owner',
    userDisplayName: 'Owner',
    attestationType: 'none',
    // Stops the same authenticator being enrolled twice, which would leave
    // two rows the sessions panel cannot tell apart.
    excludeCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  const challengeId = await storeChallenge(sql, 'register', options.challenge);
  return { challengeId, options };
}

export interface FinishRegistrationOpts {
  challengeId: string;
  response: RegistrationResponseJSON;
  label?: string;
  email?: string;
  authenticated?: boolean;
}

export async function finishRegistration(
  sql: Sql,
  config: WebAuthnConfig,
  opts: FinishRegistrationOpts,
): Promise<{ credentialId: string; firstDevice: boolean }> {
  const existing = await ownerId(sql);
  if (existing !== null && !opts.authenticated) {
    throw new AuthError('this Foreman already has an owner', 403);
  }

  const expectedChallenge = await claimChallenge(sql, opts.challengeId, 'register');

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: opts.response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    // The library throws for a malformed or mismatched response. That is a
    // rejection, not a server fault, so it must not surface as a 500.
    throw new AuthError(err instanceof Error ? err.message : 'registration failed');
  }
  if (!verification.verified) throw new AuthError('registration could not be verified');

  const { credential, credentialBackedUp } = verification.registrationInfo;

  // Re-read the owner rather than trusting the value from before the network
  // round trip: two first-run tabs could otherwise both think they are first.
  const owner = existing ?? id('owner');
  if (existing === null) {
    const { rows } = await sql.query<{ id: string }>(
      `INSERT INTO owner (id, email) VALUES ($1, $2)
       ON CONFLICT ((singleton)) DO NOTHING RETURNING id`,
      [owner, opts.email ?? 'owner@localhost'],
    );
    if (rows.length === 0) {
      throw new AuthError('this Foreman already has an owner', 403);
    }
  }

  await sql.query(
    `INSERT INTO credential (id, owner_id, public_key, sign_count, label, transports)
          VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      credential.id,
      owner,
      Buffer.from(credential.publicKey),
      credential.counter,
      opts.label ?? (credentialBackedUp ? 'Synced passkey' : 'Device passkey'),
      credential.transports ?? [],
    ],
  );

  return { credentialId: credential.id, firstDevice: existing === null };
}

// ── authentication ──────────────────────────────────────────────────────────

export async function beginAuthentication(
  sql: Sql,
  config: WebAuthnConfig,
): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  if (!(await isClaimed(sql))) throw new AuthError('nobody has set this Foreman up yet', 404);

  const credentials = await listCredentials(sql);
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: credentials.map((c) => ({ id: c.id, transports: c.transports })),
    userVerification: 'required',
  });

  const challengeId = await storeChallenge(sql, 'authenticate', options.challenge);
  return { challengeId, options };
}

export async function finishAuthentication(
  sql: Sql,
  config: WebAuthnConfig,
  opts: { challengeId: string; response: AuthenticationResponseJSON },
): Promise<{ credentialId: string; label: string }> {
  const expectedChallenge = await claimChallenge(sql, opts.challengeId, 'authenticate');

  const credentials = await listCredentials(sql);
  const stored = credentials.find((c) => c.id === opts.response.id);
  if (!stored) throw new AuthError('that passkey is not registered here', 403);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: opts.response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: stored.id,
        publicKey: stored.publicKey,
        counter: stored.signCount,
        transports: stored.transports,
      },
    });
  } catch (err) {
    throw new AuthError(err instanceof Error ? err.message : 'sign-in failed', 403);
  }
  if (!verification.verified) throw new AuthError('sign-in could not be verified', 403);

  // The counter is the authenticator's own replay defence: a signature that
  // arrives with a count no higher than the last one is a copy. The library
  // rejects it above; persisting the new value is what makes that true next
  // time. `GREATEST` keeps a reordered pair of requests from winding it back.
  await sql.query(
    `UPDATE credential SET sign_count = GREATEST(sign_count, $2), last_used_at = now()
      WHERE id = $1`,
    [stored.id, verification.authenticationInfo.newCounter],
  );

  return { credentialId: stored.id, label: stored.label };
}

/** Remove a passkey — but never the last one, which would lock the owner out. */
export async function removeCredential(sql: Sql, credentialId: string): Promise<void> {
  const credentials = await listCredentials(sql);
  if (credentials.length <= 1) {
    throw new AuthError('that is the only passkey — register another before removing this one');
  }
  if (!credentials.some((c) => c.id === credentialId)) {
    throw new AuthError('no such passkey', 404);
  }
  await sql.query(`DELETE FROM credential WHERE id = $1`, [credentialId]);
}

/** Drop challenges nobody can still be inside. Called on a timer. */
export async function sweepChallenges(sql: Sql): Promise<number> {
  const { rows } = await sql.query<{ id: string }>(
    `DELETE FROM auth_challenge WHERE expires_at < now() - make_interval(secs => 3600) RETURNING id`,
  );
  return rows.length;
}
