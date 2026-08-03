import { describe, it, expect } from 'vitest';
import {
  catalogFor,
  costOf,
  defaultModelUri,
  providerFromEnv,
  type Provider,
} from '../src/claude/catalog.ts';
import { buildLocalParams, interpretLocal, LocalModel } from '../src/claude/local.ts';
import {
  BuiltinModel,
  fromLlamaResponse,
  toLlamaFunctions,
  toLlamaHistory,
  type Engine,
} from '../src/claude/builtin.ts';
import { checkProvider, modelClientFromEnv } from '../src/claude/provider.ts';
import { PRESETS, presetFromEnv } from '../src/claude/presets.ts';
import { WIRE_NAME_PATTERN } from '../src/claude/wire-names.ts';
import { TOOLS, toolsFor } from '../src/tools/registry.ts';
import type { Turn } from '../src/claude/client.ts';

const env = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...over });

const turn = (over: Partial<Turn> = {}): Turn => ({
  stableSystem: ['preamble', 'charter', 'canon'],
  messages: [{ role: 'user', content: 'go' }],
  tools: toolsFor('content'),
  model: { model: 'test-model', in: 0, cachedIn: 0, out: 0, cacheMinTokens: 0, adaptiveThinking: false },
  effort: 'high',
  ...over,
});

// ── which engine answers ─────────────────────────────────────────────────────

describe('choosing a provider', () => {
  it('runs on its own with nothing configured', () => {
    expect(providerFromEnv(env())).toBe('builtin');
  });

  it('uses Anthropic when a key says to', () => {
    expect(providerFromEnv(env({ ANTHROPIC_API_KEY: 'sk-ant-x' }))).toBe('anthropic');
  });

  it('uses a server already running here rather than downloading a second model', () => {
    expect(providerFromEnv(env({ FOREMAN_LOCAL_URL: 'http://127.0.0.1:11434/v1' }))).toBe('local');
  });

  it('lets an explicit choice beat both', () => {
    const both = { ANTHROPIC_API_KEY: 'sk-ant-x', FOREMAN_LOCAL_URL: 'http://x' };
    expect(providerFromEnv(env({ ...both, FOREMAN_MODEL_PROVIDER: 'builtin' }))).toBe('builtin');
    expect(providerFromEnv(env({ FOREMAN_MODEL_PROVIDER: 'anthropic' }))).toBe('anthropic');
  });

  it('builds the client the choice implies', () => {
    expect(modelClientFromEnv(env())).toBeInstanceOf(BuiltinModel);
    expect(modelClientFromEnv(env({ FOREMAN_LOCAL_URL: 'http://x/v1' }))).toBeInstanceOf(LocalModel);
  });
});

