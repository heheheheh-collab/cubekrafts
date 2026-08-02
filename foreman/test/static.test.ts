import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAsset, defaultWebDir } from '../src/server/static.ts';
import { contentSecurityPolicy } from '../src/server/security.ts';

/**
 * The front end is served from disk with no build step, so the things worth
 * testing are the two that would quietly break it: a path that escapes the
 * web directory, and a page that violates its own content security policy.
 */

const root = defaultWebDir();

describe('asset paths', () => {
  it('serves the shell for the root', () => {
    expect(resolveAsset(root, '/')).toBe(join(root, 'index.html'));
  });

  it('serves a normal file', () => {
    expect(resolveAsset(root, '/app.css')).toBe(join(root, 'app.css'));
  });

  it('ignores a query string', () => {
    expect(resolveAsset(root, '/app.js?v=2')).toBe(join(root, 'app.js'));
  });

  it('refuses to climb out', () => {
    expect(resolveAsset(root, '/../package.json')).toBeNull();
    expect(resolveAsset(root, '/../../etc/passwd')).toBeNull();
    expect(resolveAsset(root, '/a/../../src/server/index.ts')).toBeNull();
  });

  it('refuses an escape hidden in percent-encoding', () => {
    expect(resolveAsset(root, '/%2e%2e/package.json')).toBeNull();
  });

  it('is not fooled by a sibling directory with the same prefix', () => {
    // `/srv/web-secrets` must not satisfy a root of `/srv/web`.
    expect(resolveAsset('/srv/web', '/../web-secrets/keys.txt')).toBeNull();
  });
});

describe('the pages obey their own CSP', () => {
  it('has no inline script and no inline event handlers', async () => {
    // `script-src 'self'` means an inline handler silently does nothing —
    // the kind of break that shows up as a dead button rather than an error.
    expect(contentSecurityPolicy()).toContain("script-src 'self'");
    const html = await readFile(join(root, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toContain('type="module"');
  });

  it('loads nothing from another host', async () => {
    for (const name of await readdir(root)) {
      const body = await readFile(join(root, name), 'utf8');
      expect({ name, offsite: /(?:src|href)\s*=\s*["']https?:\/\//i.test(body) }).toEqual({
        name,
        offsite: false,
      });
    }
  });

  it('builds the DOM without innerHTML anywhere', async () => {
    // Agent output reaches these cards. `textContent` throughout is the whole
    // defence, and it is only a defence if there are no exceptions.
    for (const name of await readdir(root)) {
      if (!name.endsWith('.js')) continue;
      const body = await readFile(join(root, name), 'utf8');
      expect({ name, unsafe: /innerHTML|outerHTML|insertAdjacentHTML/.test(body) }).toEqual({
        name,
        unsafe: false,
      });
    }
  });
});
