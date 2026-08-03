import { Claude, buildParams } from './client.ts';
import { LocalModel, buildLocalParams, DEFAULT_LOCAL_URL } from './local.ts';
import { BuiltinModel } from './builtin.ts';
import { PRESET_NAMES, presetFromEnv } from './presets.ts';
import { modelFor, providerFromEnv } from './catalog.ts';
import { toolsFor } from '../tools/registry.ts';
import { stableSystemFor } from '../agents/charters.ts';
import type { Turn, TurnResult } from './client.ts';

/**
 * Choosing who answers, and proving at boot that they will.
 *
 * Both providers expose `turn()` and nothing above this file distinguishes
 * them. What does differ is how they fail on the first day: Anthropic fails on
 * a wrong key or a request it will not accept, a local server fails because it
 * is not running, the model was never pulled, or the model cannot call tools
 * at all — which is true of most of them and is not mentioned anywhere you
 * would think to look.
 *
 * So the check sends a real request with the real tool block, and reports in
 * the words of whatever refused it. A reachability probe would call all four
 * of those failures healthy.
 */

export interface ModelClient {
  turn(t: Turn): Promise<TurnResult>;
}

export function modelClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  switch (providerFromEnv(env)) {
    case 'builtin':
      return new BuiltinModel();
    case 'local':
      return new LocalModel();
    default:
      // The key passed explicitly rather than left for the SDK to read, so a
      // caller who chose the provider from `env` gets the key from the same
      // `env` — and a key set at runtime is picked up without a restart.
      return new Claude(
        env['ANTHROPIC_API_KEY'] !== undefined ? { apiKey: env['ANTHROPIC_API_KEY'] } : {},
      );
  }
}

/** The turn both checks send: real tools, real charter, a handful of tokens. */
function preflightTurn(env: NodeJS.ProcessEnv): Turn {
  return {
    stableSystem: stableSystemFor('developer'),
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    // The widest tool set of any role, so the check covers every tool.
    tools: toolsFor('developer'),
    model: modelFor('top', env),
    effort: 'low',
    maxTokens: 16,
  };
}

/**
 * Never throws, never prints a key, never stops the app starting.
 *
 * A cheap reachability probe used to live here. It proved the key was live and
 * nothing else: a tool name the API would not accept sat in every request for
 * days behind a check that said `valid`, because a probe cannot see a
 * malformed request and no test can either — the model is scripted in all of
 * them. The few hundred tokens this costs per boot buy the one thing tests
 * cannot, and locally they cost nothing at all.
 */
export async function checkProvider(
  env: NodeJS.ProcessEnv = process.env,
  client?: ModelClient,
): Promise<string> {
  switch (providerFromEnv(env)) {
    case 'builtin':
      return checkBuiltin(env, client);
    case 'local':
      return checkLocal(env);
    default:
      return checkAnthropic(env);
  }
}

/**
 * The first boot downloads several gigabytes and the second does not.
 *
 * Run rather than probed, for the same reason as the others: loading weights
 * proves the file is not truncated, and asking for one tool call proves the
 * model can call tools at all — which is the thing that decides whether this
 * app can do anything, and is not visible from the file on disk.
 */
async function checkBuiltin(env: NodeJS.ProcessEnv, client: ModelClient | undefined): Promise<string> {
  // The running instance, never a second one: weights are gigabytes and
  // loading a private copy to check on the first would double the memory the
  // app needs for as long as it is up.
  const model = client ?? new BuiltinModel();
  try {
    const res = await model.turn({ ...preflightTurn(env), maxTokens: 64 });
    return res.toolCalls.length > 0 || res.text.length > 0
      ? 'ready — the model answered, and nothing left this machine'
      : 'loaded, but it produced nothing. Try a different FOREMAN_MODEL.';
  } catch (err) {
    return `not ready: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function checkAnthropic(env: NodeJS.ProcessEnv): Promise<string> {
  const key = env['ANTHROPIC_API_KEY'];
  if (!key) return 'no key — paste one under ⋯ → Model, and it takes effect immediately';
  if (!key.startsWith('sk-ant-')) return "does not start with 'sk-ant-' — check it was pasted whole";
  const params = buildParams(preflightTurn(env), 16);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return 'valid, and the API accepts our requests';
    if (res.status === 401) return 'REJECTED by Anthropic — the key is wrong or revoked';
    if (res.status === 429) return 'valid, but rate limited right now';
    const body = await res.text().catch(() => '');
    // A 400 is our bug, not the user's. Print what the API actually said —
    // that message is the whole value of doing this at boot.
    if (res.status === 400) {
      return `the key is fine but the API REFUSED our request shape: ${body.slice(0, 400)}`;
    }
    return `could not be checked (HTTP ${res.status}); carrying on`;
  } catch {
    // Offline, or the check itself is broken. Not a reason to refuse to boot.
    return 'present, but could not be checked from here';
  }
}

async function checkLocal(env: NodeJS.ProcessEnv): Promise<string> {
  const preset = presetFromEnv(env);
  const named = env['FOREMAN_PROVIDER']?.trim().toLowerCase();
  if (named && !preset) {
    return `there is no service called "${named}". The ones with a preset are: ${PRESET_NAMES}`;
  }

  const base = (env['FOREMAN_LOCAL_URL'] ?? preset?.url ?? DEFAULT_LOCAL_URL).replace(/\/$/, '');
  const model = modelFor('top', env).model;
  const key = env['FOREMAN_KEY'] ?? env['FOREMAN_LOCAL_API_KEY'];
  const turn = preflightTurn(env);

  // Caught before the request, because the 401 these services return says
  // nothing about where to get a key, and that is the only useful part.
  if (preset?.needsKey && !key) {
    return `${named} needs a key. Get one at ${preset.keyFrom}, then: export FOREMAN_KEY=...`;
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key ?? 'not-needed'}`,
      },
      body: JSON.stringify(buildLocalParams(turn)),
      // Generously long: the first request loads several gigabytes off disk,
      // and this doubles as the warm-up so the first real one is not the slow
      // one. Nothing waits on it.
      signal: AbortSignal.timeout(300_000),
    });

    if (res.ok) return `${model} is answering, and it can call tools`;

    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      return preset
        ? `${named} rejected the key. Get a fresh one at ${preset.keyFrom}`
        : `the key was rejected by ${base}`;
    }
    if (res.status === 429) return `${named ?? base} is rate limiting — free tiers do that; wait a minute`;
    if (res.status === 404) {
      return preset?.needsKey
        ? `${named} has no model called "${model}" any more. Free tiers rename them; set FOREMAN_LOCAL_MODEL to a current one.`
        : `${model} is not installed — run: ollama pull ${model}`;
    }
    // Ollama says this when the model has no tool-calling template. It is the
    // one failure that looks like the app is broken when it is the choice of
    // model, so name the fix.
    if (/does not support tools|tools.*not supported/i.test(body)) {
      return (
        `${model} cannot call tools, so no agent can do anything. ` +
        `Set FOREMAN_LOCAL_MODEL to one that can — qwen3:8b, llama3.1:8b and mistral-nemo all do.`
      );
    }
    return `${model} at ${base} refused the request (HTTP ${res.status}): ${body.slice(0, 300)}`;
  } catch {
    return preset?.needsKey
      ? `could not reach ${named} at ${base} — check the connection`
      : `nothing is answering at ${base} — start it with 'ollama serve', or install it from https://ollama.com/download`;
  }
}
