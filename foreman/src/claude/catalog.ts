import { totalmem } from 'node:os';
import { presetFromEnv } from './presets.ts';

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
  /**
   * Whether `thinking: {type:'adaptive'}` and `output_config.effort` are
   * accepted. Not decoration: sending either to a model that does not take it
   * is a 400 that kills the request, and the two travel together — the models
   * that gained adaptive thinking gained effort in the same generation.
   *
   * This is why the concierge broke while every other agent worked. It runs on
   * the cheap tier, the cheap tier is Haiku, and Haiku takes neither.
   */
  adaptiveThinking: boolean;
}

export const CATALOG: Readonly<Record<Tier, ModelEntry>> = {
  top: {
    model: 'claude-opus-5',
    in: 5.0,
    cachedIn: 0.5,
    out: 25.0,
    cacheMinTokens: 512,
    adaptiveThinking: true,
  },
  mid: {
    model: 'claude-sonnet-5',
    in: 3.0,
    cachedIn: 0.3,
    out: 15.0,
    cacheMinTokens: 1024,
    adaptiveThinking: true,
  },
  cheap: {
    model: 'claude-haiku-4-5',
    in: 1.0,
    cachedIn: 0.1,
    out: 5.0,
    cacheMinTokens: 4096,
    adaptiveThinking: false,
  },
};

/**
 * The same three tiers, served from a model running on your own machine.
 *
 * One model by default rather than three. Tiers exist so roles can be cheap or
 * careful, and when the marginal token is free that distinction stops paying
 * for itself — while three separate pulls would cost twenty gigabytes and
 * three chances to have not pulled the one a role happens to want.
 *
 * Prices are zero because they are. That is not a placeholder: the spend cap
 * reads these numbers, so a local run genuinely cannot be stopped by it.
 */
export function localCatalog(
  env: NodeJS.ProcessEnv = process.env,
  fallback?: string,
): Readonly<Record<Tier, ModelEntry>> {
  const base = env['FOREMAN_LOCAL_MODEL'] ?? fallback ?? presetFromEnv(env)?.model ?? 'qwen3:8b';
  const free = (model: string): ModelEntry => ({
    model,
    in: 0,
    cachedIn: 0,
    out: 0,
    // Nothing caches prefixes locally; claiming otherwise would make
    // `cacheHitRate` read as a fault forever.
    cacheMinTokens: Number.POSITIVE_INFINITY,
    // Anthropic's parameters, and only Anthropic's. The local paths build
    // their own request shape and never read this, but leaving it true would
    // be a claim that is false.
    adaptiveThinking: false,
  });
  return {
    top: free(env['FOREMAN_LOCAL_MODEL_TOP'] ?? base),
    mid: free(env['FOREMAN_LOCAL_MODEL_MID'] ?? base),
    cheap: free(env['FOREMAN_LOCAL_MODEL_CHEAP'] ?? base),
  };
}

export type Provider =
  /** Weights running inside this process. No account, no key, no network. */
  | 'builtin'
  /** Something already running on this machine that speaks the OpenAI shape. */
  | 'local'
  | 'anthropic';

/**
 * Which one is in force.
 *
 * Built-in unless told otherwise, so Foreman works the moment it starts and
 * reaches the network only when you have deliberately given it the means to.
 * An Anthropic key, if you have set one, is taken as saying you want it used.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): Provider {
  const declared = env['FOREMAN_MODEL_PROVIDER'];
  if (declared === 'anthropic' || declared === 'local' || declared === 'builtin') return declared;
  if (env['ANTHROPIC_API_KEY']) return 'anthropic';
  // A named service, or a URL pointed at by hand. Either way something else is
  // already able to answer, so do not download a model to duplicate it.
  if (env['FOREMAN_PROVIDER'] || env['FOREMAN_LOCAL_URL']) return 'local';
  return 'builtin';
}

/**
 * Which weights to fetch when nobody has said.
 *
 * Chosen by memory, because guessing too big does not produce a slow app — it
 * produces one that cannot start. Every option here can call tools; most small
 * models cannot, and picking one that cannot is the easiest way to end up with
 * an organisation that never does anything.
 */
export function defaultModelUri(bytes: number = totalmem()): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 30) return 'hf:bartowski/Qwen2.5-14B-Instruct-GGUF:Q4_K_M';
  if (gb >= 15) return 'hf:bartowski/Qwen2.5-7B-Instruct-GGUF:Q4_K_M';
  return 'hf:bartowski/Qwen2.5-3B-Instruct-GGUF:Q4_K_M';
}

export function catalogFor(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<Tier, ModelEntry>> {
  if (provider === 'anthropic') return CATALOG;
  if (provider === 'builtin') {
    // One set of weights is loaded into memory; asking for a second tier would
    // mean loading it twice. The tiers stay so roles need not know that.
    const model = env['FOREMAN_MODEL'] ?? defaultModelUri();
    return localCatalog({ ...env, FOREMAN_LOCAL_MODEL: model });
  }
  return localCatalog(env);
}

export function modelFor(tier: Tier, env: NodeJS.ProcessEnv = process.env): ModelEntry {
  return catalogFor(providerFromEnv(env), env)[tier];
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
