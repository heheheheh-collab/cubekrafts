// Crime types. Each defines the murder method(s), the cause of death, the
// autopsy body, and the crime-scene forensic markers — so the two documents
// players read every game (autopsy + crime scene) are genuinely different from
// case to case, not just re-skinned. The solvable structure is unchanged: the
// killer is admitted to the scene, and their claimed alibi is broken by the
// phone-tower record during the death window.
//
// `disposesWeapon` decides whether the killer detours to the bridge to ditch a
// physical weapon (recoverable by a lab dive) or goes straight home.

import { fmtTime } from '../time.js';

// Shared markers present at most indoor "let the guest in" scenes.
function entryMarker() {
  return { n: 3, label: 'Point of entry', detail: 'No forced entry. Front door lock undamaged; rear windows latched from inside. The victim very likely admitted the attacker voluntarily.' };
}
function glassMarker(poisoned) {
  return {
    n: 4,
    label: 'Glassware',
    detail: poisoned
      ? 'Two used tumblers on the sideboard. One bears the victim’s prints; the second was wiped clean. Trace residue in the victim’s glass has been sent for toxicology — the drink is the likeliest vehicle.'
      : 'Two used tumblers on the sideboard, one bearing the victim’s prints, the second wiped clean. The victim appears to have poured a drink for a guest who cleaned up after themselves.',
  };
}
function footwearMarker(killer) {
  return { n: 5, label: 'Footwear impression', detail: `Partial sole impression in the flowerbed beneath the window, men’s size ${killer.shoeSize}–${killer.shoeSize + 1}, deep tread, heading away from the house.` };
}

