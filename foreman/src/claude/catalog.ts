/**
 * Model catalog.
 *
 * Roles reference a tier, never a raw model string, because new models ship
 * faster than anyone wants to edit code. Prices are per million tokens and
 * live here so the cost written into every run is a stored fact rather than
 * something recomputed later against whatever the rates happen to be then.
 */

export type Tier = 'top' | 'mid' | 'cheap';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelEntry {
  model: string;
  /** USD per million tokens. */
  in: number;
  cachedIn: number;
  out: number;
  /** Minimum prefix length the model will cache at all, in tokens. */
  cacheMinTokens: number;
}

export const CATALOG: Readonly<Record<Tier, ModelEntry>> = {
  top: { model: 'claude-opus-5', in: 5.0, cachedIn: 0.5, out: 25.0, cacheMinTokens: 512 },
  mid: { model: 'claude-sonnet-5', in: 3.0, cachedIn: 0.3, out: 15.0, cacheMinTokens: 1024 },
  cheap: { model: 'claude-haiku-4-5', in: 1.0, cachedIn: 0.1, out: 5.0, cacheMinTokens: 2048 },
};

export function modelFor(tier: Tier): ModelEntry {
  return CATALOG[tier];
}

export interface Usage {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export const NO_USAGE: Usage = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };

/**
 * Cost in USD.
 *
 * Cache writes cost more than ordinary input — 1.25x at the five-minute TTL,
 * 2x at one hour. Foreman uses the one-hour window for anything that ticks all
 * day, so that is what this prices.
 */
export function costOf(usage: Usage, entry: ModelEntry, ttl: '5m' | '1h' = '1h'): number {
  const writeMultiplier = ttl === '1h' ? 2 : 1.25;
  const perToken = (n: number, rate: number) => (n / 1_000_000) * rate;
  return (
    perToken(usage.input, entry.in) +
    perToken(usage.cachedInput, entry.cachedIn) +
    perToken(usage.cacheWrite, entry.in * writeMultiplier) +
    perToken(usage.output, entry.out)
  );
}

/** Sum usage across the steps of one run. */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

/**
 * The share of input tokens served from cache.
 *
 * Worth surfacing per run: if this sits at zero across consecutive runs of the
 * same role, something in the prompt prefix is changing between calls, and
 * that is the single most expensive bug this system can have.
 */
export function cacheHitRate(usage: Usage): number {
  const total = usage.input + usage.cachedInput + usage.cacheWrite;
  return total === 0 ? 0 : usage.cachedInput / total;
}
