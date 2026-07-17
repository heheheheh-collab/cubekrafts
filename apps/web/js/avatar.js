// Deterministic composite-portrait "case photos". Each suspect gets a distinct
// illustrated face (skin tone, face shape, hair, brows, eyes, nose, mouth,
// facial hair, glasses) built from a hash of their id, framed on a booking
// height-board. Inline SVG data URI — no network, no image files, works in
// production and adapts to every procedurally generated suspect.

function makeRng(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIN = ['#f0d0b0', '#e6b98f', '#d29b6e', '#b97f50', '#96603a', '#6f4526', '#e8c4a0', '#c98b5a'];
const HAIR = ['#241a12', '#3d2b1a', '#5a3d24', '#7a5a34', '#a9895a', '#c9b489', '#3a3a3a', '#8f8f8f', '#d8d3c8'];
const SHIRT = ['#3e4a5b', '#5b3e3e', '#3e5b45', '#494954', '#6b5b3e', '#2f3038', '#4a3f5b'];

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

export function avatarDataUri(seed) {
  const r = makeRng(seed);
  const skin = pick(r, SKIN);
  const skinDark = shade(skin, -18);
  const hair = pick(r, HAIR);
  const shirt = pick(r, SHIRT);
  const cx = 50;
  const headY = 52; const rx = 21; const ry = 25;
  const faceShape = Math.floor(r() * 3); // 0 oval, 1 round, 2 square-ish
  const hairStyle = Math.floor(r() * 6); // incl bald
  const brow = 0.5 + r() * 0.6;
  const eyeGap = 11 + r() * 2;
  const beard = r() < 0.4;
  const mustache = beard ? r() < 0.5 : r() < 0.18;
  const glasses = r() < 0.28;
  const smile = r() < 0.25 ? 1 : (r() < 0.3 ? -1 : 0);

  const headPath = faceShape === 2
    ? `<rect x="${cx - rx}" y="${headY - ry}" width="${rx * 2}" height="${ry * 2}" rx="9" fill="${skin}"/>`
    : `<ellipse cx="${cx}" cy="${headY}" rx="${faceShape === 1 ? rx + 1 : rx}" ry="${faceShape === 1 ? ry - 2 : ry}" fill="${skin}"/>`;

  const eyeY = headY - 2;
  const eye = (dx) => `<ellipse cx="${cx + dx}" cy="${eyeY}" rx="3.4" ry="2.4" fill="#f6f2ea"/>`
    + `<circle cx="${cx + dx + (dx > 0 ? -0.3 : 0.3)}" cy="${eyeY + 0.3}" r="1.5" fill="#3a2b20"/>`;
  const browShape = (dx) => `<path d="M${cx + dx - 4},${eyeY - 4 - brow} q4,-2.2 8,0" stroke="${shade(hair, -10)}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;

  const mouthPath = smile === 1
    ? `<path d="M${cx - 5},${headY + 12} q5,4 10,0" stroke="${shade(skin, -34)}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
    : smile === -1
      ? `<path d="M${cx - 5},${headY + 13} q5,-3 10,0" stroke="${shade(skin, -34)}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
      : `<line x1="${cx - 4.5}" y1="${headY + 12.5}" x2="${cx + 4.5}" y2="${headY + 12.5}" stroke="${shade(skin, -34)}" stroke-width="1.4" stroke-linecap="round"/>`;

  const nose = `<path d="M${cx},${eyeY + 2} q-2.4,6 -1,8 q1.4,1.4 2,0" stroke="${skinDark}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;

  const beardSvg = beard
    ? `<path d="M${cx - rx + 3},${headY + 1} Q${cx - rx + 3},${headY + ry - 3} ${cx},${headY + ry - 1} Q${cx + rx - 3},${headY + ry - 3} ${cx + rx - 3},${headY + 1} Q${cx},${headY + 9} ${cx - rx + 3},${headY + 1} Z" fill="${shade(hair, -6)}" opacity="0.9"/>`
    : '';
  const mustacheSvg = mustache ? `<path d="M${cx - 5},${headY + 9.5} q5,2.6 10,0" stroke="${shade(hair, -6)}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` : '';

  const hairSvg = HAIR_STYLES[hairStyle](cx, headY, rx, ry, hair);

  const glassesSvg = glasses
    ? `<g stroke="#2b2b30" stroke-width="1.2" fill="none"><circle cx="${cx - eyeGap / 2}" cy="${eyeY}" r="4.4"/><circle cx="${cx + eyeGap / 2}" cy="${eyeY}" r="4.4"/><line x1="${cx - eyeGap / 2 + 4.4}" y1="${eyeY}" x2="${cx + eyeGap / 2 - 4.4}" y2="${eyeY}"/></g>`
    : '';

  const boardLines = [20, 34, 48, 62, 76, 90].map((y) => `<line x1="0" y1="${y}" x2="100" y2="${y}" stroke="#b8b2a4" stroke-width="0.7"/>`).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 118">`
    + `<rect width="100" height="118" fill="#c9c3b6"/>${boardLines}`
    + `<path d="M18,118 Q18,90 50,90 Q82,90 82,118 Z" fill="${shirt}"/>`
    + `<rect x="43" y="74" width="14" height="14" rx="4" fill="${skinDark}"/>`
    + `<ellipse cx="${cx - rx + 1}" cy="${headY + 2}" rx="3" ry="4.5" fill="${skin}"/>`
    + `<ellipse cx="${cx + rx - 1}" cy="${headY + 2}" rx="3" ry="4.5" fill="${skin}"/>`
    + headPath
    + `<ellipse cx="${cx - 7}" cy="${headY + 8}" rx="3" ry="2" fill="${shade(skin, 8)}" opacity="0.5"/>`
    + `<ellipse cx="${cx + 7}" cy="${headY + 8}" rx="3" ry="2" fill="${shade(skin, 8)}" opacity="0.5"/>`
    + beardSvg
    + eye(-eyeGap / 2) + eye(eyeGap / 2)
    + browShape(-eyeGap / 2) + browShape(eyeGap / 2)
    + nose + mouthPath + mustacheSvg + glassesSvg
    + hairSvg
    + `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Hair styles (return SVG drawn on top of the head). Index 3 is bald/receding.
const HAIR_STYLES = [
  // short crop
  (cx, y, rx, ry, c) => `<path d="M${cx - rx - 1},${y - 4} Q${cx},${y - ry - 9} ${cx + rx + 1},${y - 4} Q${cx + rx - 3},${y - ry + 4} ${cx},${y - ry + 1} Q${cx - rx + 3},${y - ry + 4} ${cx - rx - 1},${y - 4} Z" fill="${c}"/>`,
  // side part
  (cx, y, rx, ry, c) => `<path d="M${cx - rx - 1},${y - 2} Q${cx - rx},${y - ry - 8} ${cx + 4},${y - ry - 7} Q${cx + rx + 2},${y - ry - 3} ${cx + rx + 1},${y - 2} Q${cx + rx - 4},${y - ry + 3} ${cx - 3},${y - ry + 1} Q${cx - rx + 2},${y - ry + 3} ${cx - rx - 1},${y - 2} Z" fill="${c}"/>`,
  // buzz cut (thin)
  (cx, y, rx, ry, c) => `<path d="M${cx - rx + 1},${y - 6} Q${cx},${y - ry - 4} ${cx + rx - 1},${y - 6} Q${cx + rx - 4},${y - ry + 5} ${cx},${y - ry + 3} Q${cx - rx + 4},${y - ry + 5} ${cx - rx + 1},${y - 6} Z" fill="${c}" opacity="0.9"/>`,
  // balding / receding
  (cx, y, rx, ry, c) => `<path d="M${cx - rx - 1},${y + 6} Q${cx - rx - 2},${y - ry + 2} ${cx - rx + 6},${y - ry + 4} Q${cx - rx + 3},${y - 2} ${cx - rx - 1},${y + 6} Z" fill="${c}"/><path d="M${cx + rx + 1},${y + 6} Q${cx + rx + 2},${y - ry + 2} ${cx + rx - 6},${y - ry + 4} Q${cx + rx - 3},${y - 2} ${cx + rx + 1},${y + 6} Z" fill="${c}"/>`,
  // longer, covering ears
  (cx, y, rx, ry, c) => `<path d="M${cx - rx - 2},${y + 14} Q${cx - rx - 3},${y - ry - 8} ${cx},${y - ry - 8} Q${cx + rx + 3},${y - ry - 8} ${cx + rx + 2},${y + 14} Q${cx + rx - 1},${y + 2} ${cx + rx - 3},${y - ry + 6} Q${cx},${y - ry + 2} ${cx - rx + 3},${y - ry + 6} Q${cx - rx + 1},${y + 2} ${cx - rx - 2},${y + 14} Z" fill="${c}"/>`,
  // swept back
  (cx, y, rx, ry, c) => `<path d="M${cx - rx},${y - 3} Q${cx - rx + 2},${y - ry - 7} ${cx},${y - ry - 6} Q${cx + rx - 2},${y - ry - 7} ${cx + rx},${y - 3} Q${cx + rx - 6},${y - ry + 2} ${cx},${y - ry - 1} Q${cx - rx + 6},${y - ry + 2} ${cx - rx},${y - 3} Z" fill="${c}"/>`,
];

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt); const g = clamp(((n >> 8) & 255) + amt); const b = clamp((n & 255) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
const clamp = (v) => Math.max(0, Math.min(255, v));

export function avatarImg(seed, cls = 'avatar') {
  return `<img class="${cls}" alt="" src="${avatarDataUri(seed)}">`;
}
