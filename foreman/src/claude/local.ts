import type { ToolSpec } from '../tools/registry.ts';
import { resolveToolName, toWireName } from './wire-names.ts';
import type { ToolCall } from '../domain/types.ts';
import type { Finish, Message, Turn, TurnResult } from './client.ts';
import type { Usage } from './catalog.ts';
import { OLLAMA_URL, presetFromEnv } from './presets.ts';

/**
 * A model running on your own machine.
 *
 * Same `turn()` as the Anthropic client, so everything above this file — the
 * agent loop, approvals, the scheduler, the concierge — is unchanged and does
 * not know which one it has. They all depend on `Pick<Claude, 'turn'>`, which
 * is a shape rather than a class.
 *
 * The endpoint is the OpenAI chat-completions shape, because that is what
 * Ollama, LM Studio and llama.cpp's own server all speak. Anything else that
 * speaks it works too, by setting one environment variable.
 *
 * ## The transcript stays Anthropic-shaped
 *
 * Transcripts are stored in Postgres and resumed days later, sometimes after
 * an approval. If the stored shape depended on which provider produced it, a
 * run started on one and resumed on the other would be unresumable, and every
 * piece of code that reads a transcript would need to handle both.
 *
 * So the internal format is Anthropic's — content blocks, `tool_use`,
 * `tool_result` — and this file translates in both directions at its own edge.
 * Exactly what `wire-names.ts` does for tool names, for the same reason: the
 * format a vendor happens to want belongs at the boundary that wants it.
 */

export interface LocalOptions {
  /** Base URL of an OpenAI-compatible server, without a trailing slash. */
  baseUrl?: string;
  apiKey?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

export const DEFAULT_LOCAL_URL = OLLAMA_URL;

/** Tool names on this wire are bound by the same character rules. */
interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

export class LocalModel {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: LocalOptions = {}) {
    const preset = presetFromEnv();
    // An explicit URL beats a preset, so naming a service and then pointing
    // somewhere else does what it looks like it does.
    this.baseUrl = (
      opts.baseUrl ??
      process.env['FOREMAN_LOCAL_URL'] ??
      preset?.url ??
      DEFAULT_LOCAL_URL
    ).replace(/\/$/, '');
    // Ollama ignores this; LM Studio and the hosted free tiers want something.
    // Never logged, and never defaulted to anything meaningful.
    this.apiKey =
      opts.apiKey ??
      process.env['FOREMAN_KEY'] ??
      process.env['FOREMAN_LOCAL_API_KEY'] ??
      'not-needed';
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async turn(t: Turn): Promise<TurnResult> {
    const body = buildLocalParams(t);
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(t.signal ? { signal: t.signal } : {}),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      // A missing model is the overwhelmingly common failure and the message
      // for it is unhelpful, so name the fix rather than repeating the status.
      if (res.status === 404) {
        throw new Error(
          `the local model "${t.model.model}" is not installed — run: ollama pull ${t.model.model}`,
        );
      }
      throw new Error(`local model at ${this.baseUrl} returned ${res.status}: ${detail.slice(0, 300)}`);
    }

    return interpretLocal((await res.json()) as OpenAiResponse);
  }
}

/** Anthropic-shaped system blocks and messages, in the shape this API wants. */
export function buildLocalParams(t: Turn): Record<string, unknown> {
  const system = [...t.stableSystem, ...(t.volatileSystem ?? [])].join('\n\n');

  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of t.messages) messages.push(...translateMessage(m));

  return {
    model: t.model.model,
    messages,
    // No cache_control, no thinking block, no output_config. Those are
    // Anthropic's, and sending them here is at best ignored and at worst a 400.
    ...(t.tools.length > 0 ? { tools: t.tools.map(asFunction) } : {}),
    max_tokens: t.maxTokens ?? 8_000,
    stream: false,
  };
}

