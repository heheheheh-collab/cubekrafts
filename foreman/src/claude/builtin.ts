import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ChatHistoryItem, ChatModelFunctions, LlamaChat } from 'node-llama-cpp';
import type { ToolSpec } from '../tools/registry.ts';
import { resolveToolName, toWireName } from './wire-names.ts';
import type { ToolCall } from '../domain/types.ts';
import type { Finish, Message, Turn, TurnResult } from './client.ts';
import { NO_USAGE, defaultModelUri } from './catalog.ts';

/**
 * The model, running inside Foreman.
 *
 * Not a provider — there is no account, no key, no second program to install
 * and keep running. A weights file lands in `~/.foreman/models` the first time
 * you start the app, and from then on the thing that reasons is part of the
 * thing you are running. Nothing is sent anywhere and nothing is billed.
 *
 * What that costs, stated plainly rather than buried: a model that fits on a
 * laptop is markedly worse than one that does not. It will follow a charter
 * less exactly, take more turns to use a tool correctly, and write a duller
 * email. The machinery around it is unchanged — the classifier still refuses,
 * approvals still hold, nothing leaves the building unread — so the failure
 * mode is disappointing work, never unsafe work. That is the trade, and it is
 * why `FOREMAN_MODEL_PROVIDER=anthropic` still exists for the days it matters.
 *
 * ## Why the history is rebuilt rather than kept
 *
 * Transcripts are stored in Postgres, resumed days later, and sometimes
 * resumed under a different engine than the one that started them. So the
 * stored shape stays Anthropic's — content blocks, `tool_use`, `tool_result` —
 * and this file translates at its own edge, the same way `local.ts` does for
 * the OpenAI shape and `wire-names.ts` does for tool names.
 *
 * The translation is not cosmetic. This engine represents a call and its
 * result as *one* history item holding both, where the stored form has them as
 * two messages joined by an id. Pairing them up is the whole job of
 * `toLlamaHistory`, and it is a pure function so it can be tested without
 * loading three gigabytes of weights.
 */

export interface BuiltinOptions {
  /** Where weights live. */
  directory?: string;
  /** A `hf:` URI or an absolute path to a .gguf file. */
  modelUri?: string;
  contextSize?: number;
  /** Injected in tests, so the engine itself need not exist. */
  engine?: Engine;
  onProgress?: (line: string) => void;
}

/** The slice of the engine this file uses. Small on purpose: it is the seam. */
export interface Engine {
  generateResponse(
    history: ChatHistoryItem[],
    options: {
      functions?: ChatModelFunctions;
      documentFunctionParams?: boolean;
      maxTokens?: number;
      signal?: AbortSignal;
    },
  ): Promise<{
    response: string;
    functionCalls?: Array<{ functionName: string; params: unknown }>;
    metadata: { stopReason: string };
  }>;
}

export const MODELS_DIR = join(process.env['FOREMAN_HOME'] ?? join(homedir(), '.foreman'), 'models');

