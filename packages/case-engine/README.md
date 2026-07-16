# @coldtrail/case-engine

The procedural case generator for **Cold Trail** (see [`docs/DETECTIVE_GAME_PLAN.md`](../../docs/DETECTIVE_GAME_PLAN.md), Section 5). Zero dependencies, pure ESM, fully deterministic: a seed is a case.

## What it does

Each call to `generateCase(seed, { tier })` runs the full pipeline from the plan:

1. **Skeleton** — town, murder time, weapon, death window (seeded RNG).
2. **Map** — a fictional town on an 8×8 km grid: homes, tavern, diner, motel, office, park, bridge, plus four cell towers. Travel times are derived from geometry, so alibi-breaking is geometric.
3. **Cast** — victim + 6–11 suspects with relationships, a killer with a matched motive, 2–3 *competing* suspects who also have real motives, and secret-holders who lie about the evening for reasons that have nothing to do with the murder (red herrings).
4. **Timeline** — a minute-resolution ground-truth simulation of every character's evening, including the murder, the weapon dump, phone calls, and who saw whom where.
5. **Evidence projection** — the visible casefile is rendered *from* the timeline: briefing, crime-scene report, autopsy (with a real time-of-death window and gastric-content cross-reference), subpoenaed call records with cell-tower registrations, background checks, an area map, and a witness statement per suspect and NPC. Witness times carry personality-based error; phone records are exact; liars' statements come from their `claimedSegments`, not the truth.
6. **Solvability proof** — a solver that reads *only the visible documents* must (a) exonerate every innocent motive-holder geometrically, (b) find the killer feasible, and (c) catch at least one of the killer's lies via cross-reference (tower vs. claim, or witness vs. claim). If the proof fails, the attempt is discarded and regenerated from a derived seed. A case only ships with a proven unique solution.

## Usage

```bash
# generate a case and write a playable markdown dossier
node src/cli.js --seed friday-night --tier detective --dossier case.md

# include the solution and the fair deductive path
node src/cli.js --seed friday-night --tier detective --dossier case.md --spoilers

# raw JSON (documents + hidden ground truth + solver report)
node src/cli.js --seed friday-night --json case.json

npm test   # determinism, solvability, variety, consistency, convergence
```

```js
import { generateCase, solveCase, renderDossier } from '@coldtrail/case-engine';

const c = generateCase('any-string-or-number', { tier: 'detective' }); // or 'rookie'
c.documents;          // the visible casefile — safe to send to players
c.solution;           // killer, motive, weapon, time, and the fair evidence path
c.hidden;             // full ground truth — server-side only, for the debrief
solveCase(c.documents).solved; // true, by construction
```

## Invariants (enforced by tests)

- Same seed → byte-identical case. Different seeds → different cases.
- The true murder time always lies inside the autopsy window.
- Honest witnesses' claims never drift beyond their personality's error margin.
- The hidden ground truth never leaks into any visible document.
- Generation converges in a handful of attempts (~1.7 avg), fast enough to bank thousands of cases offline.

## Gated evidence (v0.2)

Beyond the open casefile, `caseData.gated` carries server-only content that the game releases through player actions, all derived from the same ground truth:

- **Financial records** per suspect and the victim's **estate & insurance file** (warrant-gated) — motive-corroborating transactions woven into six weeks of noise.
- **Lab results** — wiped-tumbler prints, footwear comparisons against real shoe sizes, device extractions (the killer's phone is scrubbed; secret-holders' deleted texts survive), and the weapon-recovery dive at the dump site.
- **Interrogation content** — per-suspect alibi/victim answers, killer deflections and the lawyer-up line, and full secret confessions for red herrings. Which confrontations "bite" is decided by the solver's proven contradictions, so interrogation can never leak beyond what the evidence supports.
- **CCTV** — a public camera index plus `cctvPull(caseData, cameraId, from, to)` that renders identified sightings from the hidden timeline on demand.

## Current scope vs. the plan

This is the Phase 1 vertical slice plus the Phase 4 depth systems (interrogation, warrants, lab credits, CCTV, financials): one crime type (blunt-force homicide at the victim's home), one evening window, rookie + detective tiers. More crime types/settings, higher tiers, and the LLM prose-polish pass layer on top of the same canon structure.