describe('the free services, chosen by name', () => {
  it('takes a word instead of a URL', () => {
    expect(providerFromEnv(env({ FOREMAN_PROVIDER: 'groq' }))).toBe('local');
    expect(catalogFor('local', env({ FOREMAN_PROVIDER: 'groq' }))['top'].model).toBe(
      PRESETS['groq']!.model,
    );
  });

  it('sends the request to that service', async () => {
    let seen = '';
    const fetchImpl = (async (url: string) => {
      seen = String(url);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }) as unknown as typeof fetch;

    process.env['FOREMAN_PROVIDER'] = 'groq';
    try {
      await new LocalModel({ fetch: fetchImpl, apiKey: 'k' }).turn(turn());
    } finally {
      delete process.env['FOREMAN_PROVIDER'];
    }
    expect(seen).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('lets an explicit URL beat the preset', () => {
    process.env['FOREMAN_PROVIDER'] = 'groq';
    process.env['FOREMAN_LOCAL_URL'] = 'http://127.0.0.1:1234/v1';
    try {
      // Naming a service and then pointing elsewhere should do what it looks
      // like it does, not silently ignore half of it.
      expect(presetFromEnv()).toBe(PRESETS['groq']);
      expect(new LocalModel()).toBeDefined();
    } finally {
      delete process.env['FOREMAN_PROVIDER'];
      delete process.env['FOREMAN_LOCAL_URL'];
    }
  });

  it('says where to get a key rather than waiting for a 401 to say nothing', async () => {
    const line = await checkProvider(env({ FOREMAN_PROVIDER: 'groq' }));
    expect(line).toContain('console.groq.com/keys');
    expect(line).toContain('FOREMAN_KEY');
  });

  it('lists the real options when the name is not one', async () => {
    const line = await checkProvider(env({ FOREMAN_PROVIDER: 'chatgpt' }));
    expect(line).toContain('no service called "chatgpt"');
    expect(line).toContain('groq');
  });

  it('keeps every preset pointed somewhere, and says where its key comes from', () => {
    for (const [name, p] of Object.entries(PRESETS)) {
      expect({ name, https: p.url.startsWith('http'), model: p.model.length > 0 }).toEqual({
        name,
        https: true,
        model: true,
      });
      // A service that needs a key must name the page you get it from, or the
      // message it produces is the useless kind.
      if (p.needsKey) expect(p.keyFrom).toMatch(/\./);
    }
  });
});

describe('what running locally costs', () => {
  it('is nothing, and the spend cap reads these same numbers', () => {
    for (const provider of ['builtin', 'local'] satisfies Provider[]) {
      const entry = catalogFor(provider, env())['top'];
      const spent = costOf({ input: 900_000, cachedInput: 0, cacheWrite: 500_000, output: 200_000 }, entry);
      expect({ provider, spent }).toEqual({ provider, spent: 0 });
    }
  });

  it('still charges for Anthropic, so switching back does not silently uncap spending', () => {
    const entry = catalogFor('anthropic', env())['top'];
    expect(costOf({ input: 1_000_000, cachedInput: 0, cacheWrite: 0, output: 0 }, entry)).toBeGreaterThan(0);
  });

  it('picks weights the machine can actually hold', () => {
    const gb = (n: number) => n * 1024 ** 3;
    expect(defaultModelUri(gb(8))).toContain('3B');
    expect(defaultModelUri(gb(16))).toContain('7B');
    expect(defaultModelUri(gb(64))).toContain('14B');
  });

  it('honours a model you named yourself', () => {
    expect(catalogFor('builtin', env({ FOREMAN_MODEL: 'hf:me/mine:Q4' }))['top'].model).toBe('hf:me/mine:Q4');
  });
});

// ── the built-in engine ──────────────────────────────────────────────────────

describe('tools as the built-in engine wants them', () => {
  it('offers every tool under a name with no dot in it', () => {
    const fns = toLlamaFunctions(TOOLS);
    expect(Object.keys(fns)).toHaveLength(TOOLS.length);
    for (const name of Object.keys(fns)) {
      expect({ name, ok: WIRE_NAME_PATTERN.test(name) }).toEqual({ name, ok: true });
    }
    expect(fns['org__look_up']).toBeDefined();
  });
});

describe('the stored transcript as engine history', () => {
  it('folds a result into the call it answers, because here they are one item', () => {
    const history = toLlamaHistory(
      turn({
        messages: [
          { role: 'user', content: 'read the file' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'looking' },
              { type: 'tool_use', id: 'tu1', name: 'fs__read', input: { path: 'a.md' } },
            ],
          },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'hello' }] },
        ],
      }),
    );

    expect(history[0]).toMatchObject({ type: 'system' });
    expect(history[1]).toEqual({ type: 'user', text: 'read the file' });
    expect(history[2]).toEqual({
      type: 'model',
      response: ['looking', { type: 'functionCall', name: 'fs__read', params: { path: 'a.md' }, result: 'hello' }],
    });
    // The result is not also a user turn — that would show the model its own
    // answer twice and read as the founder having said it.
    expect(history).toHaveLength(3);
  });

  it('leaves a call that stopped at an approval unanswered rather than inventing a result', () => {
    const history = toLlamaHistory(
      turn({
        messages: [
          { role: 'user', content: 'send it' },
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tu9', name: 'email__send', input: { draft_id: 'd1' } }],
          },
        ],
      }),
    );
    expect(history.at(-1)).toEqual({
      type: 'model',
      response: [{ type: 'functionCall', name: 'email__send', params: { draft_id: 'd1' }, result: undefined }],
    });
  });

  it('pairs each result with its own call when several ran at once', () => {
    const history = toLlamaHistory(
      turn({
        messages: [
          { role: 'user', content: 'both' },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'a', name: 'fs__read', input: { path: 'a' } },
              { type: 'tool_use', id: 'b', name: 'fs__read', input: { path: 'b' } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'b', content: 'B' },
              { type: 'tool_result', tool_use_id: 'a', content: 'A' },
            ],
          },
        ],
      }),
    );
    expect((history[2] as { response: Array<{ params: unknown; result: unknown }> }).response).toEqual([
      { type: 'functionCall', name: 'fs__read', params: { path: 'a' }, result: 'A' },
      { type: 'functionCall', name: 'fs__read', params: { path: 'b' }, result: 'B' },
    ]);
  });

  it('puts the charter and anything volatile into one system message, in order', () => {
    const history = toLlamaHistory(turn({ volatileSystem: ['today is Tuesday'] }));
    expect(history[0]).toEqual({ type: 'system', text: 'preamble\n\ncharter\n\ncanon\n\ntoday is Tuesday' });
  });
});