export class BuiltinModel {
  private readonly opts: BuiltinOptions;
  private engine?: Promise<Engine>;
  /**
   * One context sequence, so one turn at a time.
   *
   * The scheduler ticks while the concierge is answering, and two generations
   * sharing a sequence interleave their tokens into nonsense. Queueing is not
   * a limitation to remove later; it is what a single context requires.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: BuiltinOptions = {}) {
    this.opts = opts;
  }

  async turn(t: Turn): Promise<TurnResult> {
    const run = this.queue.then(
      () => this.generate(t),
      () => this.generate(t),
    );
    // The queue must not inherit a rejection, or one failed turn poisons every
    // turn after it.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async generate(t: Turn): Promise<TurnResult> {
    const engine = await this.load();
    const functions = toLlamaFunctions(t.tools);
    const res = await engine.generateResponse(toLlamaHistory(t), {
      ...(Object.keys(functions).length > 0 ? { functions } : {}),
      documentFunctionParams: true,
      maxTokens: t.maxTokens ?? 8_000,
      ...(t.signal ? { signal: t.signal } : {}),
    });
    return fromLlamaResponse(res);
  }

  private async load(): Promise<Engine> {
    if (this.opts.engine) return this.opts.engine;
    this.engine ??= this.boot();
    return this.engine;
  }

  private async boot(): Promise<Engine> {
    const say = this.opts.onProgress ?? ((line: string) => console.log(line));
    // Imported at call time, not at module load. The native package can fail
    // to install on a machine with no compiler, and that must degrade to a
    // clear sentence at first use rather than an app that will not boot.
    let lib: typeof import('node-llama-cpp');
    try {
      lib = await import('node-llama-cpp');
    } catch (err) {
      throw new Error(
        'the built-in model engine is not installed — run `npm install` again, ' +
          `or set FOREMAN_MODEL_PROVIDER=anthropic. (${String(err)})`,
      );
    }

    const uri = this.opts.modelUri ?? process.env['FOREMAN_MODEL'] ?? defaultModelUri();
    const directory = this.opts.directory ?? MODELS_DIR;
    say(`model: resolving ${uri}`);
    // Downloads on first run and is a no-op forever after. Several gigabytes,
    // said out loud, because a silent five-minute pause reads as a hang.
    const path = await lib.resolveModelFile(uri, { directory });

    const llama = await lib.getLlama();
    const model = await llama.loadModel({ modelPath: path });
    const context = await model.createContext({
      // Generous, because `documentFunctionParams` writes the full schema of
      // every tool into the prompt ahead of the charter. Too small does not
      // fail loudly — the window shifts and the charter is what falls out of
      // it, leaving an agent that has forgotten its own rules.
      contextSize: { max: Number(process.env['FOREMAN_CONTEXT'] ?? this.opts.contextSize ?? 16_384) },
    });
    const chat: LlamaChat = new lib.LlamaChat({ contextSequence: context.getSequence() });
    say(`model: ${path} loaded`);
    return chat as unknown as Engine;
  }
}

/** Our tool specs in the shape this engine constrains generation with. */
export function toLlamaFunctions(tools: readonly ToolSpec[]): ChatModelFunctions {
  const out: Record<string, { description: string; params: unknown }> = {};
  for (const t of tools) {
    // The same dot-free spelling both wires use, so one transcript is
    // readable by every engine.
    out[toWireName(t.name)] = { description: t.description, params: t.input_schema };
  }
  return out as ChatModelFunctions;
}

/**
 * The stored transcript as this engine's history.
 *
 * A call and its result are one item here and two messages there, so results
 * are indexed by the id of the call they answer and folded in as the calls are
 * walked. A call whose result has not arrived keeps `undefined`, which is the
 * honest representation of a turn that stopped at an approval.
 */
export function toLlamaHistory(t: Turn): ChatHistoryItem[] {
  const system = [...t.stableSystem, ...(t.volatileSystem ?? [])].join('\n\n');
  const history: ChatHistoryItem[] = [{ type: 'system', text: system }];

  const results = collectResults(t.messages);

  for (const m of t.messages) {
    if (m.role === 'system') {
      history.push({ type: 'system', text: String(m.content) });
      continue;
    }

    if (typeof m.content === 'string') {
      if (m.role === 'user') history.push({ type: 'user', text: m.content });
      else history.push({ type: 'model', response: [m.content] });
      continue;
    }

    const blocks = Array.isArray(m.content) ? (m.content as Array<Record<string, unknown>>) : [];

    if (m.role === 'user') {
      // tool_result blocks were already folded into the model turn that asked
      // for them; only real user text becomes a user message here.
      const text = blocks
        .filter((b) => b['type'] === 'text')
        .map((b) => String(b['text'] ?? ''))
        .join('\n');
      if (text) history.push({ type: 'user', text });
      continue;
    }

    const response: ChatModelResponsePart[] = [];
    for (const b of blocks) {
      if (b['type'] === 'text') {
        const text = String(b['text'] ?? '');
        if (text) response.push(text);
      } else if (b['type'] === 'tool_use') {
        const id = String(b['id'] ?? '');
        response.push({
          type: 'functionCall',
          name: String(b['name'] ?? ''),
          params: b['input'] ?? {},
          result: results.get(id),
        });
      }
    }
    if (response.length > 0) history.push({ type: 'model', response } as ChatHistoryItem);
  }

  return history;
}

type ChatModelResponsePart = string | { type: 'functionCall'; name: string; params: unknown; result: unknown };

function collectResults(messages: readonly Message[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const m of messages) {
    if (m.role !== 'user' || typeof m.content === 'string' || !Array.isArray(m.content)) continue;
    for (const b of m.content as Array<Record<string, unknown>>) {
      if (b['type'] === 'tool_result') out.set(String(b['tool_use_id'] ?? ''), b['content']);
    }
  }
  return out;
}

const STOP: Record<string, Finish> = {
  functionCalls: 'tool_calls',
  maxTokens: 'truncated',
  eogToken: 'end',
  stopGenerationTrigger: 'end',
  abort: 'end',
};

export function fromLlamaResponse(res: {
  response: string;
  functionCalls?: Array<{ functionName: string; params: unknown }>;
  metadata: { stopReason: string };
}): TurnResult {
  const calls = res.functionCalls ?? [];
  const toolCalls: ToolCall[] = calls.map((c, i) => ({
    // This engine does not mint call ids. They have to be stable within the
    // turn, because the result we send back is matched to the call by id.
    id: `call_${i}`,
    name: resolveToolName(c.functionName),
    args: (c.params ?? {}) as Record<string, unknown>,
  }));

  // Anthropic-shaped and wire-named, so the transcript this produces is
  // indistinguishable from one the hosted path produced.
  const raw: Array<Record<string, unknown>> = [];
  if (res.response) raw.push({ type: 'text', text: res.response });
  for (const [i, c] of toolCalls.entries()) {
    raw.push({ type: 'tool_use', id: c.id, name: calls[i]!.functionName, input: c.args });
  }

  const finish: Finish = toolCalls.length > 0 ? 'tool_calls' : (STOP[res.metadata.stopReason] ?? 'end');

  return {
    finish,
    text: res.response,
    toolCalls,
    // No tokens are bought, so none are counted. Finance reporting zero for a
    // local week is the true answer, not a gap in the instrumentation.
    usage: NO_USAGE,
    costUsd: 0,
    raw,
  };
}
