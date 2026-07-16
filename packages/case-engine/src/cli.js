#!/usr/bin/env node
// Usage:
//   node src/cli.js --seed my-seed --tier detective
//   node src/cli.js --seed 42 --dossier case.md --spoilers
//   node src/cli.js --seed 42 --json case.json

import { writeFileSync } from 'node:fs';
import { generateCase } from './generate.js';
import { renderDossier } from './dossier.js';
import { fmtTime } from './time.js';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const seed = opt('seed', `case-${Date.now()}`);
const tier = opt('tier', 'detective');

const t0 = Date.now();
const caseData = generateCase(seed, { tier });
const ms = Date.now() - t0;

console.log(`Generated "${caseData.title}" (${caseData.id})`);
console.log(`  town: ${caseData.town} · tier: ${tier} · seed: ${seed}`);
console.log(`  documents: ${caseData.documents.length} · suspects: ${caseData.meta.solverReport ? Object.keys(caseData.meta.solverReport.perSuspect).length : '?'}`);
console.log(`  solver: proved unique solution in attempt ${caseData.meta.attempts} (${ms} ms total)`);
console.log(`  death window (autopsy): ${fmtTime(caseData.meta.solverReport.window.start)} – ${fmtTime(caseData.meta.solverReport.window.end)}`);

const jsonOut = opt('json');
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(caseData, null, 2));
  console.log(`  wrote case JSON -> ${jsonOut}`);
}
const dossierOut = opt('dossier');
if (dossierOut) {
  writeFileSync(dossierOut, renderDossier(caseData, { spoilers: flag('spoilers') }));
  console.log(`  wrote dossier -> ${dossierOut}${flag('spoilers') ? ' (with solution)' : ''}`);
}
if (flag('reveal')) {
  console.log(`\n  SPOILER — killer: ${caseData.solution.killerName} (${caseData.solution.motiveLabel}, ${caseData.solution.weapon})`);
}
if (!jsonOut && !dossierOut) {
  console.log('\nPass --dossier <file.md> to write the playable casefile (add --spoilers for the solution), or --json <file.json> for raw data.');
}
