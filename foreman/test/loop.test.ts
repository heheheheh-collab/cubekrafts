import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent, type LoopContext } from '../src/agents/loop.ts';
import { MemoryAudit } from '../src/guards/audit.ts';
import { DEFAULT_POLICY } from '../src/domain/types.ts';
import { CATALOG } from '../src/claude/catalog.ts';
import type { TurnResult } from '../src/claude/client.ts';

/** A Claude stand-in that replays a scripted list of turns. */
function scripted(turns: Partial<TurnResult>[]) {
  let i = 0;
  const seen: unknown[] = [];
  return {
    seen,
    calls: () => i,
    turn: async (t: unknown) => {
      seen.push(t);
      const next = turns[i++] ?? { finish: 'end' as const, text: 'fallback' };
      return {
        finish: 'end',
        text: '',
        toolCalls: [],
        usage: { input: 100, cachedInput: 900, cacheWrite: 0, output: 50 },
        costUsd: 0.001,
        raw: [],
        ...next,
      } as TurnResult;
    },
  };
}

let workspace: string;
let audit: MemoryAudit;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'foreman-loop-'));
  await mkdir(workspace, { recursive: true });
  audit = new MemoryAudit();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function ctx(over: Partial<LoopContext> = {}): LoopContext {
  return {
    runId: 'run_1',
    role: 'content',
    claude: scripted([]),
    model: CATALOG.mid,
    effort: 'high',
    policy: { ...DEFAULT_POLICY, allowedRoots: { content: [workspace] } },
    facts: {},
    audit,
    autonomy: () => 'auto',
    stableSystem: ['preamble', 'charter'],
    ...over,
  };
}

const user = [{ role: 'user' as const, content: 'write the august post' }];

describe('a plain answer', () => {
  it('finishes on the first turn and records the run', async () => {
    const claude = scripted([{ finish: 'end', text: 'here it is' }]);
    const r = await runAgent(user, ctx({ claude }));
    expect(r.outcome).toEqual({ kind: 'done', text: 'here it is' });
    expect(r.steps).toBe(1);
    expect(audit.actions()).toEqual(['run.start', 'run.done']);
  });

  it('accumulates usage and cost across turns', async () => {
    const claude = scripted([
      { finish: 'tool_calls', toolCalls: [{ id: 't1', name: 'fs.list', args: { path: '.' } }] },
      { finish: 'end', text: 'done' },
    ]);
    const r = await runAgent(user, ctx({ claude }));
    expect(r.steps).toBe(2);
    expect(r.usage).toEqual({ input: 200, cachedInput: 1800, cacheWrite: 0, output: 100 });
    expect(r.costUsd).toBeCloseTo(0.002, 6);
  });
});

describe('tool calls', () => {
  it('executes a safe call and feeds the result back in one user message', async () => {
    const claude = scripted([
      {
        finish: 'tool_calls',
        toolCalls: [
          { id: 't1', name: 'fs.write', args: { path: 'post.md', content: '# August' } },
        ],
      },
      { finish: 'end', text: 'written' },
    ]);
    const r = await runAgent(user, ctx({ claude }));
    expect(r.outcome.kind).toBe('done');
    const toolResultMessage = r.messages.at(-2)!;
    expect(toolResultMessage.role).toBe('user');
    expect(toolResultMessage.content).toMatchObject([{ type: 'tool_result', tool_use_id: 't1' }]);
  });

  it('returns several results in a single user message, not one each', async () => {
    const claude = scripted([
      {
        finish: 'tool_calls',
        toolCalls: [
          { id: 't1', name: 'fs.list', args: { path: '.' } },
          { id: 't2', name: 'fs.list', args: { path: '.' } },
        ],
      },
      { finish: 'end', text: 'ok' },
    ]);
    const r = await runAgent(user, ctx({ claude }));
    const userMessages = r.messages.filter((m) => m.role === 'user');
    // the original prompt, plus exactly one message carrying both results
    expect(userMessages).toHaveLength(2);
    expect(userMessages[1]!.content).toHaveLength(2);
  });

  it('marks a failed tool result as an error rather than hiding it', async () => {
    const claude = scripted([
      { finish: 'tool_calls', toolCalls: [{ id: 't1', name: 'fs.read', args: { path: 'gone.md' } }] },
      { finish: 'end', text: 'ah' },
    ]);
    const r = await runAgent(user, ctx({ claude }));
    expect(r.messages.at(-2)!.content).toMatchObject([{ is_error: true }]);
  });
});

