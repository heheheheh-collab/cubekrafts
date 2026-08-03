import Anthropic from '@anthropic-ai/sdk';
import type { ToolSpec } from '../tools/registry.ts';
import { resolveToolName, toWireName } from './wire-names.ts';
import type { ToolCall } from '../domain/types.ts';
import { type Effort, type ModelEntry, type Usage, NO_USAGE, costOf } from './catalog.ts';

/**
 * The one place that talks to Claude.
 *
 * Everything about the request shape lives here so it is right once rather
 * than nearly right in six places: adaptive thinking, effort, the cache
 * breakpoint, streaming above the timeout threshold, and — the one that bites
 * hardest — checking `stop_reason` before touching `content`.
 */

export interface Turn {
  /**
   * System blocks in cache order: stable first, volatile last. The breakpoint
   * goes on the final stable block, so charter and canon are cached and the
   * task is not. Getting this order wrong is the most expensive mistake
   * available here, and it fails silently — see `cacheHitRate`.
   */
  stableSystem: string[];
  volatileSystem?: string[];
  messages: Message[];
  tools: readonly ToolSpec[];
  model: ModelEntry;
  effort: Effort;
  maxTokens?: number;
  /** Total tokens the model may spend across an agentic loop, if known. */
  taskBudgetTokens?: number;
  signal?: AbortSignal;
}

export type Message =
  | { role: 'user' | 'assistant'; content: unknown }
  /**
   * Operator instruction delivered mid-conversation. Supported on Opus 5, and
   * the mechanism behind "actually, make it shorter" while an agent is
   * running: it carries operator authority and, because it lands in `messages`
   * rather than the top-level system prompt, the cached prefix survives.
   */
  | { role: 'system'; content: string };

export type Finish = 'end' | 'tool_calls' | 'refused' | 'truncated';

export interface TurnResult {
  finish: Finish;
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  costUsd: number;
  /** The raw assistant content, to be appended verbatim to the transcript. */
  raw: unknown;
  /** Present when the model declined; the category explains why. */
  refusal?: { category: string | null; explanation?: string };
}

/** Above roughly this many output tokens a non-streaming request risks a timeout. */
const STREAM_ABOVE = 16_000;

export interface ClaudeOptions {
  apiKey?: string;
  /** Injected in tests. */
  client?: Pick<Anthropic, 'messages'>;
}

export class Claude {
  private readonly sdk: Pick<Anthropic, 'messages'>;

  constructor(opts: ClaudeOptions = {}) {
    this.sdk =
      opts.client ??
      new Anthropic(opts.apiKey === undefined ? {} : { apiKey: opts.apiKey });
  }

  async turn(t: Turn): Promise<TurnResult> {
    const maxTokens = t.maxTokens ?? 8_000;
    const params = buildParams(t, maxTokens);

    // `buildParams` returns a plain object on purpose: the tests assert the
    // exact wire shape, and some current fields (output_config, adaptive
    // thinking) run ahead of the SDK's published types. One cast, here, rather
    // than weakening the shape everywhere.
    const message =
      maxTokens > STREAM_ABOVE
        ? await this.streamed(params, t.signal)
        : await (
            this.sdk.messages.create as unknown as (
              p: object,
              o?: object,
            ) => Promise<unknown>
          )(params, t.signal ? { signal: t.signal } : {});

    return interpret(message as AnthropicMessage, t.model);
  }

  private async streamed(params: object, signal?: AbortSignal): Promise<unknown> {
    // Long dev-agent turns exceed the SDK's HTTP timeout unless streamed, so
    // above the threshold we stream and reassemble rather than risk the wait.
    const stream = (this.sdk.messages as unknown as {
      stream(p: object, o?: object): { finalMessage(): Promise<unknown> };
    }).stream(params, signal ? { signal } : {});
    return await stream.finalMessage();
  }
}

interface AnthropicMessage {
  content: Array<Record<string, unknown>>;
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function buildParams(t: Turn, maxTokens: number): Record<string, unknown> {
  const system = [
    ...t.stableSystem.map((text, i) => ({
      type: 'text' as const,
      text,
      // One breakpoint, on the last stable block: it caches the tool
      // definitions and every stable block before it in a single prefix.
      ...(i === t.stableSystem.length - 1
        ? { cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } }
        : {}),
    })),
    ...(t.volatileSystem ?? []).map((text) => ({ type: 'text' as const, text })),
  ];

  return {
    model: t.model.model,
    max_tokens: maxTokens,
    // Adaptive thinking: no budget_tokens, which is rejected on current models.
    thinking: { type: 'adaptive' },
    output_config: {
      effort: t.effort,
      ...(t.taskBudgetTokens !== undefined
        ? { task_budget: { type: 'tokens', total: t.taskBudgetTokens } }
        : {}),
    },
    system,
    // Sorted by name so the serialised tool block is byte-identical between
    // calls. An unstable tool order silently destroys the cache.
    tools: [...t.tools]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((s) => ({
        // Dots are ours; the API only accepts [a-zA-Z0-9_-]. Translated here,
        // at the boundary, and translated back in `interpret`.
        name: toWireName(s.name),
        description: s.description,
        input_schema: s.input_schema,
        strict: true,
      })),
    messages: t.messages,
  };
}

export function interpret(message: AnthropicMessage, model: ModelEntry): TurnResult {
  const usage: Usage = {
    input: message.usage?.input_tokens ?? 0,
    cachedInput: message.usage?.cache_read_input_tokens ?? 0,
    cacheWrite: message.usage?.cache_creation_input_tokens ?? 0,
    output: message.usage?.output_tokens ?? 0,
  };
  const costUsd = costOf(usage, model);

  // Check the stop reason before reading content. A refusal arrives as a
  // perfectly ordinary success with possibly-empty content, and code that
  // reaches for content[0].text first will throw on it.
  if (message.stop_reason === 'refusal') {
    return {
      finish: 'refused',
      text: '',
      toolCalls: [],
      usage,
      costUsd,
      raw: message.content ?? [],
      refusal: {
        category: message.stop_details?.category ?? null,
        ...(message.stop_details?.explanation !== undefined
          ? { explanation: message.stop_details.explanation }
          : {}),
      },
    };
  }

  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = blocks
    .filter((b) => b['type'] === 'text')
    .map((b) => String(b['text'] ?? ''))
    .join('');

  const toolCalls: ToolCall[] = blocks
    .filter((b) => b['type'] === 'tool_use')
    .map((b) => ({
      id: String(b['id'] ?? ''),
      // Back to the dotted name everything above this file is written in. A
      // name we never sent resolves to itself and the classifier refuses it.
      name: resolveToolName(String(b['name'] ?? '')),
      args: (b['input'] ?? {}) as Record<string, unknown>,
    }));

  const finish: Finish =
    message.stop_reason === 'max_tokens'
      ? 'truncated'
      : toolCalls.length > 0
        ? 'tool_calls'
        : 'end';

  return { finish, text, toolCalls, usage, costUsd, raw: blocks };
}

export { NO_USAGE };
