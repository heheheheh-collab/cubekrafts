// In-memory game session manager: lobbies, co-op squads, versus races,
// shared suspect board, chat, accusation grading and SSE fan-out.
// The full case (including solution + hidden ground truth) lives here on the
// server; clients only ever receive the visible document layer until they
// have legitimately solved the case.

import { generateCase, cctvPull } from '../../../packages/case-engine/src/index.js';
import { MOTIVES, WEAPONS } from '../../../packages/case-engine/src/data/pools.js';
import { fmtTime } from '../../../packages/case-engine/src/time.js';
import { newId } from './auth.js';

const VERSUS_LOCKOUT_MS = 3 * 60 * 1000;
const WRONG_ATTEMPT_PENALTY = 15;
const LAB_DELAY_MS = Number(process.env.COLDTRAIL_LAB_MS || 45_000);
const LAB_CREDITS = { solo: 5, coop: 5, versus: 3 };

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
      inv: newInv(mode), // shared investigation resources (solo/coop)
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
        inv: session.mode === 'versus' ? newInv('versus') : null,
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

  // ---- investigation resources: warrants, lab, CCTV, interrogation --------
  // Shared across the squad in solo/co-op; strictly per-player in versus.

  function invOf(session, userId) {
    if (session.mode === 'versus') return session.players.get(userId).inv;
    return session.inv;
  }

  function pushInvDoc(session, userId, doc) {
    const inv = invOf(session, userId);
    inv.docs.push(doc);
    emitInv(session, userId, 'unlock', { doc, labCredits: inv.labCredits });
    return doc;
  }

  function emitInv(session, userId, event, data) {
    if (session.mode === 'versus') broadcastTo(session, userId, event, data);
    else broadcast(session, event, data);
  }

  // A contradiction "match" is how both warrants and interrogation decide
  // whether cited evidence actually bites: the solver already proved which
  // documents contradict which suspects.
  function matchedContradictions(session, suspectId, evidenceDocId) {
    const per = session.caseData.meta.solverReport.perSuspect[suspectId];
    if (!per) return [];
    return per.contradictions.filter((c) => (
      (c.kind === 'tower_vs_claim' && evidenceDocId === 'doc_cdr')
      || (c.kind === 'sighting_vs_claim' && c.docId === evidenceDocId)
    ));
  }

  function requestWarrant(session, userId, { target, groundsDocId }) {
    requirePlaying(session, userId);
    const inv = invOf(session, userId);
    const gated = session.caseData.gated;
    if (target === 'estate') {
      if (inv.warrants.includes('estate')) throw httpError(409, 'Already granted.');
      inv.warrants.push('estate');
      pushInvDoc(session, userId, gated.estate);
      return { granted: true, judge: 'Granted. The deceased’s own papers are fair game.' };
    }
    const suspect = session.caseData.hidden.cast.find((c) => c.id === target && c.role === 'suspect');
    if (!suspect) throw httpError(400, 'Name a person of interest.');
    if (inv.warrants.includes(target)) throw httpError(409, 'Already granted.');
    const bg = session.caseData.documents.find((d) => d.kind === 'background_checks');
    const hasMotiveGrounds = groundsDocId === bg.id
      && bg.payload.rows.some((r) => r.charId === target && r.motiveId);
    const hasContradictionGrounds = matchedContradictions(session, target, groundsDocId).length > 0;
    if (!hasMotiveGrounds && !hasContradictionGrounds) {
      return { granted: false, judge: `Denied. “${suspect.name} seems suspicious” is not probable cause. Bring me a documented motive or a lie you can prove, detective.` };
    }
    inv.warrants.push(target);
    pushInvDoc(session, userId, gated.financials[target]);
    return { granted: true, judge: `Granted on the strength of the ${hasContradictionGrounds ? 'contradiction' : 'documented motive'} you cited. Use it well.` };
  }

  function requestLab(session, userId, { type, suspectId, locId }) {
    requirePlaying(session, userId);
    const inv = invOf(session, userId);
    if (inv.labCredits <= 0) throw httpError(409, 'The lab has cut you off — no credits left.');
    const gated = session.caseData.gated;
    const cast = session.caseData.hidden.cast;
    let title; let prose;
    if (type === 'tumbler') {
      title = 'Lab Report — Latent Prints (Second Tumbler)';
      prose = gated.lab.tumbler;
    } else if (type === 'shoeprint') {
      const s = cast.find((c) => c.id === suspectId && c.role === 'suspect');
      if (!s) throw httpError(400, 'Pick a suspect to compare.');
      const killer = cast.find((c) => c.isKiller);
      const match = s.shoeSize >= killer.shoeSize && s.shoeSize <= killer.shoeSize + 1;
      title = `Lab Report — Footwear Comparison: ${s.name}`;
      prose = match ? gated.lab.shoeMatch(s.name, s.shoeSize) : gated.lab.shoeNoMatch(s.name, s.shoeSize);
    } else if (type === 'weapon_search') {
      const loc = session.caseData.documents.find((d) => d.kind === 'map').payload.locations.find((l) => l.id === locId);
      if (!loc) throw httpError(400, 'Pick a search location.');
      title = `Lab Report — Evidence Search: ${loc.name}`;
      prose = locId === 'loc_bridge' ? gated.lab.weaponFound : gated.lab.weaponNotFound(loc.name);
    } else if (type === 'phone') {
      const s = cast.find((c) => c.id === suspectId && c.role === 'suspect');
      if (!s) throw httpError(400, 'Pick a suspect’s device.');
      title = `Lab Report — Device Extraction: ${s.name}`;
      prose = gated.phoneForensics[suspectId];
    } else {
      throw httpError(400, 'Unknown analysis.');
    }
    inv.labCredits -= 1;
    const readyAt = Date.now() + LAB_DELAY_MS;
    const pending = { id: `lab_${++inv.seq}`, title, readyAt };
    inv.pendingLab.push(pending);
    emitInv(session, userId, 'lab_pending', { pending, labCredits: inv.labCredits });
    setTimeout(() => {
      inv.pendingLab = inv.pendingLab.filter((p) => p !== pending);
      pushInvDoc(session, userId, { id: `doc_${pending.id}`, kind: 'lab_report', title, payload: {}, prose });
    }, LAB_DELAY_MS).unref?.();
    return { queued: true, readyAt, labCredits: inv.labCredits };
  }

  function requestCctv(session, userId, { cameraId, windowStart }) {
    requirePlaying(session, userId);
    const inv = invOf(session, userId);
    const w = Number(windowStart);
    if (!Number.isFinite(w) || w < 990 || w > 1560) throw httpError(400, 'Pick a time window.');
    const key = `${cameraId}@${w}`;
    if (inv.cctvPulled.includes(key)) throw httpError(409, 'You already pulled that footage.');
    const result = cctvPull(session.caseData, cameraId, w, w + 30);
    if (!result) throw httpError(400, 'No such camera.');
    inv.cctvPulled.push(key);
    const doc = {
      id: `doc_cctv_${++inv.seq}`,
      kind: 'cctv_footage',
      title: `CCTV Pull — ${result.cam.label}, ${fmtTime(w)}–${fmtTime(w + 30)}`,
      payload: { cameraId, windowStart: w },
      prose: result.empty
        ? 'Footage reviewed. No relevant activity in the requested window.'
        : result.lines.join('\n'),
    };
    pushInvDoc(session, userId, doc);
    return { doc };
  }

  function interrogate(session, userId, { suspectId, question, evidenceDocId }) {
    requirePlaying(session, userId);
    const inv = invOf(session, userId);
    const p = session.players.get(userId);
    const suspect = session.caseData.hidden.cast.find((c) => c.id === suspectId && c.role === 'suspect');
    if (!suspect) throw httpError(400, 'No such suspect in the interview room.');
    const iv = session.caseData.gated.interviews[suspectId];
    const isKiller = suspectId === session.caseData.solution.killerId;
    let q; let a; let outcome = 'normal';

    if (question === 'alibi') {
      q = 'Walk me through your evening again.';
      a = iv.alibi;
    } else if (question === 'victim') {
      q = 'How did things really stand between you and the victim?';
      a = iv.victim;
    } else if (question === 'confront') {
      const cited = session.caseData.documents.find((d) => d.id === evidenceDocId);
      if (!cited) throw httpError(400, 'Cite a document from the casefile.');
      q = `We have a problem. This says otherwise. [cites: ${cited.title}]`;
      const hits = matchedContradictions(session, suspectId, evidenceDocId);
      if (!hits.length) {
        a = iv.stonewall;
        outcome = 'stonewall';
      } else if (isKiller) {
        const pressed = (inv.pressure[suspectId] = (inv.pressure[suspectId] || 0) + 1);
        if (pressed >= 2) { a = iv.lawyer; outcome = 'lawyered_up'; } else { a = iv.deflections[hits[0].kind]; outcome = 'evasive'; }
      } else if (iv.confession) {
        a = iv.confession;
        outcome = 'confessed_secret';
      } else {
        a = iv.stonewall;
        outcome = 'stonewall';
      }
    } else {
      throw httpError(400, 'Ask a real question.');
    }

    const entry = { suspectId, suspectName: suspect.name, q, a, outcome, byName: p.name, at: Date.now() };
    inv.transcript.push(entry);
    emitInv(session, userId, 'transcript', entry);
    return { entry };
  }

  function requirePlaying(session, userId) {
    if (!session.players.has(userId)) throw httpError(404, 'Not in this session.');
    if (!session.started) throw httpError(409, 'Case not started.');
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
    if (me && session.started) {
      const inv = invOf(session, userId);
      base.inv = {
        labCredits: inv.labCredits,
        docs: inv.docs,
        pendingLab: inv.pendingLab,
        transcript: inv.transcript,
        warrants: inv.warrants,
      };
    }
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
    res.ctUserId = userId;
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

  // Versus-private events (lab results, warrants) go only to that player's tabs.
  function broadcastTo(session, userId, event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of session.clients) {
      if (res.ctUserId !== userId) continue;
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

  return {
    create, join, start, startDaily, markRead, postChat, updateBoard, accuse,
    requestWarrant, requestLab, requestCctv, interrogate,
    publicState, attachClient, get, getByCode,
  };
}

function newInv(mode) {
  return {
    labCredits: LAB_CREDITS[mode] ?? 5,
    docs: [], // unlocked documents (financials, estate, lab reports, cctv)
    pendingLab: [],
    transcript: [], // interrogation Q&A entries
    warrants: [],
    cctvPulled: [],
    pressure: {}, // suspectId -> confrontation count (for lawyering up)
    seq: 0,
  };
}

function secretText(secretId) {
  return { affair: 'were meeting someone at the motel', gambling: 'were at an illegal card game', moonlighting: 'were copying files for a rival firm' }[secretId] || 'were hiding something';
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
