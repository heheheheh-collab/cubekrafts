// Gated evidence: content that exists at generation time but is only released
// to players through in-game actions — warrants (financial/estate records),
// lab credits (forensics), CCTV pulls and interrogation. All of it derives
// from the same ground truth, so it can corroborate but never contradict the
// open casefile.

import { fmtTime } from '../time.js';

const NOISE_TX = [
  ['Northside Grocery', -62.4], ['Fuel stop — Route 9', -48.0],
  ['Streaming subscription', -11.99], ['Pharmacy co-pay', -22.5],
  ['Hardware store', -34.75], ['Cash withdrawal — ATM', -60],
  ['Utility payment', -142.1], ['Diner — card purchase', -18.6],
];

function dates(rng, n) {
  // Bank rows over the six weeks before the murder (fictional mid-October).
  const out = [];
  let day = 16; let month = 'Oct';
  for (let i = 0; i < n; i++) {
    out.push(`${month} ${String(day).padStart(2, '0')}`);
    day -= rng.int(2, 5);
    if (day < 1) { day += 30; month = month === 'Oct' ? 'Sep' : 'Aug'; }
  }
  return out;
}

function money(v) {
  const sign = v < 0 ? '-' : '+';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

export function projectGated(rng, map, cast, skeleton, timeline) {
  const { victim, suspects } = cast;
  const killer = cast.killer;

  // ------------------------------------------------------------ financials --
  const financials = {};
  for (const s of suspects) {
    const rows = [];
    const motiveRows = motiveTransactions(rng, s, victim);
    const secretRows = secretTransactions(rng, s);
    const noiseCount = rng.int(6, 9);
    for (let i = 0; i < noiseCount; i++) {
      const [desc, amt] = rng.pick(NOISE_TX);
      rows.push({ desc, amount: money(amt * (0.8 + rng.next() * 0.6)) });
    }
    for (const r of [...motiveRows, ...secretRows]) rows.push(r);
    const ds = dates(rng, rows.length);
    rows.forEach((r, i) => { r.date = ds[i]; });
    financials[s.id] = {
      id: `doc_fin_${s.id}`,
      kind: 'financial_records',
      title: `Financial Records (Warrant) — ${s.name}`,
      payload: { charId: s.id, rows },
      prose: `Six weeks of account activity for ${s.name}, produced under warrant by First Harbor Savings. Flag anything that needs explaining.`,
    };
  }

  // ---------------------------------------------------------------- estate --
  const willHeir = suspects.find((s) => s.motiveId === 'inheritance');
  const insured = suspects.find((s) => s.motiveId === 'insurance');
  const partner = suspects.find((s) => s.motiveId === 'business_dispute');
  const blackmailed = suspects.find((s) => s.motiveId === 'blackmail_victim');
  const estateLines = [
    `Estate file for ${victim.name}, produced under warrant from the offices of Calder & Finch, attorneys.`,
    willHeir
      ? `LAST WILL AND TESTAMENT (revised eight months ago): the bulk of the estate — the business, the house and all accounts — passes to ${willHeir.name}. The previous will divided the estate among several parties; the revision was executed at ${victim.name}’s insistence and witnessed at this office.`
      : `LAST WILL AND TESTAMENT: the estate is divided in modest, unremarkable shares among family and two charities. No recent revisions.`,
    insured
      ? `LIFE INSURANCE: a term policy on ${victim.name}’s life, face value $750,000, names ${insured.name} sole beneficiary. Policy issued twenty months ago; premiums paid punctually — by ${insured.name}, not the insured.`
      : `LIFE INSURANCE: a small burial policy only. No third-party beneficiaries of note.`,
    partner
      ? `BUSINESS PAPERS: a draft dissolution of partnership, prepared at ${victim.name}’s request and unsigned, would force ${partner.name} to accept a buyout at roughly forty cents on the dollar. ${victim.name} intended to serve it within the month.`
      : `BUSINESS PAPERS: filings in good order; no disputes on record.`,
    blackmailed
      ? `BANKING NOTE: ${victim.name}’s personal account shows regular unexplained cash deposits of $500, monthly, for over a year — consistent with income the deceased did not wish to document.`
      : `BANKING NOTE: the deceased’s accounts show nothing irregular.`,
  ];
  const estate = {
    id: 'doc_estate',
    kind: 'estate_file',
    title: `Estate & Insurance File (Warrant) — ${victim.name}`,
    payload: {},
    prose: estateLines.join('\n'),
  };

  // ------------------------------------------------------------------- lab --
  const lab = {
    tumbler: `LATENT PRINTS — second tumbler: the glass was wiped with a cloth after use; no ridge detail recoverable. Conclusion: the guest deliberately removed their prints before leaving. This was not a panicked exit.`,
    weaponFound: `RECOVERY DIVE — ${map.locations.find((l) => l.id === 'loc_bridge').name}: divers recovered a ${skeleton.weapon.name} from the creek bed directly below the span. Blood and hair on the striking surface are consistent with the victim. The handle was wiped; no prints. This is the murder weapon.`,
    weaponNotFound: (locName) => `SEARCH — ${locName}: a full sweep found nothing of evidentiary value. The lab reminds detectives that search resources are not unlimited.`,
    shoeMatch: (name, size) => `FOOTWEAR COMPARISON — ${name}: subject wears size ${size}. The flowerbed impression (men’s size ${killer.shoeSize}–${killer.shoeSize + 1}, deep tread) is CONSISTENT with this subject’s footwear. Not conclusive alone, but they cannot be excluded.`,
    shoeNoMatch: (name, size) => `FOOTWEAR COMPARISON — ${name}: subject wears size ${size}. The flowerbed impression (men’s size ${killer.shoeSize}–${killer.shoeSize + 1}) EXCLUDES this subject as its source.`,
  };

  // -------------------------------------------------------- phone forensics --
  const phoneForensics = {};
  for (const s of suspects) {
    if (s.isKiller) {
      phoneForensics[s.id] = `DEVICE EXTRACTION — ${s.name}: the handset’s message and location history for Friday evening has been manually deleted, and the deletion itself occurred early Saturday morning. Recovery unsuccessful. The examiner notes that innocent people rarely scrub a single evening.`;
    } else if (s.secret?.id === 'affair') {
      phoneForensics[s.id] = `DEVICE EXTRACTION — ${s.name}: recovered deleted messages arrange a meeting at the ${map.locations.find((l) => l.id === 'loc_motel').name} on Friday night (“usual room. don’t be late.”). Nothing connects the exchange to the victim.`;
    } else if (s.secret?.id === 'gambling') {
      phoneForensics[s.id] = `DEVICE EXTRACTION — ${s.name}: messages reference a standing Friday-night card game (“back door after 8:30, buy-in doubled”). Contact numbers are unregistered. Nothing connects the game to the victim.`;
    } else if (s.secret?.id === 'moonlighting') {
      phoneForensics[s.id] = `DEVICE EXTRACTION — ${s.name}: recovered email drafts to a rival firm attach internal client files, sent late Friday evening from the office network. A workplace matter — not a homicide matter.`;
    } else {
      phoneForensics[s.id] = `DEVICE EXTRACTION — ${s.name}: routine traffic only. Nothing deleted, nothing notable for Friday evening.`;
    }
  }

  // ---------------------------------------------------------- interrogation --
  const interviews = {};
  for (const s of suspects) {
    const motiveDefense = s.motiveId
      ? ` We had our differences — I won’t pretend otherwise, you have the paperwork. But differences don’t make me a murderer.`
      : ` We got along fine. Ask anyone.`;
    interviews[s.id] = {
      alibi: `It’s all in my statement, word for word. ${s.claimedSegments?.some((c) => c.lie) ? 'I was where I said I was.' : 'Nothing has changed and nothing will.'} Are we going in circles?`,
      victim: `${victim.name}?${motiveDefense}`,
      deflections: {
        tower_vs_claim: `Cell towers? You’re going to hang a murder on which antenna my phone shook hands with? Those things overlap, drop, re-route — ask the phone company how often they’re wrong. I was home.`,
        sighting_vs_claim: `Then whoever says that is mistaken. It was dark, people had been drinking, and memory is a generous liar. I was home.`,
      },
      lawyer: `No. We’re done. I know how this works — I’m not saying another word without my attorney present.`,
      stonewall: `I don’t see what that has to do with me. My statement stands.`,
      confession: confessionFor(s, map),
    };
  }

  // ------------------------------------------------------------------ cctv --
  const cameras = [
    ['cam_bar', 'loc_bar'], ['cam_diner', 'loc_diner'], ['cam_store', 'loc_store'],
    ['cam_motel', 'loc_motel'], ['cam_bridge', 'loc_bridge'],
  ].map(([id, locId]) => ({
    id,
    locId,
    label: `${map.locations.find((l) => l.id === locId).name} — exterior camera`,
  }));

  return { financials, estate, lab, phoneForensics, interviews, cameras };
}

function confessionFor(s, map) {
  if (!s.secret) return null;
  const motel = map.locations.find((l) => l.id === 'loc_motel').name;
  const bar = map.locations.find((l) => l.id === 'loc_bar').name;
  if (s.secret.id === 'affair') {
    return `…Fine. FINE. I wasn’t home. I was at the ${motel}, and I wasn’t alone, and if this gets out my marriage is over — which is why I lied. Check the motel register, check my phone, check whatever you want. I was there until late and then I drove straight home. I never went anywhere near that house.`;
  }
  if (s.secret.id === 'gambling') {
    return `All right — enough. I was at the ${bar}, in the back room. There’s a card game Fridays; it’s not exactly legal, which is why I kept my mouth shut. Half the table can vouch for me, not that any of them will thank you for asking. I was there past midnight. That’s the whole ugly truth.`;
  }
  if (s.secret.id === 'moonlighting') {
    return `Okay. The “routine paperwork” — I was copying client files. For a competitor. I’m leaving the firm and I wanted leverage; it’s shabby, maybe actionable, but it isn’t murder. I was at that desk the entire evening and the building’s network logs will prove exactly when every file moved.`;
  }
  return `You want the truth? I lied about my evening, but not about the victim. I was somewhere I shouldn’t have been, doing something I’m not proud of. That’s all you get.`;
}

function motiveTransactions(rng, s, victim) {
  const v = victim.name.split(' ')[1];
  switch (s.motiveId) {
    case 'inheritance': return [
      { desc: 'FINAL NOTICE — Meridian Credit Corp', amount: money(-1240.0) },
      { desc: 'Overdraft fee', amount: money(-35) },
      { desc: 'Estate law consultation — Calder & Finch', amount: money(-180) },
    ];
    case 'insurance': return [
      { desc: `Premium — term life policy (insured: ${v})`, amount: money(-212.4) },
      { desc: 'FINAL NOTICE — mortgage arrears', amount: money(-2140.0) },
    ];
    case 'affair_coverup': case 'jealousy': return [
      { desc: 'Florist — cash card reload', amount: money(-90) },
      { desc: 'Starlight Motel', amount: money(-79) },
      { desc: 'Starlight Motel', amount: money(-79) },
    ];
    case 'business_dispute': case 'business_rivalry': return [
      { desc: 'Payroll shortfall transfer', amount: money(-4800) },
      { desc: 'Loan interest — commercial line', amount: money(-1975.5) },
      { desc: 'RETURNED — supplier payment (insufficient funds)', amount: money(-2210) },
    ];
    case 'embezzlement_coverup': return [
      { desc: 'Deposit — unexplained', amount: money(2400) },
      { desc: 'Deposit — unexplained', amount: money(3100) },
      { desc: 'Deposit — unexplained', amount: money(2750) },
    ];
    case 'revenge_firing': return [
      { desc: 'Payroll deposit — FINAL', amount: money(1890) },
      { desc: 'Unemployment claim pending', amount: money(0) },
      { desc: 'FINAL NOTICE — auto loan', amount: money(-410) },
    ];
    case 'eviction_dispute': return [
      { desc: `Rent arrears — to ${v} Properties`, amount: money(-1600) },
      { desc: 'RETURNED — rent payment (insufficient funds)', amount: money(-800) },
    ];
    case 'unpaid_debt': case 'gambling_debt': return [
      { desc: `Transfer to ${v} — “loan, partial”`, amount: money(-500) },
      { desc: `Transfer to ${v} — “loan, partial”`, amount: money(-250) },
      { desc: 'Cash advance — credit line', amount: money(900) },
    ];
    case 'blackmail_victim': return [
      { desc: 'Cash withdrawal — $500', amount: money(-500) },
      { desc: 'Cash withdrawal — $500', amount: money(-500) },
      { desc: 'Cash withdrawal — $500', amount: money(-500) },
    ];
    case 'property_dispute': return [
      { desc: 'Land survey — Hollis & Partners', amount: money(-950) },
      { desc: 'Legal fees — boundary action', amount: money(-2300) },
    ];
    case 'old_grudge': return [
      { desc: 'Legal consultation — family trust', amount: money(-260) },
    ];
    default: return [];
  }
}

function secretTransactions(rng, s) {
  if (s.secret?.id === 'affair') {
    return [{ desc: 'Driftwood Inn / motel charge', amount: money(-79) }, { desc: 'Driftwood Inn / motel charge', amount: money(-79) }];
  }
  if (s.secret?.id === 'gambling') {
    return [{ desc: 'Cash withdrawal — late night', amount: money(-300) }, { desc: 'Cash withdrawal — late night', amount: money(-400) }];
  }
  if (s.secret?.id === 'moonlighting') {
    return [{ desc: 'Deposit — RQ Consulting (retainer)', amount: money(1500) }];
  }
  return [];
}

export function cctvPull(caseData, cameraId, windowStart, windowEnd) {
  const cams = caseData.gated.cameras;
  const cam = cams.find((c) => c.id === cameraId);
  if (!cam) return null;
  const nameOf = Object.fromEntries(caseData.hidden.cast.map((c) => [c.id, c.name]));
  const lines = [];
  for (const [charId, segs] of Object.entries(caseData.hidden.segments)) {
    const who = nameOf[charId] || 'unidentified person';
    for (const seg of segs) {
      if (seg.locId !== cam.locId) continue;
      if (seg.activity === 'deceased') continue;
      if (seg.end < windowStart || seg.start > windowEnd) continue;
      if (cam.locId === 'loc_bridge') {
        lines.push({ t: seg.start, text: `${fmtTime(seg.start)} — vehicle stops mid-span; driver positively identified as ${who}; exits toward the rail, out of frame ~${Math.max(1, seg.end - seg.start)} min, departs ${fmtTime(seg.end)}.` });
        continue;
      }
      if (seg.start >= windowStart && seg.start <= windowEnd) {
        lines.push({ t: seg.start, text: `${fmtTime(seg.start)} — ${who} arrives.` });
      }
      if (seg.end >= windowStart && seg.end <= windowEnd) {
        lines.push({ t: seg.end, text: `${fmtTime(seg.end)} — ${who} departs.` });
      }
      if (seg.start < windowStart && seg.end > windowEnd) {
        lines.push({ t: windowStart, text: `${who} on premises throughout the requested window.` });
      }
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return {
    cam,
    lines: lines.map((l) => l.text),
    empty: lines.length === 0,
  };
}