function asFunction(s: ToolSpec): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      // The same dot-free name Anthropic gets. Both wires forbid dots, and
      // using one spelling everywhere means a transcript is portable.
      name: toWireName(s.name),
      description: s.description,
      parameters: s.input_schema,
    },
  };
}

/** One internal message becomes one or more in the OpenAI shape. */
function translateMessage(m: Message): Array<Record<string, unknown>> {
  if (m.role === 'system') return [{ role: 'system', content: m.content }];

  if (typeof m.content === 'string') return [{ role: m.role, content: m.content }];

  const blocks = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];

  if (m.role === 'user') {
    // A tool_result block is not a user message here — it is its own role,
    // and it must carry the id of the call it answers or the model loses the
    // thread of which result belongs to which request.
    const out: Array<Record<string, unknown>> = [];
    const text: string[] = [];
    for (const b of blocks) {
      if (b['type'] === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: String(b['tool_use_id'] ?? ''),
          content: stringifyContent(b['content']),
        });
      } else if (b['type'] === 'text') {
        text.push(String(b['text'] ?? ''));
      }
    }
    if (text.length > 0) out.push({ role: 'user', content: text.join('\n') });
    return out;
  }

  // Assistant: text and tool calls travel in one message rather than several.
  const text = blocks
    .filter((b) => b['type'] === 'text')
    .map((b) => String(b['text'] ?? ''))
    .join('');
  const toolCalls = blocks
    .filter((b) => b['type'] === 'tool_use')
    .map((b) => ({
      id: String(b['id'] ?? ''),
      type: 'function',
      function: {
        name: String(b['name'] ?? ''),
        arguments: JSON.stringify(b['input'] ?? {}),
      },
    }));

  return [
    {
      role: 'assistant',
      // Some servers reject a null content alongside tool calls and some
      // reject an empty string without them. An empty string satisfies both.
      content: text,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
  ];
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content ?? '');
}

const FINISH: Record<string, Finish> = {
  stop: 'end',
  tool_calls: 'tool_calls',
  function_call: 'tool_calls',
  length: 'truncated',
};

export function interpretLocal(res: OpenAiResponse): TurnResult {
  const choice = res.choices?.[0];
  const message = choice?.message ?? {};
  const text = message.content ?? '';

  const rawCalls = message.tool_calls ?? [];
  const toolCalls: ToolCall[] = rawCalls.map((c, i) => ({
    // Small models sometimes omit the id entirely. Inventing a stable one is
    // required rather than optional: the result we send back has to reference
    // it, and two calls in the same turn must not collide.
    id: c.id && c.id.length > 0 ? c.id : `call_${i}`,
    name: resolveToolName(c.function?.name ?? ''),
    args: parseArgs(c.function?.arguments),
  }));

  const usage: Usage = {
    input: res.usage?.prompt_tokens ?? 0,
    cachedInput: 0,
    cacheWrite: 0,
    output: res.usage?.completion_tokens ?? 0,
  };

  // The assistant turn as the transcript will store it: Anthropic-shaped, with
  // wire names, byte-comparable with what the other provider produces.
  const raw: Array<Record<string, unknown>> = [];
  if (text) raw.push({ type: 'text', text });
  for (const [i, c] of toolCalls.entries()) {
    raw.push({
      type: 'tool_use',
      id: c.id,
      name: rawCalls[i]?.function?.name ?? toWireName(c.name),
      input: c.args,
    });
  }

  // A model that emitted tool calls has made them regardless of what it put in
  // finish_reason, and small ones frequently say "stop" while doing so.
  const declared = FINISH[choice?.finish_reason ?? ''] ?? 'end';
  const finish: Finish = toolCalls.length > 0 ? 'tool_calls' : declared;

  return { finish, text, toolCalls, usage, costUsd: 0, raw };
}

function parseArgs(args: string | undefined): Record<string, unknown> {
  if (!args) return {};
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Malformed arguments are a fact about the model, not an exception. An
    // empty object reaches the tool, fails its own validation, and the model
    // is told what was wrong — which is how it recovers.
    return {};
  }
}
