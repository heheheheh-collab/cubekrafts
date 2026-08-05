import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { resolveAsset, defaultWebDir, etagFor, serveAsset } from '../src/server/static.ts';
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

/**
 * A fix that is deployed and still broken in the browser is the worst kind,
 * because everything you can check says it is fine. That is what a cached
 * script buys you, so the caching rules are pinned here.
 */
describe('nothing is used from cache without asking first', () => {
  /**
   * A real writable, because the 200 path pipes the file into it. A hand-made
   * object with an `end()` is not a stream and `pipe` will not talk to one.
   */
  const collect = () => {
    const headers: Record<string, unknown> = {};
    let status = 0;
    const sink = new PassThrough() as PassThrough & {
      writeHead: (code: number, h: Record<string, unknown>) => unknown;
    };
    sink.resume();
    sink.writeHead = (code, h) => {
      status = code;
      Object.assign(headers, h);
      return sink;
    };
    return { res: sink, headers, get status() { return status; } };
  };

  it('tells the browser to revalidate a script rather than reusing it', async () => {
    const sink = collect();
    await serveAsset(sink.res as never, root, '/cards.js');
    // Not `max-age`: any window at all is a window in which a new API is
    // talking to an old front end.
    expect(sink.headers['cache-control']).toBe('no-cache');
    expect(String(sink.headers['etag'])).toMatch(/^W\/"/);
  });

  it('never stores the shell', async () => {
    const sink = collect();
    await serveAsset(sink.res as never, root, '/index.html');
    expect(sink.headers['cache-control']).toBe('no-store');
  });

  it('answers an unchanged file with 304 and no body', async () => {
    const first = collect();
    await serveAsset(first.res as never, root, '/app.css');
    const tag = String(first.headers['etag']);

    const second = collect();
    await serveAsset(second.res as never, root, '/app.css', tag);
    expect(second.status).toBe(304);
    // A 304 carries no body, so it must not claim a length.
    expect(second.headers['content-length']).toBeUndefined();
  });

  it('sends the file again when it has changed', async () => {
    const sink = collect();
    await serveAsset(sink.res as never, root, '/app.css', 'W/"0-0"');
    expect(sink.status).toBe(200);
  });

  it('changes the validator when the file does', () => {
    const before = etagFor({ size: 100, mtimeMs: 1 });
    expect(etagFor({ size: 100, mtimeMs: 2 })).not.toBe(before);
    expect(etagFor({ size: 101, mtimeMs: 1 })).not.toBe(before);
    expect(etagFor({ size: 100, mtimeMs: 1 })).toBe(before);
  });
});