export const CRIME_TYPES = [
  {
    id: 'blunt_force',
    label: 'blunt-force homicide',
    disposesWeapon: true,
    rooms: ['study', 'library', 'front hall'],
    methods: [
      { name: 'heavy brass candlestick', autopsy: 'a heavy, rigid object with a narrow cylindrical striking surface' },
      { name: 'cast-iron fireplace poker', autopsy: 'a slender, dense metal rod' },
      { name: 'large pipe wrench', autopsy: 'a heavy metal tool with an irregular, toothed edge' },
      { name: 'marble bookend', autopsy: 'a blunt object with a broad, flat face and squared edge' },
      { name: 'brass sailing trophy', autopsy: 'a rigid metal object with a heavy weighted base' },
    ],
    causeOfDeath: 'blunt force trauma to the head',
    autopsy: (x) => [
      `Cause of death: blunt force trauma to the posterior right parietal region; single impact; immediate incapacitation, death within minutes.`,
      `Wound morphology is consistent with ${x.method.autopsy}, delivered with substantial force by an assailant standing behind the victim. No defensive wounds — the victim did not anticipate the attack.`,
      todLine(x),
      gastricLine(x, 'blood alcohol consistent with a single drink; no drugs detected'),
    ],
    scene: (x) => [
      { n: 1, label: 'Body position', detail: `Victim found prone in the ${x.room}, facing the desk. Lividity fixed and consistent with the position found — the body was not moved after death.` },
      { n: 2, label: 'Blood evidence', detail: 'Cast-off pattern on the wall indicates a single heavy blow struck from behind and slightly above. No spatter trail leading away.' },
      entryMarker(), glassMarker(false), footwearMarker(x.killer),
      { n: 6, label: 'Weapon', detail: 'No weapon recovered at the scene. Wound characteristics suggest a heavy blunt object removed by the attacker.' },
    ],
  },
  {
    id: 'stabbing',
    label: 'fatal stabbing',
    disposesWeapon: true,
    rooms: ['kitchen', 'study', 'drawing room'],
    methods: [
      { name: 'kitchen carving knife', autopsy: 'a single-edged blade roughly 15 cm long' },
      { name: 'folding hunting knife', autopsy: 'a single-edged blade with a clip point' },
      { name: 'pair of workshop shears', autopsy: 'a narrow, tapering double-edged instrument' },
    ],
    causeOfDeath: 'exsanguination from a stab wound',
    autopsy: (x) => [
      `Cause of death: a single penetrating stab wound to the left chest severing a major vessel; death from blood loss within a few minutes.`,
      `The wound track is consistent with ${x.method.autopsy}, angled slightly upward — the assailant was at or below the victim’s height, likely facing them. Shallow incised wounds to the right palm indicate the victim raised a hand to defend themselves.`,
      todLine(x),
      gastricLine(x, 'blood alcohol consistent with one drink; no drugs detected'),
    ],
    scene: (x) => [
      { n: 1, label: 'Body position', detail: `Victim found supine in the ${x.room} in a large pool of blood. Lividity consistent with the position — the body was not moved.` },
      { n: 2, label: 'Blood evidence', detail: 'Arterial spatter across the lower cabinets and a partial bloody shoe transfer leading toward the back door. Someone left in a hurry.' },
      entryMarker(), glassMarker(false), footwearMarker(x.killer),
      { n: 6, label: 'Weapon', detail: 'No blade recovered at the scene. The wound profile indicates a single-edged knife taken away by the attacker.' },
    ],
  },
  {
    id: 'poisoning',
    label: 'poisoning',
    disposesWeapon: false,
    rooms: ['drawing room', 'kitchen', 'study'],
    methods: [
      { name: 'a lethal dose of a sedative in a drink', autopsy: 'a fatal concentration of a benzodiazepine sedative' },
      { name: 'antifreeze slipped into a nightcap', autopsy: 'a fatal concentration of ethylene glycol' },
      { name: 'an overdose of the victim’s own heart medication', autopsy: 'a fatal concentration of digoxin' },
    ],
    causeOfDeath: 'acute poisoning',
    autopsy: (x) => [
      `Cause of death: acute poisoning. There is no external trauma; the death was not violent and would have looked, at first glance, natural.`,
      `Toxicology returned ${x.method.autopsy}, well above the lethal threshold. Onset would have been gradual over an hour or more — the victim likely felt unwell before collapsing, and could not have dosed themselves this heavily by accident.`,
      todLine(x, 'the progression of the toxin, body temperature and lividity'),
      gastricLine(x, `the toxin was present in the gastric contents, consistent with ingestion in a drink shared shortly before death`),
    ],
    scene: (x) => [
      { n: 1, label: 'Body position', detail: `Victim found slumped in an armchair in the ${x.room}, no signs of a struggle. Lividity consistent with the position found.` },
      { n: 2, label: 'No violence', detail: 'The room is undisturbed. No blood, no weapon, nothing broken. If not for the autopsy this would read as a natural death — which appears to have been the point.' },
      entryMarker(), glassMarker(true), footwearMarker(x.killer),
      { n: 6, label: 'The second glass', detail: 'The wiped tumbler is the crux: someone shared a last drink with the victim and cleaned their glass before leaving.' },
    ],
  },
  {
    id: 'gunshot',
    label: 'shooting',
    disposesWeapon: true,
    rooms: ['study', 'front hall', 'garage'],
    methods: [
      { name: 'a small-calibre handgun', autopsy: 'a single gunshot from a small-calibre handgun' },
      { name: 'a .38 revolver', autopsy: 'a single gunshot consistent with a .38 revolver' },
    ],
    causeOfDeath: 'a single gunshot wound',
    autopsy: (x) => [
      `Cause of death: a single gunshot wound to the chest; death within minutes.`,
      `Wounding is consistent with ${x.method.autopsy}, fired from roughly two to three metres — no soot or stippling, so not a contact shot. No defensive injuries.`,
      todLine(x),
      gastricLine(x, 'blood alcohol consistent with one drink; no drugs detected'),
    ],
    scene: (x) => [
      { n: 1, label: 'Body position', detail: `Victim found on the ${x.room} floor. Lividity consistent with the position — the body was not moved.` },
      { n: 2, label: 'Ballistics', detail: 'A single spent shell casing recovered near the doorway. No firearm at the scene — the weapon was taken away. Gun-registry checks are attached to the background summaries.' },
      entryMarker(), glassMarker(false), footwearMarker(x.killer),
      { n: 6, label: 'Residue', detail: 'No powder residue on the victim’s hands — this was not self-inflicted.' },
    ],
  },
  {
    id: 'strangulation',
    label: 'strangulation',
    disposesWeapon: false,
    rooms: ['bedroom', 'study', 'drawing room'],
    methods: [
      { name: 'a length of electrical cord', autopsy: 'ligature strangulation with a thin, flexible cord' },
      { name: 'a leather belt', autopsy: 'ligature strangulation with a broad, flat band' },
      { name: 'a silk scarf', autopsy: 'ligature strangulation with a soft, wide ligature leaving no distinct pattern' },
    ],
    causeOfDeath: 'asphyxiation by ligature strangulation',
    autopsy: (x) => [
      `Cause of death: asphyxiation by ligature strangulation. Petechial haemorrhaging in the eyes and a patterned furrow across the throat confirm it.`,
      `The ligature furrow is consistent with ${x.method.autopsy}. Bruising to the forearms and broken fingernails show the victim struggled — this was close, and personal. The ligature was taken away.`,
      todLine(x),
      gastricLine(x, 'blood alcohol consistent with one drink; no drugs detected'),
    ],
    scene: (x) => [
      { n: 1, label: 'Body position', detail: `Victim found in the ${x.room}. Signs of a struggle — an overturned lamp and a rucked-up rug. Lividity consistent with the final position.` },
      { n: 2, label: 'Struggle', detail: 'Defensive disarray suggests a face-to-face attack by someone strong enough to overpower the victim. No ligature left behind.' },
      entryMarker(), glassMarker(false), footwearMarker(x.killer),
      { n: 6, label: 'No weapon', detail: 'No ligature recovered. The attacker removed whatever was used.' },
    ],
  },
  {
    id: 'staged_fall',
    label: 'a murder staged as an accident',
    disposesWeapon: false,
    rooms: ['cellar stairs', 'main staircase'],
    methods: [
      { name: 'a blow to the head, then staged as a fall', autopsy: 'a single blunt impact inconsistent with a fall' },
      { name: 'a shove down the stairs after an initial blow', autopsy: 'blunt trauma preceding the fall' },
    ],
    causeOfDeath: 'blunt cranial trauma — staged to resemble an accidental fall',
    autopsy: (x) => [
      `Presenting scene: the victim was found at the foot of the ${x.room}, apparently having fallen.`,
      `But the injuries don't fit. There is a single deep impact to the crown of the head — ${x.method.autopsy} — with none of the scattered bruising a tumble down stairs produces. The fatal blow was struck first; the fall was arranged afterward. This is a homicide dressed as an accident.`,
      todLine(x),
      gastricLine(x, 'blood alcohol consistent with one drink; no drugs detected'),
    ],
    scene: (x) => [
      { n: 1, label: 'Body position', detail: `Victim found at the foot of the ${x.room} — positioned to look like a fall. Lividity, however, shows the body lay flat elsewhere for a time before being moved here.` },
      { n: 2, label: 'Inconsistent with a fall', detail: 'A single clean impact wound, no railing scuff marks, no defensive tumbling injuries. The scene was staged.' },
      entryMarker(), glassMarker(false), footwearMarker(x.killer),
      { n: 6, label: 'Staging', detail: 'The rug at the top of the stairs was deliberately disarranged. Whoever did this wanted it closed as an accident.' },
    ],
  },
];

function todLine(x, basis) {
  return `Time of death: based on ${basis || 'core temperature, fixed lividity and the state of rigor at examination'}, death is placed between ${fmtTime(x.windowStart)} and ${fmtTime(x.windowEnd)}.`;
}
function gastricLine(x, tox) {
  return `Gastric contents: partially digested ${x.meal}, consumed approximately two to three hours before death. Toxicology: ${tox}.`;
}

// Every method name across all crime types — the accusation's weapon/method list.
export const ALL_METHODS = CRIME_TYPES.flatMap((c) => c.methods.map((m) => m.name));