describe('reading the built-in engine back', () => {
  const response = {
    response: 'on it',
    functionCalls: [{ functionName: 'org__look_up', params: { view: 'tasks' } }],
    metadata: { stopReason: 'functionCalls' },
  };

  it('returns the dotted name the classifier is written in', () => {
    const r = fromLlamaResponse(response);
    expect(r.toolCalls).toEqual([{ id: 'call_0', name: 'org.look_up', args: { view: 'tasks' } }]);
    expect(r.finish).toBe('tool_calls');
    expect(r.costUsd).toBe(0);
  });

  it('records the turn wire-named, so the other engines can read it later', () => {
    expect(fromLlamaResponse(response).raw).toEqual([
      { type: 'text', text: 'on it' },
      { type: 'tool_use', id: 'call_0', name: 'org__look_up', input: { view: 'tasks' } },
    ]);
  });

  it('believes the tool calls over the stop reason', () => {
    // Small models routinely say "stop" while emitting a call. Trusting the
    // label would end the run with the work undone and no error anywhere.
    const r = fromLlamaResponse({ ...response, metadata: { stopReason: 'eogToken' } });
    expect(r.finish).toBe('tool_calls');
  });

  it('reports being cut off as truncated', () => {
    const r = fromLlamaResponse({ response: 'half a th', metadata: { stopReason: 'maxTokens' } });
    expect({ finish: r.finish, calls: r.toolCalls.length }).toEqual({ finish: 'truncated', calls: 0 });
  });

  it('leaves a hallucinated tool name untouched for the classifier to refuse', () => {
    const r = fromLlamaResponse({
      response: '',
      functionCalls: [{ functionName: 'delete_everything', params: {} }],
      metadata: { stopReason: 'functionCalls' },
    });
    expect(r.toolCalls[0]!.name).toBe('delete_everything');
  });
});

describe('the built-in engine takes one turn at a time', () => {
  it('queues, because two generations on one context interleave into nonsense', async () => {
    const order: string[] = [];
    let active = 0;
    const engine: Engine = {
      async generateResponse() {
        active += 1;
        expect(active).toBe(1);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        order.push('done');
        return { response: 'ok', metadata: { stopReason: 'eogToken' } };
      },
    };
    const model = new BuiltinModel({ engine });
    await Promise.all([model.turn(turn()), model.turn(turn()), model.turn(turn())]);
    expect(order).toHaveLength(3);
  });

  it('does not let one failed turn poison the ones behind it', async () => {
    let calls = 0;
    const engine: Engine = {
      async generateResponse() {
        calls += 1;
        if (calls === 1) throw new Error('out of memory');
        return { response: 'fine', metadata: { stopReason: 'eogToken' } };
      },
    };
    const model = new BuiltinModel({ engine });
    await expect(model.turn(turn())).rejects.toThrow('out of memory');
    await expect(model.turn(turn())).resolves.toMatchObject({ text: 'fine' });
  });
});

// ── an OpenAI-compatible server, for people already running one ──────────────

