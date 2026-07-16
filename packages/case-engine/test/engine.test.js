import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCase, solveCase } from '../src/index.js';

test('determinism: same seed produces byte-identical cases', () => {
  const a = generateCase('alpha', { tier: 'detective' });
  const b = generateCase('alpha', { tier: 'detective' });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('different seeds produce different cases', () => {
  const a = generateCase('seed-one', { tier: 'detective' });
  const b = generateCase('seed-two', { tier: 'detective' });
  assert.notEqual(JSON.stringify(a.documents), JSON.stringify(b.documents));
});

test('solvability proof holds across seeds and tiers', () => {
  for (let i = 0; i < 10; i++) {
    const tier = i % 2 === 0 ? 'rookie' : 'detective';
    const c = generateCase(`proof-${i}`, { tier });
    const report = solveCase(c.documents);
    assert.equal(report.solved, true, `seed proof-${i} not solved`);
    assert.equal(report.accusedId, c.solution.killerId, `seed proof-${i} accused wrong suspect`);
    // Killer has a provable lie; every other motive-holder is exonerated.
    const killerEntry = report.perSuspect[c.solution.killerId];
    assert.ok(killerEntry.contradictions.length >= 1, `seed proof-${i}: killer lie not catchable`);
    for (const [id, entry] of Object.entries(report.perSuspect)) {
      if (id === c.solution.killerId) continue;
      if (entry.motive) assert.equal(entry.exonerated, true, `seed proof-${i}: motive-holder ${entry.name} not exonerable`);
    }
  }
});

test('cases vary: killers, motives and weapons differ across seeds', () => {
  const combos = new Set();
  for (let i = 0; i < 8; i++) {
    const c = generateCase(`variety-${i}`, { tier: 'detective' });
    combos.add(`${c.solution.motiveId}|${c.solution.weapon}|${c.town}`);
  }
  assert.ok(combos.size >= 5, `expected variety, got ${combos.size} distinct combos`);
});

test('internal consistency: documents never contradict the hidden truth', () => {
  const c = generateCase('consistency', { tier: 'detective' });
  const autopsy = c.documents.find((d) => d.kind === 'autopsy').payload;

  // The real murder time sits inside the ME's stated window.
  assert.ok(autopsy.windowStart <= c.hidden.murderTime && c.hidden.murderTime <= autopsy.windowEnd);

  // Honest suspects' claimed intervals stay within their personality fuzz
  // (+5 for rounding to 5-minute speech) of the true segments.
  const castById = Object.fromEntries(c.hidden.cast.map((x) => [x.id, x]));
  for (const doc of c.documents.filter((d) => d.kind === 'witness_statement')) {
    const who = castById[doc.payload.charId];
    if (!who || who.role !== 'suspect' || who.isKiller || who.secret) continue;
    const trueSegs = c.hidden.segments[who.id];
    for (const claim of doc.payload.claims) {
      const match = trueSegs.find((s) => s.locId === claim.locId
        && Math.abs(s.start - claim.from) <= who.fuzz + 5
        && Math.abs(s.end - claim.to) <= who.fuzz + 5);
      assert.ok(match, `${who.name}: honest claim drifted beyond fuzz (${claim.locId})`);
    }
  }

  // Every CDR tower matches a tower that actually exists on the map.
  const towerIds = new Set(c.documents.find((d) => d.kind === 'map').payload.towers.map((t) => t.id));
  for (const row of c.documents.find((d) => d.kind === 'call_logs').payload.rows) {
    if (row.fromTower) assert.ok(towerIds.has(row.fromTower));
    if (row.toTower) assert.ok(towerIds.has(row.toTower));
  }

  // The ground truth never leaks into document payloads or prose.
  const visible = JSON.stringify(c.documents);
  assert.ok(!visible.includes('isKiller'));
  assert.ok(!visible.includes('AT THE SCENE'));
  assert.ok(!visible.includes('disposing of the weapon'));
});

test('generation converges quickly enough to bank cases at scale', () => {
  let totalAttempts = 0;
  for (let i = 0; i < 6; i++) {
    const c = generateCase(`bank-${i}`, { tier: 'rookie' });
    totalAttempts += c.meta.attempts;
  }
  assert.ok(totalAttempts / 6 <= 20, `average attempts too high: ${totalAttempts / 6}`);
});
