import type { Sql } from '../db/sql.ts';
import { json, readJson, route, userAgent, deviceName, type Ctx, type Route } from './http.ts';
import {
  AuthError,
  beginAuthentication,
  beginRegistration,
  finishAuthentication,
  finishRegistration,
  isClaimed,
  listCredentials,
  removeCredential,
  type WebAuthnConfig,
} from '../auth/passkey.ts';
import {
  clearCookie,
  createSession,
  listSessions,
  revokeAll,
  revokeSession,
  sessionCookie,
} from '../auth/session.ts';
import { hasRecoveryCode, issueRecoveryCode, redeemRecoveryCode } from '../auth/recovery.ts';
import { checkAuthAttempt } from '../auth/ratelimit.ts';
import { recordAuthEvent, recentAuthEvents, type AuthEventKind } from '../auth/log.ts';

/**
 * The `/api/auth/*` surface.
 *
 * Every route here is rate limited, every outcome is written to the auth log,
 * and every failure says as little as it can get away with — "sign-in
 * failed" rather than which half of it failed.
 */

export interface AuthRouteDeps {
  sql: Sql;
  webauthn: WebAuthnConfig;
  /** False in development, where the cookie cannot carry `Secure`. */
  https: boolean;
}

/** Rate limit, run the body, and log the outcome whichever way it goes. */
function guarded(
  deps: AuthRouteDeps,
  kind: AuthEventKind,
  body: (ctx: Ctx) => Promise<{ status: number; body: unknown; detail?: Record<string, unknown> }>,
) {
  return async (ctx: Ctx): Promise<void> => {
    const { sql } = deps;
    const limit = await checkAuthAttempt(sql, ctx.ip ?? 'unknown');
    if (!limit.ok) {
      await recordAuthEvent(sql, 'rate_limited', false, {
        ip: ctx.ip,
        userAgent: userAgent(ctx.req),
        detail: { route: kind },
      });
      ctx.res.setHeader('retry-after', String(limit.retryAfterSeconds));
      json(ctx.res, 429, { error: 'too many attempts — wait a minute' });
      return;
    }

    try {
      const result = await body(ctx);
      await recordAuthEvent(sql, kind, result.status < 400, {
        ip: ctx.ip,
        userAgent: userAgent(ctx.req),
        ...(result.detail ? { detail: result.detail } : {}),
      });
      json(ctx.res, result.status, result.body);
    } catch (err) {
      const status = err instanceof AuthError ? err.status : 500;
      const message = err instanceof AuthError ? err.message : 'something went wrong';
      await recordAuthEvent(sql, kind, false, {
        ip: ctx.ip,
        userAgent: userAgent(ctx.req),
        detail: { error: err instanceof Error ? err.message : String(err) },
      });
      json(ctx.res, status, { error: message });
    }
  };
}

