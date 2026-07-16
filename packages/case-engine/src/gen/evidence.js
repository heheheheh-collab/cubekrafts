// Evidence projection: renders the visible document layer from the hidden
// ground truth. Witness times get personality-based fuzz; phone records and
// forensics are exact. Lies come from each character's claimedSegments.

import { SIM_START, SIM_END, fmtTime, roundTo5, clamp } from '../time.js';
import { MOTIVES, MEALS, NPC_ROLES } from '../data/pools.js';

function fuzz(rng, t, amount) {
  return clamp(roundTo5(t + rng.int(-amount, amount)), SIM_START, SIM_END);
}

export function projectEvidence(rng, map, cast, skeleton, timeline) {
  const locs = Object.fromEntries(map.locations.map((l) => [l.id, l]));
  const { victim, suspects, killer, npcs } = cast;
  const scene = locs[timeline.scene];
  const documents = [];

  const locName = (locId, viewer) => {
    if (viewer && locId === viewer.homeLocId) return 'my home';
    return locs[locId].name;
  };

  // ---------------------------------------------------------------- briefing
  const discoveredAt = 1440 + 7 * 60 + rng.int(20, 55); // Saturday morning
  documents.push({
    id: 'doc_briefing',
    kind: 'briefing',
    title: 'Case Briefing — First Responder Report',
    payload: {
      victimId: victim.id,
      victimName: victim.name,
      sceneLocId: timeline.scene,
      discoveredAt,
    },
    prose: [
      `${map.town} Police Department — Incident Report`,
      ``,
      `At ${fmtTime(discoveredAt)}, officers conducted a welfare check at ${scene.name} after ${victim.name} (${victim.age}, ${victim.occupation}) failed to appear for a standing Saturday appointment and could not be reached by phone.`,
      `The front door was unlocked. ${victim.name} was found deceased in the study with apparent head trauma. There were no signs of forced entry. The scene was secured at ${fmtTime(discoveredAt + 12)} pending forensic examination.`,
      `Detectives are requested to establish the victim's movements on Friday evening and to identify persons of interest among the victim's family, business associates and neighbors. Statements have been collected and are attached to this casefile, together with phone records, background summaries and the medical examiner's report.`,
    ].join('\n'),
  });

  // ------------------------------------------------------------- crime scene
  const weapon = skeleton.weapon;
  documents.push({
    id: 'doc_scene',
    kind: 'crime_scene',
    title: 'Crime Scene Examination Report',
    payload: {
      sceneLocId: timeline.scene,
      markers: [
        { n: 1, label: 'Body position', detail: 'Victim found prone in the study, facing the desk. Lividity fixed and consistent with the position found — the body was not moved after death.' },
        { n: 2, label: 'Blood evidence', detail: 'Cast-off pattern on the bookshelf indicates a single heavy blow struck from behind and slightly above. No spatter trail leading away from the study.' },
        { n: 3, label: 'Point of entry', detail: 'No forced entry. Front door lock undamaged; rear windows latched from inside. The victim very likely admitted the attacker voluntarily.' },
        { n: 4, label: 'Glassware', detail: 'Two used tumblers on the sideboard, one bearing the victim’s prints, the second wiped clean. The victim appears to have poured a drink for a guest.' },
        { n: 5, label: 'Footwear impression', detail: `Partial sole impression in the flowerbed beneath the study window, men’s size ${killer.shoeSize}–${killer.shoeSize + 1}, deep tread, heading away from the house.` },
        { n: 6, label: 'Weapon', detail: 'No weapon recovered at the scene. Wound characteristics suggest a heavy blunt object removed by the attacker.' },
      ],
    },
    prose: null,
  });

  // ----------------------------------------------------------------- autopsy
  const meal = rng.pick(MEALS);
  documents.push({
    id: 'doc_autopsy',
    kind: 'autopsy',
    title: 'Medical Examiner — Post-Mortem Report',
    payload: {
      victimId: victim.id,
      windowStart: skeleton.window.start,
      windowEnd: skeleton.window.end,
      causeOfDeath: 'blunt force trauma to the head',
      weaponClass: weapon.autopsy,
      meal,
    },
    prose: [
      `Decedent: ${victim.name}, ${victim.age}.`,
      `Cause of death: blunt force trauma to the posterior right parietal region; single impact; immediate incapacitation, death within minutes.`,
      `Wound morphology is consistent with ${weapon.autopsy}, delivered with substantial force by an assailant standing behind the victim. No defensive wounds — the victim did not anticipate the attack.`,
      `Time of death: based on core temperature, fixed lividity and the state of rigor at examination, death is placed between ${fmtTime(skeleton.window.start)} and ${fmtTime(skeleton.window.end)}.`,
      `Gastric contents: partially digested ${meal}, consumed approximately two to three hours before death. Toxicology: blood alcohol consistent with a single drink; no drugs detected.`,
    ].join('\n'),
  });

  // -------------------------------------------------------------- phone CDRs
  const phoneOwners = cast.characters.filter((c) => c.role !== 'npc');
  const numberOf = Object.fromEntries(phoneOwners.map((c) => [c.id, c.phone]));
  documents.push({
    id: 'doc_cdr',
    kind: 'call_logs',
    title: 'Subpoenaed Call Detail Records (Friday 17:00 – Saturday 02:30)',
    payload: {
      subscribers: phoneOwners.map((c) => ({ charId: c.id, name: c.name, number: c.phone })),
      towers: map.towers.map((t) => ({ id: t.id, name: t.name })),
      rows: timeline.calls.map((call) => ({
        time: call.t,
        from: numberOf[call.fromId],
        fromCharId: call.fromId,
        to: numberOf[call.toId],
        toCharId: call.toId,
        durationMin: call.durationMin,
        fromTower: call.fromTower,
        toTower: call.toTower,
        note: call.unanswered ? 'no answer' : '',
      })),
    },
    prose: 'Carrier records for all subscriber lines belonging to persons of interest. Tower columns give the cell site each handset was registered to at the time of the call. Records are machine-generated and exact.',
  });

  // ------------------------------------------------------- background checks
  const flagged = suspects.filter((s) => s.motiveId);
  documents.push({
    id: 'doc_background',
    kind: 'background_checks',
    title: 'Persons of Interest — Background Summaries',
    payload: {
      rows: suspects.map((s) => ({
        charId: s.id,
        name: s.name,
        age: s.age,
        occupation: s.occupation,
        relationship: s.relationship.label,
        motiveId: s.motiveId || null,
        motiveNote: s.motiveId ? MOTIVES[s.motiveId].fact(s.name, victim.name) : 'No notable financial or legal entanglement with the victim on record.',
      })),
    },
    prose: `Records division summary covering ${suspects.length} persons of interest connected to ${victim.name}. Flags below are drawn from probate filings, insurance registries, court records and financial disclosures.`,
  });

  // -------------------------------------------------------------------- map
  documents.push({
    id: 'doc_map',
    kind: 'map',
    title: `Area Map — ${map.town}`,
    payload: {
      town: map.town,
      locations: map.locations,
      towers: map.towers,
      travel: { driveMinPerKm: 4, driveOverhead: 3, walkMinPerKm: 12 },
    },
    prose: 'Grid coordinates in kilometres. Driving time between points ≈ distance × 4 min/km + 3 min. Cell sites serve whichever handset is nearest.',
  });

  // -------------------------------------------------------------- statements
  const sightingsBy = {};
  for (const s of timeline.sightings) {
    (sightingsBy[s.byId] ||= []).push(s);
  }

  // Distribute gossip about motives into other suspects' statements.
  const gossipTargets = {};
  for (const s of flagged) {
    const others = suspects.filter((o) => o !== s);
    for (const o of rng.pickN(others, Math.min(2, others.length))) {
      (gossipTargets[o.id] ||= []).push({ aboutId: s.id, motiveId: s.motiveId, text: MOTIVES[s.motiveId].gossip(s.name, victim.name) });
    }
  }

  for (const s of suspects) {
    const f = s.personality.fuzz;
    const claims = s.claimedSegments
      .filter((seg) => seg.end - seg.start >= 8)
      .map((seg) => ({
        locId: seg.locId,
        from: seg.start <= SIM_START ? SIM_START : fuzz(rng, seg.start, f),
        to: seg.end >= SIM_END ? SIM_END : fuzz(rng, seg.end, f),
        activity: seg.activity,
      }));
    const seen = (sightingsBy[s.id] || []).map((sg) => ({
      aboutId: sg.aboutId,
      locId: sg.locId,
      from: fuzz(rng, sg.t0, f),
      to: fuzz(rng, sg.t1, f),
      arrival: !!sg.arrival,
      slack: f + 6,
    }));
    const gossip = gossipTargets[s.id] || [];

    const lines = [s.personality.opener];
    // Skip the activity clause when it just restates "home" — reads badly.
    const tail = (activity) => (/^(at )?home( all evening| for the rest of the night)?$/.test(activity) ? '' : ` — ${activity}`);
    for (const c of claims) {
      const place = locName(c.locId, s);
      if (c.from <= SIM_START && c.to >= SIM_END) {
        lines.push(`I was at ${place} the entire evening${tail(c.activity)}.`);
      } else if (c.to >= SIM_END) {
        lines.push(`From around ${fmtTime(c.from)} I was at ${place} for the rest of the night${tail(c.activity)}.`);
      } else {
        lines.push(`From about ${fmtTime(c.from)} until ${fmtTime(c.to)} I was at ${place}${tail(c.activity)}.`);
      }
    }
    for (const sg of seen) {
      const who = cast.characters.find((c) => c.id === sg.aboutId).name;
      if (sg.arrival) {
        lines.push(`I happened to notice ${who} getting home at about ${fmtTime(sg.from)}.`);
      } else if (sg.to - sg.from >= 25) {
        lines.push(`${who} was at ${locName(sg.locId, s)} the same time as me, from roughly ${fmtTime(sg.from)} to ${fmtTime(sg.to)}.`);
      } else {
        lines.push(`I saw ${who} at ${locName(sg.locId, s)} around ${fmtTime(sg.from)}.`);
      }
    }
    if (timeline.vagueFigure && timeline.vagueFigure.byId === s.id) {
      lines.push(`One more thing — around ${fmtTime(roundTo5(timeline.vagueFigure.at))} I saw a figure in dark clothing walking quickly away from ${scene.name}. I couldn’t make out a face. It didn’t seem important until now.`);
    }
    for (const g of gossip) lines.push(g.text);
    lines.push(s.personality.closer);

    documents.push({
      id: `doc_statement_${s.id}`,
      kind: 'witness_statement',
      title: `Witness Statement — ${s.name} (${s.relationship.label})`,
      payload: { charId: s.id, claims, sightings: seen, gossip, claimSlack: f + 6 },
      prose: lines.join('\n'),
    });
  }

  // NPC statements (bartender, waitress, dinner guests).
  for (const n of npcs) {
    const f = 6;
    const seen = (sightingsBy[n.id] || []).map((sg) => ({
      aboutId: sg.aboutId,
      locId: sg.locId,
      from: fuzz(rng, sg.t0, f),
      to: fuzz(rng, sg.t1, f),
      slack: f + 6,
    }));
    const lines = [];
    if (n.occupation === NPC_ROLES.bartender) {
      lines.push('I was behind the bar all night, like every Friday. Here’s who I remember.');
    } else if (n.occupation === NPC_ROLES.waitress) {
      lines.push('Friday dinner shift, I had the floor to myself. I remember the regulars.');
    } else {
      const host = cast.characters.find((c) => c.id === n.guestOf);
      lines.push(`I was invited to dinner at ${host.name}’s home that evening.`);
    }
    for (const sg of seen) {
      const who = cast.characters.find((c) => c.id === sg.aboutId).name;
      if (sg.to - sg.from >= 25) {
        lines.push(`${who} was at ${locName(sg.locId)} from about ${fmtTime(sg.from)} until ${fmtTime(sg.to)} — I’m sure of it, they were in my line of sight the whole time.`);
      } else {
        lines.push(`${who} came through ${locName(sg.locId)} around ${fmtTime(sg.from)}, stayed maybe ${Math.max(10, sg.to - sg.from)} minutes.`);
      }
    }
    if (n.occupation === NPC_ROLES.waitress && seen.some((sg) => sg.aboutId === victim.id)) {
      lines.push(`${victim.name} had the usual table and ordered the ${documents.find((d) => d.id === 'doc_autopsy').payload.meal}. Seemed in perfectly good spirits.`);
    }
    documents.push({
      id: `doc_statement_${n.id}`,
      kind: 'witness_statement',
      title: `Witness Statement — ${n.name} (${n.occupation})`,
      payload: { charId: n.id, claims: [], sightings: seen, gossip: [], claimSlack: f + 6 },
      prose: lines.join('\n'),
    });
  }

  return documents;
}
