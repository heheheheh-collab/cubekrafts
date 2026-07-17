// Ground-truth timeline simulation. Every character gets minute-resolution
// segments for the critical evening; the murder, the killer's cover-up, calls
// and sightings are all recorded here. Evidence documents are projections of
// this structure — nothing in a document can contradict it.

import { SIM_START, SIM_END } from '../time.js';
import { driveMinutes, dist, nearestTower } from './map.js';
import { NPC_ROLES } from '../data/pools.js';

const locById = (map) => Object.fromEntries(map.locations.map((l) => [l.id, l]));

export function generateTimeline(rng, map, cast, skeleton) {
  const locs = locById(map);
  const { victim, suspects, killer, competing, npcs } = cast;
  const { murderTime } = skeleton;
  const drive = (aId, bId) => driveMinutes(locs[aId], locs[bId]);

  const segments = {}; // charId -> [{locId, start, end, activity}]
  const setSegs = (c, segs) => { segments[c.id] = segs; };

  // --- Victim: diner dinner, then home, murdered there. -------------------
  const dinerStart = 1150 + rng.int(0, 25); // ~19:10-19:35
  const dinerEnd = dinerStart + rng.int(45, 60);
  const vHome = victim.homeLocId;
  setSegs(victim, [
    { locId: vHome, start: SIM_START, end: dinerStart - drive(vHome, 'loc_diner'), activity: 'at home' },
    { locId: 'loc_diner', start: dinerStart, end: dinerEnd, activity: 'dinner at the diner' },
    { locId: vHome, start: dinerEnd + drive('loc_diner', vHome), end: murderTime, activity: 'at home' },
    { locId: vHome, start: murderTime, end: SIM_END, activity: 'deceased' },
  ]);

  // --- Killer: normal early evening, travel to scene, murder, dump weapon,
  //     home. Claims to have been home the whole later evening. -------------
  const kHome = killer.homeLocId;
  const scene = vHome;
  const arriveScene = murderTime - rng.int(8, 14);
  let leaveScene = murderTime + rng.int(10, 20);
  const killerAtBarEarly = rng.chance(0.55);
  const kSegs = [];
  let departFrom;
  if (killerAtBarEarly) {
    const barStart = 1130 + rng.int(0, 30);
    const barEnd = arriveScene - drive('loc_bar', scene);
    kSegs.push(
      { locId: kHome, start: SIM_START, end: barStart - drive(kHome, 'loc_bar'), activity: 'at home' },
      { locId: 'loc_bar', start: barStart, end: barEnd, activity: 'drinks at the tavern' },
    );
    departFrom = { locId: 'loc_bar', at: barEnd };
  } else {
    const homeEnd = arriveScene - drive(kHome, scene);
    kSegs.push({ locId: kHome, start: SIM_START, end: homeEnd, activity: 'at home' });
    departFrom = { locId: kHome, at: homeEnd };
  }
  // The guaranteed incriminating call must ring while the killer is at the
  // scene AND inside their *claimed* at-home window even after witness fuzz —
  // otherwise the tower contradiction is unprovable. Extend the killer's stay
  // slightly if needed; abandon the attempt if geometry makes it impossible.
  const killerClaimHomeStart = departFrom.at + drive(departFrom.locId, kHome);
  const claimMargin = 2 * killer.personality.fuzz + 10;
  const callMin = Math.max(arriveScene + 1, killerClaimHomeStart + claimMargin);
  if (callMin > murderTime + 26) return null;
  leaveScene = Math.max(leaveScene, Math.min(murderTime + 30, callMin + 4));
  kSegs.push({ locId: scene, start: arriveScene, end: leaveScene, activity: 'AT THE SCENE (murder)' });
  if (skeleton.crime.disposesWeapon) {
    // Detour to the bridge to ditch the weapon, then home.
    const bridgeArrive = leaveScene + drive(scene, 'loc_bridge');
    const bridgeLeave = bridgeArrive + 6;
    kSegs.push(
      { locId: 'loc_bridge', start: bridgeArrive, end: bridgeLeave, activity: 'disposing of the weapon' },
      { locId: kHome, start: bridgeLeave + drive('loc_bridge', kHome), end: SIM_END, activity: 'at home' },
    );
  } else {
    // No weapon to lose (poison, ligature taken, staged) — straight home.
    kSegs.push({ locId: kHome, start: leaveScene + drive(scene, kHome), end: SIM_END, activity: 'at home' });
  }
  setSegs(killer, kSegs);

  // Killer's false alibi: truthful up to departure, then "went straight home".
  killer.claimedSegments = [
    ...kSegs.filter((s) => s.end <= departFrom.at && s.locId !== scene && s.locId !== 'loc_bridge')
      .map((s) => ({ ...s, lie: false })),
    {
      locId: kHome,
      start: departFrom.at + drive(departFrom.locId, kHome),
      end: SIM_END,
      activity: 'at home for the rest of the night',
      lie: true,
    },
  ];

  // --- Competing suspects: real motive, airtight discoverable alibi. -------
  const anchorStart = 1140 + rng.int(0, 15); // ~19:00
  const anchorEnd = skeleton.window.end + rng.int(35, 60);
  const dinnerGuests = [];
  for (const s of competing) {
    if (rng.chance(0.5)) {
      // Anchored at the bar all evening — bartender vouches.
      setSegs(s, [
        { locId: s.homeLocId, start: SIM_START, end: anchorStart - drive(s.homeLocId, 'loc_bar'), activity: 'at home' },
        { locId: 'loc_bar', start: anchorStart, end: anchorEnd, activity: 'at the tavern all evening' },
        { locId: s.homeLocId, start: anchorEnd + drive('loc_bar', s.homeLocId), end: SIM_END, activity: 'home to bed' },
      ]);
      s.anchor = { kind: 'bar' };
    } else {
      // Hosting a dinner guest at home all evening — guest vouches.
      setSegs(s, [
        { locId: s.homeLocId, start: SIM_START, end: SIM_END, activity: 'hosting dinner at home' },
      ]);
      const guest = cast.addChar({
        id: `npc_guest_${s.id}`,
        role: 'npc',
        name: cast.nextName(),
        occupation: NPC_ROLES.dinner_guest,
        guestOf: s.id,
      });
      npcs.push(guest);
      setSegs(guest, [
        { locId: s.homeLocId, start: anchorStart, end: anchorEnd, activity: `dinner at ${s.name}’s home` },
      ]);
      dinnerGuests.push(guest);
      s.anchor = { kind: 'dinner_guest', guestId: guest.id, start: anchorStart, end: anchorEnd };
    }
  }

  // --- Secret-holders: lie about where they were (red herrings). -----------
  for (const s of cast.secretHolders) {
    const h = s.homeLocId;
    if (s.secret.plan === 'motel') {
      const mStart = 1225 + rng.int(0, 30);
      const mEnd = mStart + rng.int(120, 170);
      setSegs(s, [
        { locId: h, start: SIM_START, end: mStart - drive(h, 'loc_motel'), activity: 'at home' },
        { locId: 'loc_motel', start: mStart, end: mEnd, activity: 'meeting someone at the motel' },
        { locId: h, start: mEnd + drive('loc_motel', h), end: SIM_END, activity: 'home late' },
      ]);
      s.claimedSegments = [
        { locId: h, start: SIM_START, end: SIM_END, activity: 'watching television, alone', lie: true },
      ];
    } else if (s.secret.plan === 'bar_backroom') {
      const bStart = 1250 + rng.int(0, 30);
      const bEnd = bStart + rng.int(150, 200);
      setSegs(s, [
        { locId: h, start: SIM_START, end: bStart - drive(h, 'loc_bar'), activity: 'at home' },
        { locId: 'loc_bar', start: bStart, end: bEnd, activity: 'back-room card game', backroom: true },
        { locId: h, start: bEnd + drive('loc_bar', h), end: SIM_END, activity: 'home very late' },
      ]);
      s.claimedSegments = [
        { locId: h, start: SIM_START, end: SIM_END, activity: 'turned in early with a headache', lie: true },
      ];
    } else {
      // office_late: truthful location, lies only about what they were doing.
      const oStart = 1140 + rng.int(0, 30);
      const oEnd = oStart + rng.int(180, 220);
      setSegs(s, [
        { locId: h, start: SIM_START, end: oStart - drive(h, 'loc_office'), activity: 'at home' },
        { locId: 'loc_office', start: oStart, end: oEnd, activity: 'copying files for a rival firm' },
        { locId: h, start: oEnd + drive('loc_office', h), end: SIM_END, activity: 'home' },
      ]);
      s.claimedSegments = segments[s.id].map((seg) => ({
        ...seg,
        activity: seg.locId === 'loc_office' ? 'catching up on routine paperwork' : seg.activity,
        lie: false,
      }));
    }
  }

  // --- Everyone else: ordinary motivated evenings. --------------------------
  for (const s of suspects) {
    if (segments[s.id]) continue;
    const h = s.homeLocId;
    const plan = rng.pick(['homebody', 'bar', 'diner', 'store', 'park']);
    if (plan === 'homebody') {
      setSegs(s, [{ locId: h, start: SIM_START, end: SIM_END, activity: 'home all evening' }]);
    } else if (plan === 'bar') {
      const a = 1160 + rng.int(0, 60);
      const b = a + rng.int(90, 180);
      setSegs(s, [
        { locId: h, start: SIM_START, end: a - drive(h, 'loc_bar'), activity: 'at home' },
        { locId: 'loc_bar', start: a, end: b, activity: 'a few drinks at the tavern' },
        { locId: h, start: b + drive('loc_bar', h), end: SIM_END, activity: 'home' },
      ]);
    } else if (plan === 'diner') {
      const a = 1120 + rng.int(0, 60);
      const b = a + rng.int(40, 70);
      setSegs(s, [
        { locId: h, start: SIM_START, end: a - drive(h, 'loc_diner'), activity: 'at home' },
        { locId: 'loc_diner', start: a, end: b, activity: 'supper at the diner' },
        { locId: h, start: b + drive('loc_diner', h), end: SIM_END, activity: 'home' },
      ]);
    } else if (plan === 'store') {
      const a = 1270 + rng.int(0, 60);
      const b = a + rng.int(10, 20);
      setSegs(s, [
        { locId: h, start: SIM_START, end: a - drive(h, 'loc_store'), activity: 'at home' },
        { locId: 'loc_store', start: a, end: b, activity: 'late run to the market' },
        { locId: h, start: b + drive('loc_store', h), end: SIM_END, activity: 'home' },
      ]);
    } else {
      const a = 1100 + rng.int(0, 40);
      const b = a + rng.int(40, 80);
      setSegs(s, [
        { locId: h, start: SIM_START, end: a - drive(h, 'loc_park'), activity: 'at home' },
        { locId: 'loc_park', start: a, end: b, activity: 'evening walk in the park' },
        { locId: h, start: b + drive('loc_park', h), end: SIM_END, activity: 'home' },
      ]);
    }
  }

  // Honest suspects claim exactly what they did.
  for (const s of suspects) {
    if (!s.claimedSegments) {
      s.claimedSegments = segments[s.id].map((seg) => ({ ...seg, lie: false }));
    }
  }

  // --- Working NPCs. --------------------------------------------------------
  const bartender = npcs.find((n) => n.occupation === NPC_ROLES.bartender);
  const waitress = npcs.find((n) => n.occupation === NPC_ROLES.waitress);
  setSegs(bartender, [{ locId: 'loc_bar', start: SIM_START, end: SIM_END, activity: 'working the bar' }]);
  setSegs(waitress, [{ locId: 'loc_diner', start: SIM_START, end: 1400, activity: 'working at the diner' }]);

  // --- Position lookup (interpolates while traveling). ----------------------
  function positionAt(charId, t) {
    const segs = segments[charId];
    if (!segs || !segs.length) return null;
    if (t <= segs[0].start) return { ...pt(segs[0].locId), locId: segs[0].locId };
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (t >= s.start && t <= s.end) return { ...pt(s.locId), locId: s.locId };
      const nxt = segs[i + 1];
      if (nxt && t > s.end && t < nxt.start) {
        const f = (t - s.end) / (nxt.start - s.end);
        const a = pt(s.locId); const b = pt(nxt.locId);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, locId: null };
      }
    }
    const last = segs[segs.length - 1];
    return { ...pt(last.locId), locId: last.locId };
  }
  const pt = (locId) => ({ x: locs[locId].x, y: locs[locId].y });

  // --- Calls. ---------------------------------------------------------------
  const calls = [];
  const castWithPhones = [victim, ...suspects];
  for (const c of castWithPhones) {
    const n = rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const other = rng.pick(castWithPhones.filter((o) => o !== c));
      const t = rng.int(1020, 1470);
      if (c === victim && t >= murderTime) continue;
      const dead = other === victim && t >= murderTime;
      calls.push({
        t,
        fromId: c.id,
        toId: other.id,
        durationMin: dead ? 0 : rng.int(1, 12),
        unanswered: dead,
      });
    }
  }
  // Guaranteed incriminating call: someone calls the killer while the killer
  // is at the scene. The CDR tower for the killer's phone will sit in the
  // scene's zone while the killer claims to have been home.
  const callerPool = suspects.filter((s) => s !== killer);
  const worried = rng.pick(callerPool);
  const incriminatingCall = {
    t: rng.int(callMin, leaveScene - 2),
    fromId: worried.id,
    toId: killer.id,
    durationMin: rng.int(1, 3),
    keyEvidence: true,
  };
  calls.push(incriminatingCall);
  // 1-2 unanswered calls to the victim after death.
  for (let i = 0; i < rng.int(1, 2); i++) {
    calls.push({
      t: murderTime + rng.int(25, 120),
      fromId: rng.pick(callerPool).id,
      toId: victim.id,
      durationMin: 0,
      unanswered: true,
    });
  }
  calls.sort((a, b) => a.t - b.t);
  for (const call of calls) {
    const fp = positionAt(call.fromId, call.t);
    const tp = positionAt(call.toId, call.t);
    call.fromTower = fp ? nearestTower(map.towers, fp).id : null;
    call.toTower = tp ? nearestTower(map.towers, tp).id : null;
  }

  // --- Sightings: co-location + neighbors. ----------------------------------
  const sightings = [];
  const all = cast.characters.filter((c) => segments[c.id]);
  for (const a of all) {
    for (const b of all) {
      if (a === b || a.role === 'victim') continue;
      for (const sa of segments[a.id]) {
        for (const sb of segments[b.id]) {
          if (sa.locId !== sb.locId) continue;
          if (sa.locId === scene) continue; // nobody witnesses inside the scene
          if (sb.activity === 'deceased') continue;
          const t0 = Math.max(sa.start, sb.start);
          const t1 = Math.min(sa.end, sb.end);
          if (t1 - t0 < 10) continue;
          if (sb.backroom && a.role === 'npc') continue; // bartender keeps quiet about the game
          if (!rng.chance(a.role === 'npc' ? 0.95 : 0.7)) continue;
          sightings.push({ byId: a.id, aboutId: b.id, locId: sa.locId, t0, t1 });
        }
      }
    }
  }
  // Neighbors noticing arrivals home (never at the scene itself).
  for (const a of suspects) {
    for (const b of suspects) {
      if (a === b) continue;
      const ha = locs[a.homeLocId]; const hb = locs[b.homeLocId];
      if (dist(ha, hb) > 1.3) continue;
      const arrivals = segments[b.id].filter((s) => s.locId === b.homeLocId && s.start > SIM_START);
      for (const arr of arrivals) {
        const witnessHome = segments[a.id].some(
          (s) => s.locId === a.homeLocId && s.start <= arr.start && s.end >= arr.start,
        );
        if (witnessHome && rng.chance(0.4)) {
          sightings.push({ byId: a.id, aboutId: b.id, locId: b.homeLocId, t0: arr.start, t1: arr.start, arrival: true });
        }
      }
    }
  }
  // A vague figure seen near the scene (prose-only flavor, added at projection).
  let vagueFigure = null;
  for (const s of suspects) {
    if (s === killer) continue;
    if (dist(locs[s.homeLocId], locs[scene]) > 1.0) continue;
    const home = segments[s.id].some(
      (seg) => seg.locId === s.homeLocId && seg.start <= leaveScene && seg.end >= leaveScene,
    );
    if (home) { vagueFigure = { byId: s.id, at: leaveScene + rng.int(-3, 3) }; break; }
  }

  return {
    segments,
    calls,
    sightings,
    vagueFigure,
    positionAt,
    scene,
    arriveScene,
    leaveScene,
    dinerMealEnd: dinerEnd,
    incriminatingCall,
    dinnerGuests,
  };
}
