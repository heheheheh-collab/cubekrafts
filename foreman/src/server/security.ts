import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Security headers and cross-site request defence.
 *
 * These are cheap and they are the layer that holds when something else has
 * already gone wrong: a stray script tag, a page framed inside somebody
 * else's, a form posted from a site the owner happened to have open.
 */

export interface SecurityConfig {
  /** The origin this app is served from. State-changing requests must claim it. */
  origin: string;
  /** Off in development, where there is no TLS to insist on. */
  https: boolean;
}

/**
 * The policy is strict because the UI is ours end to end: no CDN, no
 * analytics, no fonts from elsewhere. `'self'` covers everything the page
 * legitimately needs, so anything injected has nowhere to phone home.
 */
export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    // The event stream is same-origin; nothing else should be reachable.
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function applySecurityHeaders(res: ServerResponse, config: SecurityConfig): void {
  res.setHeader('content-security-policy', contentSecurityPolicy());
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  // WebAuthn needs `publickey-credentials-get`; nothing else is wanted.
  res.setHeader(
    'permissions-policy',
    'camera=(), geolocation=(), microphone=(self), payment=(), usb=(), publickey-credentials-get=(self)',
  );
  if (config.https) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface OriginCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Refuse a state-changing request that does not claim our own origin.
 *
 * `SameSite=Lax` already stops a cross-site form post from carrying the
 * session cookie, so this is the second lock rather than the first. It is
 * worth having because `Lax` has edges — older browsers, and the two-minute
 * window some of them allow after a top-level POST — and because checking a
 * header the attacker's page cannot forge is nearly free.
 *
 * A missing `Origin` on a state-changing request is refused rather than
 * waved through: browsers send it on every fetch and every cross-site form
 * post, so absence means something that is not a browser, and that thing can
 * present a header if it wants in.
 */
export function checkOrigin(req: IncomingMessage, config: SecurityConfig): OriginCheck {
  if (SAFE_METHODS.has(req.method ?? 'GET')) return { ok: true };

  const origin = header(req, 'origin');
  if (origin) {
    return origin === config.origin
      ? { ok: true }
      : { ok: false, reason: `request came from ${origin}` };
  }

  // Some clients omit Origin but send Referer. Accept it, compared by origin
  // rather than by prefix, so `https://evil.com/?x=https://ours` cannot pass.
  const referer = header(req, 'referer');
  if (referer) {
    try {
      return new URL(referer).origin === config.origin
        ? { ok: true }
        : { ok: false, reason: `request was referred from ${new URL(referer).origin}` };
    } catch {
      return { ok: false, reason: 'unreadable referer' };
    }
  }

  return { ok: false, reason: 'no origin on a state-changing request' };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
