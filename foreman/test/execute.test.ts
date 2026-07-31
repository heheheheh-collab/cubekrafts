import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTool, PolicyViolation, type ExecuteContext } from '../src/tools/execute.ts';
import { MemoryAudit } from '../src/guards/audit.ts';
import { DEFAULT_POLICY, type ToolCall } from '../src/domain/types.ts';

let base: string;
let workspace: string;
let outside: string;
let audit: MemoryAudit;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'foreman-'));
  workspace = join(base, 'workspace');
  outside = join(base, 'outside');
  await mkdir(workspace, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(workspace, 'notes.md'), 'hello\n');
  await writeFile(join(outside, 'secret.txt'), 'the key is hunter2\n');
  audit = new MemoryAudit();
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function ctx(): ExecuteContext {
  return {
    role: 'content',
    policy: { ...DEFAULT_POLICY, allowedRoots: { content: [workspace] } },
    facts: {},
    audit,
    runId: 'run_1',
  };
}

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: 'toolu_1',
  name,
  args,
});

describe('reading and writing inside the workspace', () => {
  it('reads a file', async () => {
    const r = await runTool(call('fs.read', { path: 'notes.md' }), ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toBe('hello\n');
  });

  it('writes a file, creating parent directories', async () => {
    const r = await runTool(
      call('fs.write', { path: 'posts/august/draft.md', content: '# Draft' }),
      ctx(),
    );
    expect(r.ok).toBe(true);
    expect(await readFile(join(workspace, 'posts/august/draft.md'), 'utf8')).toBe('# Draft');
  });

  it('lists a directory with trailing slashes on subdirectories', async () => {
    await mkdir(join(workspace, 'posts'));
    const r = await runTool(call('fs.list', { path: '.' }), ctx());
    expect(r.output.split('\n')).toEqual(['notes.md', 'posts/']);
  });
});

describe('the symlink escape', () => {
  it('refuses to read through a symlinked file pointing outside', async () => {
    await symlink(join(outside, 'secret.txt'), join(workspace, 'innocent.md'));
    await expect(runTool(call('fs.read', { path: 'innocent.md' }), ctx())).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it('refuses to write through a symlinked directory pointing outside', async () => {
    await symlink(outside, join(workspace, 'escape'));
    await expect(
      runTool(call('fs.write', { path: 'escape/planted.txt', content: 'x' }), ctx()),
    ).rejects.toThrow(/outside the workspace/);
    // and nothing was written
    await expect(readFile(join(outside, 'planted.txt'), 'utf8')).rejects.toThrow();
  });

  it('still refuses when the link is several directories deep', async () => {
    await mkdir(join(workspace, 'a/b'), { recursive: true });
    await symlink(outside, join(workspace, 'a/b/c'));
    await expect(runTool(call('fs.read', { path: 'a/b/c/secret.txt' }), ctx())).rejects.toThrow(
      /outside the workspace/,
    );
  });

  it('allows a symlink that stays inside the workspace', async () => {
    await mkdir(join(workspace, 'real'));
    await writeFile(join(workspace, 'real/ok.md'), 'fine\n');
    await symlink(join(workspace, 'real'), join(workspace, 'linked'));
    const r = await runTool(call('fs.read', { path: 'linked/ok.md' }), ctx());
    expect(r.output).toBe('fine\n');
  });
});

describe('the executor re-verifies rather than trusting the caller', () => {
  it('refuses a call the classifier would forbid, even when asked directly', async () => {
    await expect(
      runTool(call('fs.read', { path: '../outside/secret.txt' }), ctx()),
    ).rejects.toThrow(PolicyViolation);
  });

  it('refuses a tool the role does not hold', async () => {
    await expect(runTool(call('git.push', { title: 't', body: 'b' }), ctx())).rejects.toThrow(
      /not granted/,
    );
  });

  it('records the refusal in the audit log', async () => {
    await runTool(call('git.push', { title: 't', body: 'b' }), ctx()).catch(() => {});
    expect(audit.actions()).toEqual(['tool.refused']);
    expect(audit.entries[0]!.detail).toMatchObject({ tool: 'git.push' });
  });
});

describe('the audit log brackets every call', () => {
  it('records an attempt before and a result after', async () => {
    await runTool(call('fs.read', { path: 'notes.md' }), ctx());
    expect(audit.actions()).toEqual(['tool.attempt', 'tool.result']);
    const [attempt, result] = audit.entries;
    expect(attempt!.detail).toMatchObject({ tool: 'fs.read', effect: 'safe' });
    expect(result!.detail).toMatchObject({ ok: true, bytes: 6 });
    expect(result!.detail['resultHash']).toMatch(/^[0-9a-f]{16}$/);
  });

  it('stores a hash of the output rather than the output itself', async () => {
    await runTool(call('fs.read', { path: 'notes.md' }), ctx());
    const detail = JSON.stringify(audit.entries[1]!.detail);
    expect(detail).not.toContain('hello');
  });
});

describe('a jail escape aborts the run and is audited as a refusal', () => {
  it('records tool.refused, not a failed result, when a symlink escapes', async () => {
    await symlink(join(outside, 'secret.txt'), join(workspace, 'innocent.md'));
    await expect(runTool(call('fs.read', { path: 'innocent.md' }), ctx())).rejects.toThrow(
      PolicyViolation,
    );
    expect(audit.actions()).toEqual(['tool.attempt', 'tool.refused']);
  });

  it('distinguishes a policy violation from a missing file in the log', async () => {
    await runTool(call('fs.read', { path: 'nope.md' }), ctx());
    expect(audit.actions()).toEqual(['tool.attempt', 'tool.result']);
  });
});

describe('failures come back to the model instead of ending the run', () => {
  it('returns a failed result with a readable message when a file is missing', async () => {
    const r = await runTool(call('fs.read', { path: 'nope.md' }), ctx());
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/ENOENT|no such file/i);
    expect(audit.actions()).toEqual(['tool.attempt', 'tool.result']);
  });

  it('reports an unconfigured sink rather than pretending to have acted', async () => {
    const r = await runTool(
      call('artifact.create', { kind: 'post', title: 't', body: 'b' }),
      ctx(),
    );
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/no sink configured/);
  });
});

describe('sinks', () => {
  it('records an artifact through the injected sink', async () => {
    const created: unknown[] = [];
    const r = await runTool(call('artifact.create', { kind: 'post', title: 'August', body: '# hi' }), {
      ...ctx(),
      sinks: {
        async createArtifact(input) {
          created.push(input);
          return { id: 'art_1' };
        },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/art_1/);
    expect(created).toEqual([{ kind: 'post', title: 'August', body: '# hi' }]);
  });

  it('parks the task when the agent asks the founder', async () => {
    const r = await runTool(call('ask_founder', { question: 'Do we quote for Goa?' }), {
      ...ctx(),
      sinks: { async askFounder() { return { id: 'q_1' }; } },
    });
    expect(r.output).toMatch(/parked until the founder answers/);
  });
});

describe('output is bounded', () => {
  it('truncates enormous files and says so', async () => {
    await writeFile(join(workspace, 'big.txt'), 'x'.repeat(70_000));
    const r = await runTool(call('fs.read', { path: 'big.txt' }), ctx());
    expect(r.output.length).toBeLessThan(61_000);
    expect(r.output).toMatch(/\[truncated — 10000 more characters\]/);
  });
});
