import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.COLDTRAIL_LAB_MS = '25'; // fast lab for tests (read at import time)
const { createSessionManager } = await import('../lib/sessions.js');

const fakeDb = { addResult: () => {}, resultsFor: () => [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function newGame() {
  const games = createSessionManager(fakeDb);
  const s = games.create({ hostId: 'u1', hostName: 'Marlowe', mode: 'solo', tier: 'detective' });
  const cast = s.caseData.hidden.cast;
  return {
    games,
    s,
    killer: cast.find((c) => c.isKiller),
    flagged: cast.find((c) => c.motiveId && !c.isKiller),
    plain: cast.find((c) => c.role === 'suspect' && !c.motiveId && !c.secret && !c.isKiller),
    secretHolders: cast.filter((c) => c.secret),
  };
}

test('warrants: estate always granted; motive grounds grant; fishing denied', () => {
  const { games, s, flagged, plain } = newGame();
  const estate = games.requestWarrant(s, 'u1', { target: 'estate' });
  assert.equal(estate.granted, true);

  const good = games.requestWarrant(s, 'u1', { target: flagged.id, groundsDocId: 'doc_background' });
  assert.equal(good.granted, true);

  const fishing = games.requestWarrant(s, 'u1', { target: plain.id, groundsDocId: 'doc_background' });
  assert.equal(fishing.granted, false);
  assert.match(fishing.judge, /Denied/);

  const state = games.publicState(s, 'u1');
  const kinds = state.inv.docs.map((d) => d.kind);
  assert.ok(kinds.includes('estate_file'));
  assert.ok(kinds.includes('financial_records'));
});

test('warrant on the killer via the tower contradiction is granted', () => {
  const { games, s, killer } = newGame();
  const viaLie = games.requestWarrant(s, 'u1', { target: killer.id, groundsDocId: 'doc_cdr' });
  assert.equal(viaLie.granted, true);
  const fin = games.publicState(s, 'u1').inv.docs.find((d) => d.kind === 'financial_records');
  assert.equal(fin.payload.charId, killer.id);
});

test('lab: weapon dive at the bridge recovers the weapon; wrong site finds nothing; credits run out', async () => {
  const { games, s, killer } = newGame();
  games.requestLab(s, 'u1', { type: 'weapon_search', locId: 'loc_bridge' });
  games.requestLab(s, 'u1', { type: 'weapon_search', locId: 'loc_park' });
  games.requestLab(s, 'u1', { type: 'shoeprint', suspectId: killer.id });
  games.requestLab(s, 'u1', { type: 'phone', suspectId: killer.id });
  games.requestLab(s, 'u1', { type: 'tumbler' });
  assert.throws(() => games.requestLab(s, 'u1', { type: 'tumbler' }), /credits/);

  await sleep(120);
  const docs = games.publicState(s, 'u1').inv.docs;
  const texts = docs.map((d) => d.prose).join('\n');
  assert.match(texts, /RECOVERY DIVE/, 'bridge dive finds the murder weapon');
  assert.match(texts, /nothing of evidentiary value/, 'wrong site comes back empty');
  assert.match(texts, /CONSISTENT with this subject/, 'killer shoeprint matches');
  assert.match(texts, /manually deleted/, 'killer phone was wiped');
  assert.match(texts, /wiped with a cloth/, 'tumbler was wiped');
  assert.equal(games.publicState(s, 'u1').inv.labCredits, 0);
});

test('cctv: bridge camera catches the killer during the weapon dump', () => {
  const { games, s, killer } = newGame();
  const seg = s.caseData.hidden.segments[killer.id].find((x) => x.locId === 'loc_bridge');
  const w = Math.max(990, seg.start - 5);
  const { doc } = games.requestCctv(s, 'u1', { cameraId: 'cam_bridge', windowStart: w });
  assert.match(doc.prose, new RegExp(killer.name.split(' ')[0]), 'footage identifies the killer at the bridge');
  assert.throws(() => games.requestCctv(s, 'u1', { cameraId: 'cam_bridge', windowStart: w }), /already pulled/);
});

test('interrogation: killer deflects then lawyers up; weak evidence stonewalls', () => {
  const { games, s, killer, plain } = newGame();
  const r1 = games.interrogate(s, 'u1', { suspectId: killer.id, question: 'confront', evidenceDocId: 'doc_cdr' });
  assert.equal(r1.entry.outcome, 'evasive');
  const r2 = games.interrogate(s, 'u1', { suspectId: killer.id, question: 'confront', evidenceDocId: 'doc_cdr' });
  assert.equal(r2.entry.outcome, 'lawyered_up');

  const weak = games.interrogate(s, 'u1', { suspectId: plain.id, question: 'confront', evidenceDocId: 'doc_background' });
  assert.equal(weak.entry.outcome, 'stonewall');

  const alibi = games.interrogate(s, 'u1', { suspectId: plain.id, question: 'alibi' });
  assert.ok(alibi.entry.a.length > 10);
});

test('interrogation: a caught secret-holder confesses the secret (when catchable)', () => {
  // Secret-holders only break when the cited evidence actually contradicts
  // them; sweep seeds until a case has a catchable one, then confirm.
  for (let i = 0; i < 12; i++) {
    const { games, s, secretHolders } = newGame();
    for (const sh of secretHolders) {
      const per = s.caseData.meta.solverReport.perSuspect[sh.id];
      const hit = per?.contradictions[0];
      if (!hit) continue;
      const docId = hit.kind === 'tower_vs_claim' ? 'doc_cdr' : hit.docId;
      const r = games.interrogate(s, 'u1', { suspectId: sh.id, question: 'confront', evidenceDocId: docId });
      assert.equal(r.entry.outcome, 'confessed_secret');
      assert.ok(r.entry.a.length > 40);
      return;
    }
  }
  assert.fail('no catchable secret-holder found across 12 cases (statistically implausible)');
});

test('versus keeps investigation resources per player', () => {
  const games = createSessionManager(fakeDb);
  const s = games.create({ hostId: 'u1', hostName: 'A', mode: 'versus', tier: 'rookie' });
  games.join(s, 'u2', 'B');
  games.start(s, 'u1');
  games.requestWarrant(s, 'u1', { target: 'estate' });
  const a = games.publicState(s, 'u1');
  const b = games.publicState(s, 'u2');
  assert.equal(a.inv.docs.length, 1);
  assert.equal(b.inv.docs.length, 0, 'rival must not see my warrant results');
  assert.equal(a.inv.labCredits, 3);
});
