import { describe, it, expect } from 'vitest';
import { buildParams, interpret, type Turn } from '../src/claude/client.ts';
import { CATALOG, costOf, cacheHitRate, addUsage, type Usage } from '../src/claude/catalog.ts';
import { TOOLS, toolsFor } from '../src/tools/registry.ts';
import { WIRE_NAME_PATTERN, resolveToolName, toWireName } from '../src/claude/wire-names.ts';

const turn = (over: Partial<Turn> = {}): Turn => ({
  stableSystem: ['tool preamble', 'charter', 'canon'],
  messages: [{ role: 'user', content: 'go' }],
  tools: toolsFor('content'),
  model: CATALOG.mid,
  effort: 'high',
  ...over,
});

describe('the request is shaped for caching', () => {
  it('puts exactly one cache breakpoint, on the last stable block', () => {
    const p = buildParams(turn(), 8000);
    const system = p['system'] as Array<Record<string, unknown>>;
    const marked = system.filter((b) => b['cache_control'] !== undefined);
    expect(marked).toHaveLength(1);
    expect(marked[0]!['text']).toBe('canon');
  });

  it('leaves volatile blocks after the breakpoint uncached', () => {
    const p = buildParams(turn({ volatileSystem: ['today is Tuesday'] }), 8000);
    const system = p['system'] as Array<Record<string, unknown>>;
    expect(system.at(-1)).toMatchObject({ text: 'today is Tuesday' });
    expect(system.at(-1)!['cache_control']).toBeUndefined();
  });

  it('uses the one-hour cache window, because ticks are ten minutes apart', () => {
    const p = buildParams(turn(), 8000);
    const system = p['system'] as Array<Record<string, unknown>>;
    expect(system[2]!['cache_control']).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('serialises tools in a stable order whatever order they arrive in', () => {
    const forward = buildParams(turn(), 8000);
    const reversed = buildParams(turn({ tools: [...toolsFor('content')].reverse() }), 8000);
    expect(JSON.stringify(forward['tools'])).toBe(JSON.stringify(reversed['tools']));
  });
});

describe('the request uses the current API surface', () => {
  it('asks for adaptive thinking and never a token budget', () => {
    const p = buildParams(turn(), 8000);
    expect(p['thinking']).toEqual({ type: 'adaptive' });
    expect(JSON.stringify(p)).not.toContain('budget_tokens');
  });

  it('sends no sampling parameters, which current models reject', () => {
    const p = buildParams(turn(), 8000);
    for (const banned of ['temperature', 'top_p', 'top_k']) {
      expect(p[banned], banned).toBeUndefined();
    }
  });

  it('puts effort inside output_config, not at the top level', () => {
    const p = buildParams(turn({ effort: 'xhigh' }), 8000);
    expect(p['output_config']).toMatchObject({ effort: 'xhigh' });
    expect(p['effort']).toBeUndefined();
  });

  it('includes a task budget only when one was asked for', () => {
    expect((buildParams(turn(), 8000)['output_config'] as Record<string, unknown>)['task_budget'])
      .toBeUndefined();
    const withBudget = buildParams(turn({ taskBudgetTokens: 40_000 }), 8000);
    expect((withBudget['output_config'] as Record<string, unknown>)['task_budget']).toEqual({
      type: 'tokens',
      total: 40_000,
    });
  });

  it('marks every tool strict so arguments validate exactly', () => {
    const tools = buildParams(turn(), 8000)['tools'] as Array<Record<string, unknown>>;
    expect(tools.every((t) => t['strict'] === true)).toBe(true);
  });
});

describe('interpreting the response', () => {
  const usage = {
    input_tokens: 200,
    cache_read_input_tokens: 12_000,
    cache_creation_input_tokens: 0,
    output_tokens: 500,
  };

  it('reads plain text', () => {
    const r = interpret(
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage },
      CATALOG.mid,
    );
    expect(r.finish).toBe('end');
    expect(r.text).toBe('done');
  });

  it('extracts tool calls', () => {
    const r = interpret(
      {
        content: [
          { type: 'text', text: 'writing it now' },
          { type: 'tool_use', id: 'toolu_1', name: 'fs.write', input: { path: 'a.md', content: 'x' } },
        ],
        stop_reason: 'tool_use',
        usage,
      },
      CATALOG.mid,
    );
    expect(r.finish).toBe('tool_calls');
    expect(r.toolCalls).toEqual([
      { id: 'toolu_1', name: 'fs.write', args: { path: 'a.md', content: 'x' } },
    ]);
    expect(r.text).toBe('writing it now');
  });

  it('handles a refusal without reaching into empty content', () => {
    const r = interpret(
      {
        content: [],
        stop_reason: 'refusal',
        stop_details: { category: 'cyber', explanation: 'declined' },
        usage,
      },
      CATALOG.mid,
    );
    expect(r.finish).toBe('refused');
    expect(r.refusal).toEqual({ category: 'cyber', explanation: 'declined' });
    expect(r.text).toBe('');
  });

  it('reports truncation distinctly from a normal ending', () => {
    const r = interpret(
      { content: [{ type: 'text', text: 'half a th' }], stop_reason: 'max_tokens', usage },
      CATALOG.mid,
    );
    expect(r.finish).toBe('truncated');
  });

  it('survives a response with no usage block at all', () => {
    const r = interpret({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }, CATALOG.mid);
    expect(r.usage).toEqual({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0 });
    expect(r.costUsd).toBe(0);
  });
});

describe('cost', () => {
  it('prices cached input at a tenth of fresh input', () => {
    const fresh: Usage = { input: 1_000_000, cachedInput: 0, cacheWrite: 0, output: 0 };
    const cached: Usage = { input: 0, cachedInput: 1_000_000, cacheWrite: 0, output: 0 };
    expect(costOf(fresh, CATALOG.top)).toBeCloseTo(5.0, 6);
    expect(costOf(cached, CATALOG.top)).toBeCloseTo(0.5, 6);
  });

  it('charges double for a one-hour cache write', () => {
    const write: Usage = { input: 0, cachedInput: 0, cacheWrite: 1_000_000, output: 0 };
    expect(costOf(write, CATALOG.top, '1h')).toBeCloseTo(10.0, 6);
    expect(costOf(write, CATALOG.top, '5m')).toBeCloseTo(6.25, 6);
  });

  it('prices a realistic warm turn in fractions of a cent', () => {
    const warm: Usage = { input: 400, cachedInput: 14_000, cacheWrite: 0, output: 900 };
    // Sonnet: 400 fresh + 14k cached input, 900 output
    expect(costOf(warm, CATALOG.mid)).toBeCloseTo(0.0012 + 0.0042 + 0.0135, 4);
  });

  it('reports the cache hit rate, which is the number that matters', () => {
    expect(cacheHitRate({ input: 400, cachedInput: 14_000, cacheWrite: 0, output: 900 })).toBeCloseTo(
      0.972,
      3,
    );
    expect(cacheHitRate({ input: 14_400, cachedInput: 0, cacheWrite: 0, output: 900 })).toBe(0);
    expect(cacheHitRate({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0 })).toBe(0);
  });

  it('accumulates usage across the steps of a run', () => {
    const a: Usage = { input: 1, cachedInput: 2, cacheWrite: 3, output: 4 };
    expect(addUsage(a, a)).toEqual({ input: 2, cachedInput: 4, cacheWrite: 6, output: 8 });
  });
});

// ── what the API will actually accept ───────────────────────────────────────

describe('tool names on the wire', () => {
  it('sends every tool under a name the API permits', () => {
    // The bug this exists for: the API requires ^[a-zA-Z0-9_-]{1,128}$ and
    // every one of our names has a dot in it. All 449 tests passed and the
    // app could not talk to Claude at all, because Claude is scripted in
    // every one of them and the wire format was never checked.
    for (const tool of TOOLS) {
      const wire = toWireName(tool.name);
      expect({ tool: tool.name, ok: WIRE_NAME_PATTERN.test(wire) }).toEqual({
        tool: tool.name,
        ok: true,
      });
    }
  });

  it('checks the names in the request itself, not just the registry', () => {
    const params = buildParams({
      stableSystem: ['s'],
      messages: [],
      tools: toolsFor('developer'),
      model: CATALOG.top,
      effort: 'high',
    }, 8000) as unknown as { tools: Array<{ name: string }> };

    expect(params.tools.length).toBeGreaterThan(4);
    for (const t of params.tools) {
      expect({ name: t.name, ok: WIRE_NAME_PATTERN.test(t.name) }).toEqual({
        name: t.name,
        ok: true,
      });
    }
  });

  it('round-trips every name exactly, including the ones with underscores', () => {
    // `org.look_up` is why the separator is a double underscore. A single one
    // would come back as `org.look.up`.
    for (const tool of TOOLS) {
      expect(resolveToolName(toWireName(tool.name))).toBe(tool.name);
    }
    expect(toWireName('org.look_up')).toBe('org__look_up');
    expect(resolveToolName('org__look_up')).toBe('org.look_up');
  });

  it('leaves a name it never sent alone, so the classifier can refuse it', () => {
    // A hallucinated tool must not be transformed into something plausible.
    expect(resolveToolName('delete_everything')).toBe('delete_everything');
    expect(resolveToolName('fs__destroy')).toBe('fs__destroy');
  });

  it('maps a tool call in a real response back to its dotted name', () => {
    const result = interpret(
      {
        content: [{ type: 'tool_use', id: 'tu1', name: 'org__look_up', input: { view: 'tasks' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      } as never,
      CATALOG.cheap,
    );
    expect(result.toolCalls[0]).toMatchObject({ name: 'org.look_up', args: { view: 'tasks' } });
  });

  it('keeps the wire names unique, so the round trip cannot collide', () => {
    const wire = TOOLS.map((t) => toWireName(t.name));
    expect(new Set(wire).size).toBe(wire.length);
  });
});
