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

export async function serveAsset(
  res: ServerResponse,
  root: string,
  urlPath: string,
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

  res.writeHead(200, {
    'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    // The shell must not be cached, or a deploy leaves an old app talking to
    // a new API. Everything else is fine to keep for a few minutes.
    'cache-control': path.endsWith('.html') ? 'no-store' : 'public, max-age=300',
  });
  await new Promise<void>((done, fail) => {
    createReadStream(path).on('error', fail).on('end', done).pipe(res);
  });
  return { served: true };
}
