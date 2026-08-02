import { post } from './api.js';

/**
 * The browser half of the two ceremonies.
 *
 * Written out rather than pulled from a library because it is forty lines of
 * base64url and one API call, and shipping a dependency would mean either a
 * build step or a vendored bundle — both of which make `script-src 'self'`
 * harder to believe than it is now.
 */

export const supported = () =>
  typeof PublicKeyCredential !== 'undefined' && Boolean(navigator.credentials);

/** Whether the device can do it without a second gadget — a phone, a laptop. */
export async function hasPlatformAuthenticator() {
  if (!supported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function toBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toText(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The JSON the server sends is base64url; `navigator.credentials` wants bytes. */
function inflate(options) {
  return {
    ...options,
    challenge: toBytes(options.challenge),
    ...(options.user ? { user: { ...options.user, id: toBytes(options.user.id) } } : {}),
    ...(options.excludeCredentials
      ? {
          excludeCredentials: options.excludeCredentials.map((c) => ({
            ...c,
            id: toBytes(c.id),
          })),
        }
      : {}),
    ...(options.allowCredentials
      ? {
          allowCredentials: options.allowCredentials.map((c) => ({ ...c, id: toBytes(c.id) })),
        }
      : {}),
  };
}

function deflateRegistration(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: toText(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: toText(r.clientDataJSON),
      attestationObject: toText(r.attestationObject),
      transports: r.getTransports?.() ?? [],
    },
  };
}

function deflateAuthentication(credential) {
  const r = credential.response;
  return {
    id: credential.id,
    rawId: toText(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: toText(r.clientDataJSON),
      authenticatorData: toText(r.authenticatorData),
      signature: toText(r.signature),
      userHandle: r.userHandle ? toText(r.userHandle) : undefined,
    },
  };
}

/**
 * A cancelled prompt is not a failure worth a red banner — the owner pressed
 * escape. Everything else is.
 */
export class Cancelled extends Error {}

function rethrow(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
    throw new Cancelled('cancelled');
  }
  throw err;
}

export async function register({ label } = {}) {
  const { challengeId, options } = await post('/api/auth/register/begin', {});
  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey: inflate(options) });
  } catch (err) {
    rethrow(err);
  }
  if (!credential) throw new Cancelled('cancelled');

  return post('/api/auth/register/finish', {
    challengeId,
    response: deflateRegistration(credential),
    ...(label ? { label } : {}),
  });
}

export async function signIn() {
  const { challengeId, options } = await post('/api/auth/signin/begin', {});
  let credential;
  try {
    credential = await navigator.credentials.get({ publicKey: inflate(options) });
  } catch (err) {
    rethrow(err);
  }
  if (!credential) throw new Cancelled('cancelled');

  return post('/api/auth/signin/finish', {
    challengeId,
    response: deflateAuthentication(credential),
  });
}