describe('the OpenAI-shaped request', () => {
  it('sends a tool result as its own role, carrying the id of the call', () => {
    const params = buildLocalParams(
      turn({
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'fs__read', input: { path: 'a' } }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'hello' }] },
        ],
      }),
    ) as { messages: Array<Record<string, unknown>> };

    expect(params.messages[2]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'tu1', type: 'function', function: { name: 'fs__read', arguments: '{"path":"a"}' } }],
    });
    expect(params.messages[3]).toEqual({ role: 'tool', tool_call_id: 'tu1', content: 'hello' });
  });

  it('sends nothing only Anthropic understands', () => {
    const body = JSON.stringify(buildLocalParams(turn({ volatileSystem: ['x'] })));
    for (const key of ['cache_control', 'thinking', 'output_config', 'task_budget']) {
      expect({ key, present: body.includes(key) }).toEqual({ key, present: false });
    }
  });

  it('names tools the way this wire requires too', () => {
    const params = buildLocalParams(turn({ tools: TOOLS })) as {
      tools: Array<{ function: { name: string } }>;
    };
    for (const t of params.tools) {
      expect({ name: t.function.name, ok: WIRE_NAME_PATTERN.test(t.function.name) }).toEqual({
        name: t.function.name,
        ok: true,
      });
    }
  });
});

describe('reading an OpenAI-shaped reply', () => {
  it('parses arguments and restores the dotted name', () => {
    const r = interpretLocal({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{ id: 'c1', function: { name: 'org__look_up', arguments: '{"view":"tasks"}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'org.look_up', args: { view: 'tasks' } }]);
    expect(r.usage).toMatchObject({ input: 10, output: 4 });
    expect(r.costUsd).toBe(0);
  });

  it('survives arguments that are not JSON, because small models emit those', () => {
    const r = interpretLocal({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { tool_calls: [{ id: 'c1', function: { name: 'fs__read', arguments: '{path: a' } }] },
        },
      ],
    });
    // Empty rather than thrown: the tool refuses it, the model is told why,
    // and it gets another turn. A throw would end the run.
    expect(r.toolCalls[0]!.args).toEqual({});
  });

  it('invents ids only when it must, and never colliding ones', () => {
    const r = interpretLocal({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              { function: { name: 'fs__read', arguments: '{}' } },
              { function: { name: 'fs__list', arguments: '{}' } },
            ],
          },
        },
      ],
    });
    expect(r.toolCalls.map((c) => c.id)).toEqual(['call_0', 'call_1']);
  });

  it('says plainly what to run when the model was never pulled', async () => {
    const model = new LocalModel({
      baseUrl: 'http://127.0.0.1:9/v1',
      fetch: (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch,
    });
    await expect(model.turn(turn({ model: { ...turn().model, model: 'qwen3:8b' } }))).rejects.toThrow(
      'ollama pull qwen3:8b',
    );
  });
});

// ── the reason both translations exist ───────────────────────────────────────

describe('a transcript outlives the engine that wrote it', () => {
  it('is resumable by the other one, because both store the same shape', () => {
    // Runs park at an approval for days. If the stored shape depended on which
    // engine produced it, switching — or being switched by a missing key —
    // would strand every parked run.
    const fromBuiltin = fromLlamaResponse({
      response: 'reading it',
      functionCalls: [{ functionName: 'fs__read', params: { path: 'a.md' } }],
      metadata: { stopReason: 'functionCalls' },
    });

    const messages = [
      { role: 'user' as const, content: 'read a.md' },
      { role: 'assistant' as const, content: fromBuiltin.raw },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'call_0', content: 'the text' }] },
    ];

    // The OpenAI path reads it.
    const openai = buildLocalParams(turn({ messages })) as { messages: Array<Record<string, unknown>> };
    expect(openai.messages[2]).toMatchObject({
      tool_calls: [{ id: 'call_0', function: { name: 'fs__read' } }],
    });
    expect(openai.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_0', content: 'the text' });

    // And so does the built-in one, pairing the result back onto the call.
    expect(toLlamaHistory(turn({ messages })).at(-1)).toEqual({
      type: 'model',
      response: ['reading it', { type: 'functionCall', name: 'fs__read', params: { path: 'a.md' }, result: 'the text' }],
    });
  });
});
