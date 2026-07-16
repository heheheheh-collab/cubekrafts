// Renders a generated case as a human-readable markdown dossier — the
// pre-UI way to actually play a case (print it, hand it to friends).

import { fmtTime } from './time.js';

export function renderDossier(caseData, { spoilers = false } = {}) {
  const out = [];
  const nameOf = Object.fromEntries(caseData.hidden.cast.map((c) => [c.id, c.name]));
  out.push(`# ${caseData.title}`);
  out.push(`*Case ${caseData.id} · ${caseData.town} · tier: ${caseData.tier} · seed: \`${caseData.seed}\`*`);
  out.push('');
  out.push('> You are the detective. Somewhere in these documents is exactly one person with the motive, the opportunity and a provable lie. Name the killer — and be ready to show your evidence.');

  for (const doc of caseData.documents) {
    out.push('', '---', '', `## ${doc.title}`);
    if (doc.prose) out.push('', doc.prose.split('\n').join('\n\n'));

    if (doc.kind === 'crime_scene') {
      out.push('');
      for (const m of doc.payload.markers) out.push(`**[${m.n}] ${m.label}.** ${m.detail}`, '');
    }
    if (doc.kind === 'call_logs') {
      out.push('', '| Time | From | To | Duration | From tower | To tower | Note |', '|---|---|---|---|---|---|---|');
      for (const r of doc.payload.rows) {
        out.push(`| ${fmtTime(r.time)} | ${label(r.fromCharId, r.from, nameOf)} | ${label(r.toCharId, r.to, nameOf)} | ${r.durationMin} min | ${r.fromTower ?? '—'} | ${r.toTower ?? '—'} | ${r.note || ''} |`);
      }
      out.push('', '**Subscriber index:** ' + doc.payload.subscribers.map((s) => `${s.name} = ${s.number}`).join(' · '));
    }
    if (doc.kind === 'background_checks') {
      out.push('');
      for (const r of doc.payload.rows) {
        out.push(`**${r.name}**, ${r.age}, ${r.occupation} — ${r.relationship}.`);
        out.push(`  ${r.motiveNote}`, '');
      }
    }
    if (doc.kind === 'map') {
      out.push('', '| Location | Kind | Grid (km) |', '|---|---|---|');
      for (const l of doc.payload.locations) out.push(`| ${l.name} | ${l.kind} | (${l.x}, ${l.y}) |`);
      out.push('', '| Cell site | Grid (km) |', '|---|---|');
      for (const t of doc.payload.towers) out.push(`| ${t.id} — ${t.name} | (${t.x}, ${t.y}) |`);
    }
  }

  if (spoilers) {
    const s = caseData.solution;
    out.push('', '---', '', '## ⚠️ SOLUTION — SPOILERS', '');
    out.push(`**The killer is ${s.killerName}.** Motive: ${s.motiveLabel}. Weapon: ${s.weapon}. Time of the murder: ${s.murderTimeText}.`, '');
    out.push('**The fair path to the answer:**', '');
    s.keyEvidence.forEach((k, i) => out.push(`${i + 1}. ${k}`));
  }

  out.push('');
  return out.join('\n');
}

function label(charId, number, nameOf) {
  return charId && nameOf[charId] ? `${nameOf[charId]} (${number})` : number;
}
