import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

/**
 * The front end, served from disk.
 *
 * No bundler and no build step: the browser gets the files that are in the
 * repository. That keeps the CSP honest — `script-src 'self'` with no inline
 * script and no eval — and it means what you read here is what runs.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

export function defaultWebDir(): string {
  return fileURLToPath(new URL('../../web/', import.meta.url));
}

/**
 * Resolve a URL path inside the web directory, or refuse.
 *
 * Lexical, like the tool jail: resolve, then require the result to sit under
 * a root that ends in a separator, so `/web-secrets` cannot satisfy `/web`.
 * There are no symlinks in a directory of static assets we ship, so the
 * deeper real-disk check the tools need is not warranted here.
 */
export function resolveAsset(root: string, urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const target = resolve(join(root, clean === '/' ? 'index.html' : clean));
  const bounded = root.endsWith(sep) ? root : root + sep;
  if (target !== root.replace(/[/\\]$/, '') && !target.startsWith(bounded)) return null;
  return target;
}

export interface StaticResult {
  served: boolean;
}

/**
 * A weak validator built from what the file system already knows.
 *
 * Size and modification time, so nothing has to be read or hashed to answer
 * a conditional request. A deploy rewrites the files and both change, which
 * is exactly when the browser must be told to fetch again.
 */
export function etagFor(info: { size: number; mtimeMs: number }): string {
  return `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
}

export async function serveAsset(
  res: ServerResponse,
  root: string,
  urlPath: string,
  ifNoneMatch?: string | undefined,
): Promise<StaticResult> {
  const path = resolveAsset(root, urlPath);
  if (!path) return { served: false };

  let info;
  try {
    info = await stat(path);
  } catch {
    return { served: false };
  }
  if (!info.isFile()) return { served: false };

  const etag = etagFor(info);

  /*
   * Nothing is served from cache without asking first.
   *
   * This used to keep scripts for five minutes, on the reasoning that only the
   * shell must be fresh after a deploy. That was backwards: the shell is a
   * dozen lines of markup and the scripts *are* the app, so a five-minute
   * window was five minutes in which a new API could be talking to an old
   * front end. It cost a real bug — a fix shipped, deployed, and still
   * throwing in the browser, with nothing wrong in the code.
   *
   * `no-cache` does not mean "do not store"; it means "revalidate before
   * using". With an ETag that is one conditional request per file per load,
   * answered by a 304 with no body whenever nothing has changed.
   */
  const headers: Record<string, string | number> = {
    'cache-control': path.endsWith('.html') ? 'no-store' : 'no-cache',
    etag,
  };

  if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim() === etag)) {
    res.writeHead(304, headers);
    res.end();
    return { served: true };
  }

  res.writeHead(200, {
    ...headers,
    'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
  });
  await new Promise<void>((done, fail) => {
    createReadStream(path).on('error', fail).on('end', done).pipe(res);
  });
  return { served: true };
}
