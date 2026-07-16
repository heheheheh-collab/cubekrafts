// Cold Trail web server — zero-dependency Node HTTP server.
//   node apps/server/server.js  (PORT env var, default 5177)
// Serves the static web app, the JSON API, and per-session SSE streams.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './lib/db.js';
import { hashPassword, verifyPassword, signToken, verifyToken, newId } from './lib/auth.js';
import { createSessionManager, httpError } from './lib/sessions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, '../web');
const PORT = Number(process.env.PORT || 5177);

const db = openDb(process.env.COLDTRAIL_DB || join(__dirname, 'data/coldtrail-db.json'));
const games = createSessionManager(db);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'same-origin');
    res.setHeader('content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(url.pathname, res);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err.status ? err.message : 'Internal server error' });
  }
});

// Basic per-IP throttle on credential endpoints (public hosting hygiene).
const authHits = new Map();
function throttleAuth(req) {
  const ip = (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())
    || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const rec = authHits.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 10 * 60 * 1000; }
  rec.count += 1;
  authHits.set(ip, rec);
  if (authHits.size > 10_000) authHits.clear();
  if (rec.count > 30) throw httpError(429, 'Too many attempts — take a breath, detective.');
}

// ---------------------------------------------------------------- static ----

async function serveStatic(pathname, res) {
  let rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\]|\.\.)+/, '');
  if (rel === '' || rel === '.') rel = 'index.html';
  let file = join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT)) throw httpError(403, 'Forbidden');
  if (!existsSync(file)) file = join(WEB_ROOT, 'index.html'); // SPA fallback
  const body = await readFile(file);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(body);
}

// ------------------------------------------------------------------- api ----

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};

  // -- auth (public) --
  if (route === 'POST /api/register' || route === 'POST /api/login') throttleAuth(req);
  if (route === 'POST /api/register') {
    const { handle, password } = body;
    if (!handle || !/^[\w .-]{2,24}$/.test(handle)) throw httpError(400, 'Handle must be 2–24 letters, numbers, spaces, dots or dashes.');
    if (!password || password.length < 6) throw httpError(400, 'Password must be at least 6 characters.');
    if (db.findUserByHandle(handle)) throw httpError(409, 'That handle is taken.');
    const user = db.createUser({ id: newId(), handle: handle.trim(), passwordHash: hashPassword(password), createdAt: Date.now() });
    return sendJson(res, 201, { token: signToken(db.secret, user.id), user: { id: user.id, handle: user.handle } });
  }
  if (route === 'POST /api/login') {
    const { handle, password } = body;
    const user = handle && db.findUserByHandle(handle);
    if (!user || !verifyPassword(password || '', user.passwordHash)) throw httpError(401, 'Wrong handle or password.');
    return sendJson(res, 200, { token: signToken(db.secret, user.id), user: { id: user.id, handle: user.handle } });
  }
  if (route === 'GET /api/daily/leaderboard') {
    const day = new Date().toISOString().slice(0, 10);
    const rows = db.resultsFor((r) => r.daily === day)
      .sort((a, b) => b.score - a.score || a.durationMs - b.durationMs)
      .slice(0, 20)
      .map((r) => ({ handle: r.handle, score: r.score, durationMs: r.durationMs }));
    return sendJson(res, 200, { day, rows });
  }

  // -- everything below requires auth --
  const user = authenticate(req, url);

  if (route === 'GET /api/me') {
    return sendJson(res, 200, { user: { id: user.id, handle: user.handle } });
  }

  if (route === 'POST /api/sessions') {
    const mode = ['solo', 'coop', 'versus'].includes(body.mode) ? body.mode : 'solo';
    const tier = ['rookie', 'detective'].includes(body.tier) ? body.tier : 'detective';
    const s = games.create({ hostId: user.id, hostName: user.handle, mode, tier });
    return sendJson(res, 201, games.publicState(s, user.id));
  }
  if (route === 'POST /api/sessions/join') {
    const s = games.getByCode(body.code || '');
    games.join(s, user.id, user.handle);
    return sendJson(res, 200, games.publicState(s, user.id));
  }
  if (route === 'POST /api/daily') {
    const s = games.startDaily(user.id, user.handle);
    return sendJson(res, 201, games.publicState(s, user.id));
  }

  const m = url.pathname.match(/^\/api\/sessions\/([\w-]+)(\/[\w-]+)?$/);
  if (m) {
    const s = games.get(m[1]);
    const sub = m[2] || '';
    if (req.method === 'GET' && sub === '') {
      return sendJson(res, 200, games.publicState(s, user.id));
    }
    if (req.method === 'GET' && sub === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      games.attachClient(s, user.id, res);
      return; // stream stays open
    }
    if (req.method === 'POST' && sub === '/start') {
      games.start(s, user.id);
      return sendJson(res, 200, games.publicState(s, user.id));
    }
    if (req.method === 'POST' && sub === '/read') {
      games.markRead(s, user.id, String(body.docId || ''));
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && sub === '/chat') {
      if (!body.text || !String(body.text).trim()) throw httpError(400, 'Empty message.');
      games.postChat(s, user.id, String(body.text).trim());
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && sub === '/board') {
      games.updateBoard(s, user.id, String(body.suspectId || ''), body.patch || {});
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && sub === '/accuse') {
      const verdict = games.accuse(s, user.id, body);
      return sendJson(res, 200, verdict);
    }
    if (req.method === 'POST' && sub === '/warrant') {
      return sendJson(res, 200, games.requestWarrant(s, user.id, body));
    }
    if (req.method === 'POST' && sub === '/lab') {
      return sendJson(res, 200, games.requestLab(s, user.id, body));
    }
    if (req.method === 'POST' && sub === '/cctv') {
      return sendJson(res, 200, games.requestCctv(s, user.id, body));
    }
    if (req.method === 'POST' && sub === '/interrogate') {
      return sendJson(res, 200, games.interrogate(s, user.id, body));
    }
  }

  throw httpError(404, 'No such endpoint.');
}

function authenticate(req, url) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
  const userId = verifyToken(db.secret, token);
  const user = userId && db.findUserById(userId);
  if (!user) throw httpError(401, 'Sign in first.');
  return user;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(httpError(413, 'Body too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { reject(httpError(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

server.listen(PORT, () => {
  console.log(`Cold Trail listening on http://localhost:${PORT}`);
});