describe('stopping at the founder', () => {
  it('parks on the first guarded call instead of running the safe ones after it', async () => {
    const claude = scripted([
      {
        finish: 'tool_calls',
        toolCalls: [
          { id: 't1', name: 'email.send', args: { draft_id: 'd1' } },
          { id: 't2', name: 'fs.write', args: { path: 'should-not-exist.md', content: 'x' } },
        ],
      },
    ]);
    const r = await runAgent(user, ctx({ claude, role: 'sales', autonomy: () => 'approve' }));
    expect(r.outcome.kind).toBe('awaiting_approval');
    expect(audit.actions()).toEqual(['run.start', 'run.parked']);
    // the second call never ran
    expect(audit.entries.some((e) => e.action === 'tool.attempt')).toBe(false);
  });

  it('parks when the agent asks a question, even though the tool succeeded', async () => {
    const claude = scripted([
      {
        finish: 'tool_calls',
        toolCalls: [{ id: 't1', name: 'ask_founder', args: { question: 'Do we quote for Goa?' } }],
      },
    ]);
    const r = await runAgent(
      user,
      ctx({ claude, sinks: { async askFounder() { return { id: 'q1' }; } } }),
    );
    expect(r.outcome).toEqual({ kind: 'awaiting_founder', question: 'Do we quote for Goa?' });
  });
});

describe('endings that are not success', () => {
  it('stops on a refusal and keeps the category', async () => {
    const claude = scripted([
      { finish: 'refused', refusal: { category: 'cyber', explanation: 'declined' } },
    ]);
    const r = await runAgent(user, ctx({ claude }));
    expect(r.outcome).toMatchObject({ kind: 'refused', category: 'cyber' });
    expect(audit.actions()).toContain('run.refused');
  });

  it('reports truncation rather than silently returning half an answer', async () => {
    const claude = scripted([{ finish: 'truncated', text: 'half a th' }]);
    expect((await runAgent(user, ctx({ claude }))).outcome.kind).toBe('exhausted');
  });

  it('refuses the whole run when a tool is forbidden for the role', async () => {
    const claude = scripted([
      { finish: 'tool_calls', toolCalls: [{ id: 't1', name: 'git.push', args: { title: 'a', body: 'b' } }] },
    ]);
    const r = await runAgent(user, ctx({ claude }));
    expect(r.outcome).toMatchObject({ kind: 'refused' });
    expect(r.outcome.kind === 'refused' && r.outcome.reason).toMatch(/not granted/);
  });

  it('stops after the step limit rather than looping forever', async () => {
    const claude = scripted(
      Array.from({ length: 20 }, () => ({
        finish: 'tool_calls' as const,
        toolCalls: [{ id: 't', name: 'fs.list', args: { path: '.' } }],
      })),
    );
    const r = await runAgent(user, ctx({ claude, maxSteps: 3 }));
    expect(r.outcome).toMatchObject({ kind: 'exhausted' });
    expect(claude.calls()).toBe(3);
    // and it reports the steps it actually took, not one past the end
    expect(r.steps).toBe(3);
  });

  it('ends the turn rather than sending an empty tool-result message', async () => {
    // A turn that claims tool use but carries no callable blocks would
    // otherwise push a user message with an empty content array, which the
    // API rejects.
    const claude = scripted([{ finish: 'tool_calls', toolCalls: [], text: 'thinking aloud' }]);
    const r = await runAgent(user, ctx({ claude }));
    expect(r.outcome).toEqual({ kind: 'done', text: 'thinking aloud' });
    expect(claude.calls()).toBe(1);
  });
});

describe('the founder can stop it mid-run', () => {
  it('aborts before the next model call when the signal fires', async () => {
    const controller = new AbortController();
    const claude = scripted([
      { finish: 'tool_calls', toolCalls: [{ id: 't1', name: 'fs.list', args: { path: '.' } }] },
      { finish: 'end', text: 'never reached' },
    ]);
    const r = await runAgent(
      user,
      ctx({
        claude,
        signal: controller.signal,
        async onStep() {
          controller.abort();
        },
      }),
    );
    expect(r.outcome).toMatchObject({ kind: 'aborted' });
    expect(claude.calls()).toBe(1);
    expect(audit.actions()).toContain('run.aborted');
  });
});

describe('checkpointing', () => {
  it('calls back after every step so a crash can resume', async () => {
    const seen: number[] = [];
    const claude = scripted([
      { finish: 'tool_calls', toolCalls: [{ id: 't1', name: 'fs.list', args: { path: '.' } }] },
      { finish: 'end', text: 'done' },
    ]);
    await runAgent(
      user,
      ctx({
        claude,
        async onStep(step) {
          seen.push(step);
        },
      }),
    );
    expect(seen).toEqual([1, 2]);
  });
});

describe('the prompt it builds', () => {
  it('passes the stable prefix through unchanged on every turn', async () => {
    const claude = scripted([
      { finish: 'tool_calls', toolCalls: [{ id: 't1', name: 'fs.list', args: { path: '.' } }] },
      { finish: 'end', text: 'done' },
    ]);
    await runAgent(user, ctx({ claude }));
    const prefixes = claude.seen.map((t) => JSON.stringify((t as { stableSystem: string[] }).stableSystem));
    expect(new Set(prefixes).size).toBe(1);
  });

  it('gives the role only the tools it holds', async () => {
    const claude = scripted([{ finish: 'end', text: 'ok' }]);
    await runAgent(user, ctx({ claude, role: 'content' }));
    const names = ((claude.seen[0] as { tools: { name: string }[] }).tools).map((t) => t.name);
    expect(names).toContain('fs.write');
    expect(names).not.toContain('git.push');
    expect(names).not.toContain('email.send');
  });
});
