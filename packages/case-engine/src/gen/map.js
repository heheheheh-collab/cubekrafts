// Map generation: fictional town on an 8x8 km grid, venues, homes, cell towers.

import { STREETS, VENUE_NAMES } from '../data/pools.js';

export const TRAVEL = { driveMinPerKm: 4, driveOverhead: 3, walkMinPerKm: 12 };

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function driveMinutes(a, b) {
  const d = dist(a, b);
  if (d < 0.05) return 0;
  return Math.round(d * TRAVEL.driveMinPerKm) + TRAVEL.driveOverhead;
}

export function nearestTower(towers, point) {
  let best = towers[0];
  for (const t of towers) if (dist(t, point) < dist(best, point)) best = t;
  return best;
}

export function generateMap(rng, town) {
  const streets = rng.shuffle(STREETS);
  let streetIdx = 0;
  const nextStreet = () => streets[streetIdx++ % streets.length];

  const locations = [];
  const addLoc = (id, kind, name, x, y) => {
    const loc = { id, kind, name, x: +x.toFixed(2), y: +y.toFixed(2) };
    locations.push(loc);
    return loc;
  };

  const spot = () => ({ x: 0.5 + rng.next() * 7, y: 0.5 + rng.next() * 7 });

  const venues = {};
  for (const kind of ['bar', 'diner', 'motel', 'office', 'store', 'park', 'bridge']) {
    const p = spot();
    venues[kind] = addLoc(`loc_${kind}`, kind, rng.pick(VENUE_NAMES[kind]), p.x, p.y);
  }

  // Four cell towers, one per quadrant with jitter.
  const towers = [
    { x: 2, y: 2 }, { x: 6, y: 2 }, { x: 2, y: 6 }, { x: 6, y: 6 },
  ].map((c, i) => ({
    id: `tower_${i + 1}`,
    name: `${town} Cell Site ${i + 1}`,
    x: +(c.x + (rng.next() * 2 - 1)).toFixed(2),
    y: +(c.y + (rng.next() * 2 - 1)).toFixed(2),
  }));

  return {
    town,
    locations,
    venues,
    towers,
    addHome(char, label) {
      const p = spot();
      const num = rng.int(3, 89);
      return addLoc(`home_${char}`, 'home', `${label} residence, ${num} ${nextStreet()}`, p.x, p.y);
    },
  };
}
