// Automated solver / solvability prover. Reads ONLY the visible document
// layer (never the hidden ground truth) and reasons the way a careful player
// would: means/motive/opportunity, geometric alibi checks with witness-error
// tolerance, and lie detection via cross-referenced phone towers & sightings.

const TOWER_RADIUS_KM = 2.0; // positional ambiguity granted to tower evidence
const TOWER_TIME_SLACK = 8;

function byId(arr) {
  return Object.fromEntries(arr.map((x) => [x.id, x]));
}

export function solveCase(documents) {
  const doc = (kind) => documents.find((d) => d.kind === kind);
  const autopsy = doc('autopsy').payload;
  const briefing = doc('briefing').payload;
  const mapDoc = doc('map').payload;
  const cdr = doc('call_logs').payload;
  const background = doc('background_checks').payload;
  const statements = documents.filter((d) => d.kind === 'witness_statement');

  const locs = byId(mapDoc.locations);
  // towers in the map payload carry coordinates; the CDR payload has names only
  const towerCoords = byId(mapDoc.towers);
  const scene = locs[briefing.sceneLocId];
  const window = { start: autopsy.windowStart, end: autopsy.windowEnd };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const drive = (a, b) => {
    const d = dist(a, b);
    return d < 0.05 ? 0 : Math.round(d * mapDoc.travel.driveMinPerKm) + mapDoc.travel.driveOverhead;
  };
  const nearestTowerId = (p) => {
    let best = mapDoc.towers[0];
    for (const t of mapDoc.towers) if (dist(t, p) < dist(best, p)) best = t;
    return best.id;
  };

  // Collect testimony about each person from every statement.
  const sightingsAbout = {};
  const claimsOf = {};
  for (const st of statements) {
    const { charId, claims, sightings, claimSlack } = st.payload;
    claimsOf[charId] = { claims, slack: claimSlack };
    for (const sg of sightings) {
      (sightingsAbout[sg.aboutId] ||= []).push({ ...sg, byId: charId, docId: st.id });
    }
  }

  const suspects = background.rows;
  const report = { window, sceneLocId: scene.id, perSuspect: {}, candidates: [] };

  for (const s of suspects) {
    const evidence = [];

    // Corroborated sightings by OTHER people.
    for (const sg of sightingsAbout[s.charId] || []) {
      if (sg.byId === s.charId) continue;
      evidence.push({
        type: 'sighting',
        docId: sg.docId,
        loc: locs[sg.locId],
        locId: sg.locId,
        from: sg.from,
        to: sg.to,
        slack: sg.slack ?? 12,
      });
    }
    // Phone rows: tower places the handset within TOWER_RADIUS_KM of the site.
    for (const row of cdr.rows) {
      // Unanswered calls don't prove who was holding the destination handset.
      const involvedAsFrom = row.fromCharId === s.charId;
      const involvedAsTo = row.toCharId === s.charId && !row.note;
      if (!involvedAsFrom && !involvedAsTo) continue;
      const towerId = involvedAsFrom ? row.fromTower : row.toTower;
      if (!towerId) continue;
      evidence.push({
        type: 'tower',
        docId: 'doc_cdr',
        loc: towerCoords[towerId],
        towerId,
        from: row.time,
        to: row.time,
        slack: TOWER_TIME_SLACK,
        radiusKm: TOWER_RADIUS_KM,
        row,
      });
    }

    // ---- Opportunity: is there ANY minute in the death window at which this
    // person could have been at the scene, given all corroborated evidence?
    const blockers = [];
    let feasible = false;
    for (let tau = window.start; tau <= window.end; tau += 5) {
      let ok = true;
      for (const e of evidence) {
        if (blocksTau(e, tau)) { ok = false; if (!feasible) blockers.push({ e, tau }); break; }
      }
      if (ok) { feasible = true; break; }
    }

    function blocksTau(e, tau) {
      const travelNeeded = e.radiusKm
        ? Math.max(0, Math.round(Math.max(0, dist(e.loc, scene) - e.radiusKm) * mapDoc.travel.driveMinPerKm))
        : drive(e.loc, scene);
      if (travelNeeded === 0) return false; // evidence at/near the scene never exonerates
      const a = e.from + e.slack;
      const b = e.to - e.slack;
      if (a <= b) {
        if (tau >= a && tau <= b) return true; // verifiably elsewhere
        if (tau < a) return a - tau < travelNeeded;
        return tau - b < travelNeeded;
      }
      // Degenerate/point interval.
      const t = (e.from + e.to) / 2;
      return Math.abs(tau - t) + e.slack < travelNeeded;
    }

    // ---- Lies: cross-reference this person's own claims against records.
    const contradictions = [];
    const own = claimsOf[s.charId];
    const claimedLocAt = (t) => {
      if (!own) return null;
      for (const c of own.claims) {
        if (t >= c.from + own.slack && t <= c.to - own.slack) return c.locId;
      }
      return null;
    };
    for (const e of evidence) {
      const t = (e.from + e.to) / 2;
      const claimedLocId = claimedLocAt(t);
      if (!claimedLocId) continue;
      const claimed = locs[claimedLocId];
      if (e.type === 'tower') {
        const expected = nearestTowerId(claimed);
        if (expected !== e.towerId && dist(towerCoords[e.towerId], claimed) - dist(towerCoords[expected], claimed) > 0.7) {
          contradictions.push({
            kind: 'tower_vs_claim',
            time: t,
            claimedLocId,
            towerId: e.towerId,
            detail: `Claims to have been at ${claimed.name} at that time, but their handset registered to ${e.towerId}, which does not serve that address.`,
          });
        }
      } else if (e.locId !== claimedLocId && dist(e.loc, claimed) > 1.0) {
        contradictions.push({
          kind: 'sighting_vs_claim',
          time: t,
          claimedLocId,
          seenAt: e.locId,
          docId: e.docId,
          detail: `Claims to have been at ${claimed.name}, but a witness places them at ${locs[e.locId].name}.`,
        });
      }
    }

    const hasMotive = !!s.motiveId;
    report.perSuspect[s.charId] = {
      name: s.name,
      motive: s.motiveId || null,
      feasible,
      exonerated: !feasible,
      exoneratedBy: !feasible && blockers.length ? describeBlocker(blockers[0], locs) : null,
      contradictions,
    };
    if (hasMotive && feasible) report.candidates.push(s.charId);
  }

  report.solved = report.candidates.length === 1
    && report.perSuspect[report.candidates[0]].contradictions.length >= 1;
  report.accusedId = report.candidates.length === 1 ? report.candidates[0] : null;
  return report;
}

function describeBlocker(b, locs) {
  const e = b.e;
  const where = e.type === 'tower' ? `phone activity on ${e.towerId}` : `a witness sighting at ${locs[e.locId]?.name}`;
  return `${where} rules out presence at the scene during the death window`;
}
