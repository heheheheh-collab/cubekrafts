// Seeded, deterministic RNG. Same seed string => identical stream, forever.

function xfnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  const seedStr = String(seed);
  let state = xfnv1a(seedStr) || 1;

  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    seed: seedStr,
    next,
    /** integer in [min, max] inclusive */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(arr) {
      if (!arr.length) throw new Error('pick from empty array');
      return arr[Math.floor(next() * arr.length)];
    },
    /** pick n distinct elements */
    pickN(arr, n) {
      return this.shuffle(arr).slice(0, n);
    },
    shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    chance(p) {
      return next() < p;
    },
    /** independent child stream — stable regardless of how much the parent is consumed */
    fork(label) {
      return createRng(`${seedStr}::${label}`);
    },
  };
}
