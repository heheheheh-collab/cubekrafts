// Pipeline: skeleton -> map -> cast -> timeline -> evidence -> solver proof.
// A case only ships if the solver — reading visible documents alone — reaches
// exactly the true killer and can prove at least one of the killer's lies.
// Failed attempts are discarded and regenerated from a derived seed.

import { createRng } from './rng.js';
import { TOWNS, MOTIVES } from './data/pools.js';
import { CRIME_TYPES } from './data/crimes.js';
import { generateMap } from './gen/map.js';
import { generateCast } from './gen/cast.js';
import { generateTimeline } from './gen/timeline.js';
import { projectEvidence } from './gen/evidence.js';
import { projectGated } from './gen/gated.js';
import { solveCase } from './solver.js';
import { fmtTime } from './time.js';

const MAX_ATTEMPTS = 80;

export function generateCase(seed, { tier = 'detective' } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const rng = createRng(`${seed}#a${attempt}`);
    const built = buildAttempt(rng, tier);
    if (!built) continue;
    const report = solveCase(built.documents);
    if (!report.solved || report.accusedId !== built.cast.killer.id) continue;
    return finalize(seed, tier, attempt, built, report);
  }
  throw new Error(`case generation failed to converge for seed "${seed}" (${tier})`);
}

function buildAttempt(rng, tier) {
  const town = rng.pick(TOWNS);
  const murderTime = rng.int(1260, 1365); // Fri 21:00 – 22:45
  const crime = rng.pick(CRIME_TYPES);
  const method = rng.pick(crime.methods);
  const room = rng.pick(crime.rooms);
  const skeleton = {
    tier,
    town,
    murderTime,
    window: { start: murderTime - rng.int(30, 45), end: murderTime + rng.int(30, 45) },
    crime,
    method,
    room,
    weapon: method, // alias kept for existing timeline/gated references
    tell: rng.pick(['tower', 'sighting', 'anpr']), // how the killer's lie is caught
  };
  const map = generateMap(rng.fork('map'), town);
  const cast = generateCast(rng.fork('cast'), map, tier);
  const timeline = generateTimeline(rng.fork('timeline'), map, cast, skeleton);
  if (!timeline) return null;
  const documents = projectEvidence(rng.fork('evidence'), map, cast, skeleton, timeline);
  return { skeleton, map, cast, timeline, documents };
}

function finalize(seed, tier, attempts, built, report) {
  const { skeleton, map, cast, timeline, documents } = built;
  const { killer, victim } = cast;
  const motive = MOTIVES[killer.motiveId];
  const sceneName = map.locations.find((l) => l.id === timeline.scene).name;
  const street = sceneName.split(', ')[1] || sceneName;
  const TITLE = {
    blunt_force: `Death on ${street}`,
    stabbing: `Blood on ${street}`,
    poisoning: `The ${street} Poisoning`,
    gunshot: `A Shot on ${street}`,
    strangulation: `The ${street} Strangling`,
    staged_fall: `No Accident on ${street}`,
  };
  const gated = projectGated(createRng(`${seed}#gated`), map, cast, skeleton, timeline);
  // Camera index is public knowledge — players see WHERE cameras are on the
  // map; the footage itself is pulled per-request in game.
  documents.find((d) => d.kind === 'map').payload.cameras = gated.cameras;

  return {
    engine: 'coldtrail-case-engine@0.2.0',
    id: `CT-${hash(String(seed))}`,
    seed: String(seed),
    tier,
    town: skeleton.town,
    title: TITLE[skeleton.crime.id] || `Death on ${street}`,
    documents,
    solution: {
      killerId: killer.id,
      killerName: killer.name,
      motiveId: killer.motiveId,
      motiveLabel: motive.label,
      crimeType: skeleton.crime.id,
      crimeLabel: skeleton.crime.label,
      tellType: timeline.tell.type,
      weapon: skeleton.method.name,
      murderTime: skeleton.murderTime,
      murderTimeText: fmtTime(skeleton.murderTime),
      sceneLocId: timeline.scene,
      weaponDumpLocId: skeleton.crime.disposesWeapon ? 'loc_bridge' : null,
      keyEvidence: [
        `This was ${skeleton.crime.label} — the medical examiner puts death between ${fmtTime(skeleton.window.start)} and ${fmtTime(skeleton.window.end)}.`,
        tellLine(timeline.tell, killer, cast, sceneName),
        `Background checks give ${killer.name} a live motive: ${motive.label}.`,
        `Every other person of interest with a motive is verifiably elsewhere for the whole death window.`,
        skeleton.crime.disposesWeapon
          ? `The weapon (${skeleton.method.name}) was dropped from ${map.locations.find((l) => l.id === 'loc_bridge').name} on the drive home.`
          : `No weapon to trace: the method (${skeleton.method.name}) left nothing to dispose of — which is what nearly made it look like no crime at all.`,
      ],
    },
    hidden: {
      murderTime: skeleton.murderTime,
      weapon: skeleton.weapon,
      segments: timeline.segments,
      calls: timeline.calls,
      sightings: timeline.sightings,
      cast: cast.characters.map((c) => ({
        id: c.id,
        name: c.name,
        role: c.role,
        fuzz: c.personality?.fuzz ?? null,
        isKiller: !!c.isKiller,
        isCompeting: !!c.isCompeting,
        secret: c.secret?.id || null,
        motiveId: c.motiveId || null,
        shoeSize: c.shoeSize ?? null,
        claimedSegments: c.claimedSegments || null,
      })),
    },
    gated,
    meta: { attempts, solverReport: report },
  };
}

function tellLine(tell, killer, cast, sceneName) {
  if (tell.type === 'sighting') {
    const witness = cast.characters.find((c) => c.id === tell.witnessId);
    return `${killer.name} claims to have been home all night, but ${witness.name} — home nearby — saw them at ${sceneName} at ${fmtTime(tell.at)}, squarely inside the death window.`;
  }
  if (tell.type === 'anpr') {
    return `${killer.name} claims to have been home all night, but a number-plate camera photographed their car (${tell.plate}) at ${tell.cameraName} at ${fmtTime(tell.at)} — inside the death window, nowhere near home.`;
  }
  return `${killer.name} claims to have been home for the rest of the night, but at ${fmtTime(tell.callTime)} their handset answered a call registered to the cell site serving ${sceneName} — not their home.`;
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36).toUpperCase();
}