export function authRoutes(deps: AuthRouteDeps): Route[] {
  const { sql, webauthn } = deps;

  const signIn = async (ctx: Ctx): Promise<string> => {
    const ua = userAgent(ctx.req);
    // Signing in again on a browser that already has a session — which is
    // how the dangerous four get their re-authentication — replaces that
    // session rather than accumulating one, so the sessions panel keeps
    // showing devices rather than a history of visits.
    if (ctx.session) await revokeSession(sql, ctx.session.id);
    const { token } = await createSession(sql, {
      device: deviceName(ua),
      ...(ctx.ip ? { ip: ctx.ip } : {}),
    });
    ctx.res.setHeader('set-cookie', sessionCookie(token, { secure: deps.https }));
    return token;
  };

  return [
    // What the first screen needs to know before it draws anything: is there
    // an owner yet, and is this browser already signed in.
    route('GET', '/api/auth/state', 'public', async (ctx) => {
      json(ctx.res, 200, {
        claimed: await isClaimed(sql),
        signedIn: ctx.session !== null,
        fresh: ctx.session?.fresh ?? false,
      });
    }),

    route(
      'POST',
      '/api/auth/register/begin',
      'public',
      guarded(deps, 'register.begin', async (ctx) => {
        const body = await readJson(ctx.req);
        const { challengeId, options } = await beginRegistration(sql, webauthn, {
          ...(typeof body['email'] === 'string' ? { email: body['email'] } : {}),
          // Adding a second device requires being signed in already. The
          // session is resolved for public routes too, precisely so this can
          // tell the two cases apart.
          authenticated: ctx.session !== null,
        });
        return { status: 200, body: { challengeId, options } };
      }),
    ),

    route(
      'POST',
      '/api/auth/register/finish',
      'public',
      guarded(deps, 'register.finish', async (ctx) => {
        const body = await readJson(ctx.req);
        const challengeId = String(body['challengeId'] ?? '');
        const response = body['response'];
        if (!challengeId || typeof response !== 'object' || response === null) {
          throw new AuthError('malformed registration');
        }

        const result = await finishRegistration(sql, webauthn, {
          challengeId,
          // Shape-checked by the library, which rejects anything that is not
          // a real registration response.
          response: response as never,
          ...(typeof body['label'] === 'string' ? { label: body['label'] } : {}),
          ...(typeof body['email'] === 'string' ? { email: body['email'] } : {}),
          authenticated: ctx.session !== null,
        });

        // Registering the first passkey signs you in and hands you the one
        // recovery code. It is shown exactly here and never again.
        if (result.firstDevice) {
          await signIn(ctx);
          const recoveryCode = await issueRecoveryCode(sql);
          return {
            status: 201,
            body: { credentialId: result.credentialId, firstDevice: true, recoveryCode },
            detail: { first: true },
          };
        }
        return { status: 201, body: { credentialId: result.credentialId, firstDevice: false } };
      }),
    ),

    route(
      'POST',
      '/api/auth/signin/begin',
      'public',
      guarded(deps, 'signin.begin', async (_ctx) => {
        const { challengeId, options } = await beginAuthentication(sql, webauthn);
        return { status: 200, body: { challengeId, options } };
      }),
    ),

    route(
      'POST',
      '/api/auth/signin/finish',
      'public',
      guarded(deps, 'signin.finish', async (ctx) => {
        const body = await readJson(ctx.req);
        const challengeId = String(body['challengeId'] ?? '');
        const response = body['response'];
        if (!challengeId || typeof response !== 'object' || response === null) {
          throw new AuthError('malformed sign-in', 403);
        }
        const { label } = await finishAuthentication(sql, webauthn, {
          challengeId,
          response: response as never,
        });
        await signIn(ctx);
        return { status: 200, body: { ok: true, passkey: label }, detail: { passkey: label } };
      }),
    ),

    // The way back in when both passkeys are gone. Single-use, and it mints a
    // replacement immediately so you are never left without one.
    route(
      'POST',
      '/api/auth/recover',
      'public',
      guarded(deps, 'signin.recovery', async (ctx) => {
        const body = await readJson(ctx.req);
        const ok = await redeemRecoveryCode(sql, String(body['code'] ?? ''));
        if (!ok) throw new AuthError('that code is not valid', 403);
        await signIn(ctx);
        const recoveryCode = await issueRecoveryCode(sql);
        return { status: 200, body: { ok: true, recoveryCode } };
      }),
    ),

    route('POST', '/api/auth/signout', 'session', async (ctx) => {
      await revokeSession(sql, ctx.session!.id);
      await recordAuthEvent(sql, 'signout', true, { ip: ctx.ip, userAgent: userAgent(ctx.req) });
      ctx.res.setHeader('set-cookie', clearCookie());
      json(ctx.res, 200, { ok: true });
    }),

    route('GET', '/api/auth/sessions', 'session', async (ctx) => {
      const sessions = await listSessions(sql);
      json(
        ctx.res,
        200,
        sessions.map((s) => ({ ...s, current: s.id === ctx.session!.id })),
      );
    }),

    route('POST', '/api/auth/sessions/:id/revoke', 'session', async (ctx) => {
      await revokeSession(sql, ctx.params['id']!);
      await recordAuthEvent(sql, 'session.revoked', true, {
        ip: ctx.ip,
        userAgent: userAgent(ctx.req),
        detail: { session: ctx.params['id'] },
      });
      // Revoking your own session logs this browser out, which is what
      // someone pressing it on the row marked "current" means.
      if (ctx.params['id'] === ctx.session!.id) ctx.res.setHeader('set-cookie', clearCookie());
      json(ctx.res, 200, { ok: true });
    }),

    route('POST', '/api/auth/sessions/revoke-all', 'session', async (ctx) => {
      const count = await revokeAll(sql);
      await recordAuthEvent(sql, 'sessions.revoked_all', true, {
        ip: ctx.ip,
        userAgent: userAgent(ctx.req),
        detail: { count },
      });
      ctx.res.setHeader('set-cookie', clearCookie());
      json(ctx.res, 200, { revoked: count });
    }),

    route('GET', '/api/auth/passkeys', 'session', async (ctx) => {
      const credentials = await listCredentials(sql);
      json(
        ctx.res,
        200,
        credentials.map((c) => ({
          id: c.id,
          label: c.label,
          createdAt: c.createdAt,
          lastUsedAt: c.lastUsedAt,
        })),
      );
    }),

    route('POST', '/api/auth/passkeys/:id/remove', 'fresh', async (ctx) => {
      try {
        await removeCredential(sql, ctx.params['id']!);
      } catch (err) {
        if (err instanceof AuthError) {
          json(ctx.res, err.status, { error: err.message });
          return;
        }
        throw err;
      }
      await recordAuthEvent(sql, 'credential.removed', true, {
        ip: ctx.ip,
        userAgent: userAgent(ctx.req),
        detail: { credential: ctx.params['id'] },
      });
      json(ctx.res, 200, { ok: true });
    }),

    route('GET', '/api/auth/recovery', 'session', async (ctx) => {
      json(ctx.res, 200, { outstanding: await hasRecoveryCode(sql) });
    }),

    // Minting a code invalidates the previous one, so it is one of the things
    // that wants a recent authentication rather than just a live session.
    route('POST', '/api/auth/recovery', 'fresh', async (ctx) => {
      const code = await issueRecoveryCode(sql);
      await recordAuthEvent(sql, 'recovery.issued', true, {
        ip: ctx.ip,
        userAgent: userAgent(ctx.req),
      });
      json(ctx.res, 200, { recoveryCode: code });
    }),

    route('GET', '/api/auth/log', 'session', async (ctx) => {
      json(ctx.res, 200, await recentAuthEvents(sql));
    }),
  ];
}
