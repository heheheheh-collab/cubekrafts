// In-memory game session manager: lobbies, co-op squads, versus races,
// shared suspect board, chat, accusation grading and SSE fan-out.
// The full case (including solution + hidden ground truth) lives here on the
// server; clients only ever receive the visible document layer until they
// have legitimately solved the case.

import { generateCase } from '../../../packages/case-engine/src/index.js';
import { MOTIVES, WEAPONS } from '../../../packages/case-engine/src/data/pools.js';
import { newId } from './auth.js';

const VERSUS_LOCKOUT_MS = 3 * 60 * 1000;
const WRONG_ATTEMPT_PENALTY = 15;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function createSessionManager(db) {
  const sessions = new Map(); // id -> session
  const byCode = new Map(); // code -> id

  function makeCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!byCode.has(code)) return code;
    }
  }

  function create({ hostId, hostName, mode, tier }) {
    const id = newId();
    const session = {
      id,
      code: makeCode(),
      mode, // 'solo' | 'coop' | 'versus'
      tier,
      hostId,
      createdAt: Date.now(),
      started: false,
      solved: false,
      winnerId: null,
      caseData: null,
      players: new Map(), // userId -> player
      board: {}, // suspectId -> { means, motive, opportunity, status, note }
      chat: [],
      accusations: [], // public log: { byId, byName, correct, at }
      clients: new Set(), // SSE responses
    };
    sessions.set(id, session);
    byCode.set(session.code, id);
    join(session, hostId, hostName);
    if (mode === 'solo') start(session, hostId);
    return session;
  }

  function join(session, userId, name) {
    if (!session.players.has(userId)) {
      if (session.started && session.mode === 'versus') {
        throw httpError(409, 'This race has already started.');
      }
      session.players.set(userId, {
        id: userId,
        name,
        readDocs: [],
        online: 0,
        lockedUntil: 0,
        wrongAttempts: 0,
        solvedAt: null,
        score: null,
      });
      broadcast(session, 'players', publicPlayers(session));
    }
    return session;
  }

  function start(session, userId) {
    if (session.started) return session;
    if (userId !== session.hostId) throw httpError(403, 'Only the host can open the case.');
    const seed = `${session.code}-${session.createdAt}`;
    session.caseData = generateCase(seed, { tier: session.tier });
    session.started = true;
    session.startedAt = Date.now();
    broadcast(session, 'started', { at: session.startedAt });
    return session;
  }

  function startDaily(userId, name) {
    const day = new Date().toISOString().slice(0, 10);
    const session = create({ hostId: userId, hostName: name, mode: 'solo', tier: 'detective' });
    session.daily = day;
    session.caseData = generateCase(`daily-${day}`, { tier: 'detective' });
    return session;
  }

  function markRead(session, userId, docId) {
    const p = session.players.get(userId);
    if (!p) throw httpError(404, 'Not in this session.');
    if (session.caseData && !p.readDocs.includes(docId)
      && session.caseData.documents.some((d) => d.id === docId)) {
      p.readDocs.push(docId);
      broadcast(session, 'players', publicPlayers(session));
    }
  }

  function postChat(session, userId, text) {
    const p = session.players.get(userId);
    if (!p) throw httpError(404, 'Not in this session.');
    const msg = { byId: userId, byName: p.name, text: String(text).slice(0, 500), at: Date.now() };
    session.chat.push(msg);
    if (session.chat.length > 200) session.chat.shift();
    broadcast(session, 'chat', msg);
  }

  function updateBoard(session, userId, suspectId, patch) {
    if (!session.players.has(userId)) throw httpError(404, 'Not in this session.');
    if (session.mode === 'versus') throw httpError(403, 'No shared board in versus — keep your own notes.');
    const entry = session.board[suspectId] || { means: false, motive: false, opportunity: false, status: 'open', note: '' };
    for (const k of ['means', 'motive', 'opportunity']) if (k in patch) entry[k] = !!patch[k];
    if ('status' in patch && ['open', 'cleared', 'prime'].includes(patch.status)) entry.status = patch.status;
    if ('note' in patch) entry.note = String(patch.note).slice(0, 2000);
    session.board[suspectId] = entry;
    broadcast(session, 'board', { suspectId, entry, byId: userId });
  }

  function accuse(session, userId, { suspectId, motiveId, weapon, windowStart }) {
    const p = session.players.get(userId);
    if (!p) throw httpError(404, 'Not in this session.');
    if (!session.started) throw httpError(409, 'Case not started.');
    if (session.solved && session.mode !== 'versus') throw httpError(409, 'Case already closed.');
    if (session.winnerId) throw httpError(409, 'The race is over.');
    if (session.mode === 'versus' && Date.now() < p.lockedUntil) {
      throw httpError(429, 'You are locked out after a wrong accusation.');
    }

    const sol = session.caseData.solution;
    const killerCorrect = suspectId === sol.killerId;

    if (!killerCorrect) {
      p.wrongAttempts += 1;
      let lockedUntil = 0;
      if (session.mode === 'versus') {
        lockedUntil = Date.now() + VERSUS_LOCKOUT_MS;
        p.lockedUntil = lockedUntil;
      }
      const event = { byId: userId, byName: p.name, correct: false, at: Date.now() };
      session.accusations.push(event);
      broadcast(session, 'accusation', event);
      return { correct: false, lockedUntil, wrongAttempts: p.wrongAttempts };
    }

    const motiveCorrect = motiveId === sol.motiveId;
    const weaponCorrect = weapon === sol.weapon;
    const w = Number(windowStart);
    const windowCorrect = Number.isFinite(w) && sol.murderTime >= w && sol.murderTime < w + 30;
    const attempts = session.mode === 'coop'
      ? [...session.players.values()].reduce((a, q) => a + q.wrongAttempts, 0)
      : p.wrongAttempts;
    const score = Math.max(
      5,
      60 + (motiveCorrect ? 20 : 0) + (weaponCorrect ? 10 : 0) + (windowCorrect ? 10 : 0)
        - attempts * WRONG_ATTEMPT_PENALTY,
    );

    p.solvedAt = Date.now();
    p.score = score;
    session.solved = true;
    if (session.mode === 'versus') session.winnerId = userId;

    const durationMs = p.solvedAt - (session.startedAt || session.createdAt);
    db.addResult({
      userId,
      handle: p.name,
      caseId: session.caseData.id,
      seed: session.caseData.seed,
      daily: session.daily || null,
      mode: session.mode,
      score,
      durationMs,
      at: p.solvedAt,
    });

    const event = { byId: userId, byName: p.name, correct: true, score, at: p.solvedAt };
    session.accusations.push(event);
    broadcast(session, 'accusation', event);
    broadcast(session, 'solved', { byId: userId, byName: p.name, score });

    return {
      correct: true,
      score,
      breakdown: { killer: true, motive: motiveCorrect, weapon: weaponCorrect, window: windowCorrect },
      debrief: buildDebrief(session.caseData),
    };
  }

  // ---- views ---------------------------------------------------------------

  function publicPlayers(session) {
    return [...session.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      online: p.online > 0,
      readCount: p.readDocs.length,
      readDocs: session.mode === 'coop' ? p.readDocs : undefined,
      solved: !!p.solvedAt,
      lockedUntil: p.lockedUntil,
      isHost: p.id === session.hostId,
    }));
  }

  function publicState(session, userId) {
    const me = session.players.get(userId);
    const base = {
      id: session.id,
      code: session.code,
      mode: session.mode,
      tier: session.tier,
      hostId: session.hostId,
      started: session.started,
      solved: session.solved,
      winnerId: session.winnerId,
      players: publicPlayers(session),
      accusations: session.accusations,
      chat: session.mode === 'versus' ? [] : session.chat.slice(-100),
      board: session.mode === 'versus' ? {} : session.board,
      me: me ? { readDocs: me.readDocs, lockedUntil: me.lockedUntil, wrongAttempts: me.wrongAttempts, solved: !!me.solvedAt, score: me.score } : null,
    };
    if (session.started) {
      const c = session.caseData;
      base.case = {
        id: c.id,
        title: c.title,
        town: c.town,
        tier: c.tier,
        documents: c.documents, // visible layer only — no solution, no hidden
        taxonomy: {
          motives: Object.entries(MOTIVES).map(([id, m]) => ({ id, label: m.label })),
          weapons: WEAPONS.map((w) => w.name),
        },
      };
      const solvedForMe = session.mode === 'versus'
        ? !!session.winnerId
        : session.solved;
      if (solvedForMe) base.debrief = buildDebrief(session.caseData);
    }
    return base;
  }

  function buildDebrief(caseData) {
    const sol = caseData.solution;
    const nameOf = Object.fromEntries(caseData.hidden.cast.map((x) => [x.id, x.name]));
    const locName = Object.fromEntries(
      caseData.documents.find((d) => d.kind === 'map').payload.locations.map((l) => [l.id, l.name]),
    );
    return {
      killerId: sol.killerId,
      killerName: sol.killerName,
      motiveLabel: sol.motiveLabel,
      weapon: sol.weapon,
      murderTime: sol.murderTime,
      murderTimeText: sol.murderTimeText,
      keyEvidence: sol.keyEvidence,
      killerTimeline: (caseData.hidden.segments[sol.killerId] || []).map((s) => ({
        start: s.start, end: s.end, place: locName[s.locId] || s.locId, activity: s.activity,
      })),
      liars: caseData.hidden.cast
        .filter((x) => x.role === 'suspect' && (x.isKiller || x.secret))
        .map((x) => ({
          name: nameOf[x.id],
          why: x.isKiller ? 'the killer — false alibi' : `red herring — hid that they ${secretText(x.secret)}`,
        })),
    };
  }

  // ---- SSE -----------------------------------------------------------------

  function attachClient(session, userId, res) {
    const p = session.players.get(userId);
    if (!p) throw httpError(404, 'Not in this session.');
    session.clients.add(res);
    p.online += 1;
    broadcast(session, 'players', publicPlayers(session));
    res.on('close', () => {
      session.clients.delete(res);
      p.online = Math.max(0, p.online - 1);
      broadcast(session, 'players', publicPlayers(session));
    });
  }

  function broadcast(session, event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of session.clients) {
      try { res.write(frame); } catch { session.clients.delete(res); }
    }
  }

  function get(id) {
    const s = sessions.get(id);
    if (!s) throw httpError(404, 'Session not found.');
    return s;
  }

  function getByCode(code) {
    const id = byCode.get(String(code).toUpperCase());
    if (!id) throw httpError(404, 'No open case with that code.');
    return sessions.get(id);
  }

  return { create, join, start, startDaily, markRead, postChat, updateBoard, accuse, publicState, attachClient, get, getByCode };
}

function secretText(secretId) {
  return { affair: 'were meeting someone at the motel', gambling: 'were at an illegal card game', moonlighting: 'were copying files for a rival firm' }[secretId] || 'were hiding something';
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
