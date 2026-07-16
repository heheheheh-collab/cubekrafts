// Password hashing (scrypt) and HMAC-signed bearer tokens — node:crypto only.

import { scryptSync, timingSafeEqual, randomBytes, createHmac, randomUUID } from 'node:crypto';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function signToken(secret, userId) {
  const payload = `${userId}.${Date.now() + TOKEN_TTL_MS}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const payload = Buffer.from(payloadB64, 'base64url').toString();
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, expStr] = payload.split('.');
  if (Date.now() > Number(expStr)) return null;
  return userId;
}

export const newId = () => randomUUID();
