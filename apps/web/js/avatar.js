// Deterministic "case photo" avatars — a mugshot-style silhouette on a height
// board, tinted from the person's name so each suspect is visually distinct.
// No network, no image files: an inline SVG data URI.

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarDataUri(seed) {
  const h = hashCode(String(seed));
  const hue = h % 360;
  const skin = `hsl(${hue} 22% 46%)`;
  const lines = [22, 36, 50, 64, 78].map((y) => `<line x1='0' y1='${y}' x2='100' y2='${y}' stroke='%232d2d38' stroke-width='1'/>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>`
    + `<rect width='100' height='100' fill='%23191922'/>${lines}`
    + `<g fill='${skin.replace(/ /g, '%20')}'>`
    + `<circle cx='50' cy='42' r='17'/>`
    + `<path d='M22 100 Q22 68 50 68 Q78 68 78 100 Z'/>`
    + `</g></svg>`;
  return `data:image/svg+xml,${svg}`;
}

export function avatarImg(seed, cls = 'avatar') {
  return `<img class="${cls}" alt="" src="${avatarDataUri(seed)}">`;
}
