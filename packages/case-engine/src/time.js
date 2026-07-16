// All times are minutes since 00:00 of day 1 (Friday). The simulation covers
// Friday 16:30 (990) through Saturday 02:30 (1590). Day 2 values are >= 1440.

export const SIM_START = 990; // Fri 16:30
export const SIM_END = 1590; // Sat 02:30

export function fmtClock(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${String(h).padStart(2, '0')}:${mm}`;
}

export function fmtTime(min) {
  const day = min < 1440 ? 'Friday' : 'Saturday';
  return `${fmtClock(min)} ${day}`;
}

export function roundTo5(min) {
  return Math.round(min / 5) * 5;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
