/**
 * Services that give a key away for nothing.
 *
 * Not a convenience wrapper — an answer to a real gap. Foreman's own model
 * needs no key at all but is markedly weaker than Claude, and Claude needs a
 * card. These sit in between: a key you get in two minutes, no card, no
 * credits to buy, and a model strong enough to follow a charter.
 *
 * Free tiers are rate limited and their limits change without notice. That is
 * the catch, and it is the whole catch.
 *
 * They all speak the OpenAI shape, so none of this is a new code path. A
 * preset is three settings with a name, so that choosing one is a word rather
 * than a URL somebody has to find and type correctly.
 *
 * Its own module, with no imports, because both the catalog and the client
 * need it and having either import the other closes a cycle.
 */

export interface Preset {
  url: string;
  model: string;
  /** Where the free key comes from, said out loud when one is missing. */
  keyFrom: string;
  needsKey: boolean;
}

export const OLLAMA_URL = 'http://127.0.0.1:11434/v1';

export const PRESETS: Readonly<Record<string, Preset>> = {
  groq: {
    url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyFrom: 'console.groq.com/keys — free, no card',
    needsKey: true,
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    keyFrom: 'aistudio.google.com/apikey — free, no card',
    needsKey: true,
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyFrom: 'openrouter.ai/keys — free tier, no card for the :free models',
    needsKey: true,
  },
  // Something already running on this machine. No key, nothing leaves it.
  ollama: { url: OLLAMA_URL, model: 'qwen3:8b', keyFrom: 'no key needed', needsKey: false },
  lmstudio: {
    url: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    keyFrom: 'no key needed',
    needsKey: false,
  },
};

export function presetFromEnv(env: NodeJS.ProcessEnv = process.env): Preset | undefined {
  const name = env['FOREMAN_PROVIDER']?.trim().toLowerCase();
  return name ? PRESETS[name] : undefined;
}

/** The named services, for an error message that lists the real options. */
export const PRESET_NAMES = Object.keys(PRESETS).join(', ');
