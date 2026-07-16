// Cast generation: victim, suspects with relationships, killer + motive,
// competing (innocent) suspects with motives, secret-holders.

import {
  FIRST_NAMES, LAST_NAMES, OCCUPATIONS, VICTIM_OCCUPATIONS, PERSONALITIES,
  RELATIONSHIPS, SECRETS, NPC_ROLES, TIERS,
} from '../data/pools.js';

export function generateCast(rng, map, tier) {
  const cfg = TIERS[tier];
  const firsts = rng.shuffle(FIRST_NAMES);
  const lasts = rng.shuffle(LAST_NAMES);
  let nameIdx = 0;
  const nextName = () => {
    const name = `${firsts[nameIdx % firsts.length]} ${lasts[nameIdx % lasts.length]}`;
    nameIdx++;
    return name;
  };

  const characters = [];
  let phoneIdx = 10;
  const addChar = (props) => {
    const c = {
      phone: `555-01${String(phoneIdx++).padStart(2, '0')}`,
      personality: rng.pick(PERSONALITIES),
      ...props,
    };
    characters.push(c);
    return c;
  };

  const victimName = nextName();
  const victim = addChar({
    id: 'victim',
    role: 'victim',
    name: victimName,
    age: rng.int(48, 72),
    occupation: rng.pick(VICTIM_OCCUPATIONS),
  });
  victim.homeLocId = map.addHome('victim', `${victimName.split(' ')[1]}`).id;

  const nSuspects = rng.int(cfg.suspects[0], cfg.suspects[1]);
  const rels = rng.shuffle(RELATIONSHIPS).slice(0, nSuspects);
  const suspects = rels.map((rel, i) => {
    const name = nextName();
    // Spouse/sibling share the victim's surname sometimes.
    const displayName = ['spouse', 'sibling'].includes(rel.id) && rng.chance(0.6)
      ? `${name.split(' ')[0]} ${victimName.split(' ')[1]}`
      : name;
    const s = addChar({
      id: `suspect_${i + 1}`,
      role: 'suspect',
      name: displayName,
      age: rng.int(26, 68),
      occupation: rng.pick(OCCUPATIONS),
      relationship: rel,
      shoeSize: rng.int(6, 13),
    });
    s.homeLocId = map.addHome(s.id, displayName.split(' ').slice(-1)[0]).id;
    return s;
  });

  // Killer + motive. Killers keep their story tight: high-error personalities
  // would blur the claimed timeline so much the lie becomes unprovable.
  const killer = rng.pick(suspects);
  killer.isKiller = true;
  killer.motiveId = rng.pick(killer.relationship.motives);
  if (killer.personality.fuzz > 10) {
    killer.personality = rng.pick(PERSONALITIES.filter((p) => p.fuzz <= 10));
  }

  // Competing suspects: innocents who ALSO have a real motive. The generator
  // must later give each an airtight (discoverable) alibi.
  const others = suspects.filter((s) => s !== killer);
  const competing = rng.pickN(others, Math.min(cfg.competing, others.length));
  for (const s of competing) {
    s.motiveId = rng.pick(s.relationship.motives);
    s.isCompeting = true;
  }

  // Secret-holders: innocents WITHOUT motives who will lie anyway (red herrings).
  const plain = others.filter((s) => !s.isCompeting);
  const secretHolders = rng.pickN(plain, Math.min(cfg.secrets, plain.length));
  const secrets = rng.shuffle(SECRETS);
  secretHolders.forEach((s, i) => {
    s.secret = secrets[i % secrets.length];
  });

  // NPCs (witnesses, never suspects).
  const npcs = [
    addChar({ id: 'npc_bartender', role: 'npc', name: nextName(), occupation: NPC_ROLES.bartender }),
    addChar({ id: 'npc_waitress', role: 'npc', name: nextName(), occupation: NPC_ROLES.waitress }),
  ];

  return { characters, victim, suspects, killer, competing, secretHolders, npcs, nextName, addChar };
}
