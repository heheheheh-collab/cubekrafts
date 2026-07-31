import { realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { confine, isWithin } from './jail.ts';

/**
 * Filesystem access that survives symlinks.
 *
 * `confine()` in jail.ts is pure and lexical: it stops `../` but cannot know
 * that `workspace/notes` is a symlink pointing at `/etc`. That check needs the
 * disk, so it lives here, and every real read or write goes through these
 * functions rather than through `confine()` alone.
 *
 * The approach is to resolve the deepest ancestor that actually exists — the
 * target file may legitimately not exist yet on a write — and require *that*
 * real path to sit inside the root. A symlinked directory anywhere along the
 * way therefore fails the check.
 */

export interface SafePath {
  ok: boolean;
  /** The lexically resolved path, whether or not it was allowed. */
  path: string;
  /** The root that contained it, so callers can report a relative path. */
  root?: string;
  /** The real path of the nearest existing ancestor, when it could be read. */
  realAncestor?: string;
  reason?: string;
}

/** Walk up until something exists, and return its real path. */
async function realNearestAncestor(path: string): Promise<string | undefined> {
  let current = path;
  // Bounded: `dirname` reaches the filesystem root in a finite number of steps,
  // and the guard below stops us if it ever stops changing.
  for (let i = 0; i < 64; i++) {
    try {
      return await realpath(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
  return undefined;
}

/**
 * Confine `candidate` to `roots`, lexically and then for real.
 *
 * Fails closed on every uncertainty: a path outside the roots, a symlink
 * pointing out of them, or a root that cannot itself be resolved.
 */
export async function safeResolve(
  candidate: string,
  roots: readonly string[],
): Promise<SafePath> {
  const lexical = confine(candidate, roots);
  if (!lexical.ok) {
    return { ok: false, path: lexical.resolved, reason: lexical.reason ?? 'outside the workspace' };
  }

  const root = lexical.root!;
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return { ok: false, path: lexical.resolved, reason: `workspace root ${root} does not exist` };
  }

  const realAncestor = await realNearestAncestor(lexical.resolved);
  if (realAncestor === undefined) {
    return { ok: false, path: lexical.resolved, reason: 'no part of the path could be resolved' };
  }

  if (!isWithin(realRoot, realAncestor)) {
    return {
      ok: false,
      path: lexical.resolved,
      realAncestor,
      reason: `path resolves through a link to ${realAncestor}, outside the workspace`,
    };
  }

  // The remainder of the path beyond the existing ancestor is lexical only,
  // so re-check it against the real root too.
  const finalPath = resolve(lexical.resolved);
  if (!isWithin(realRoot, finalPath) && !isWithin(root, finalPath)) {
    return { ok: false, path: finalPath, realAncestor, reason: 'path escapes the workspace' };
  }

  return { ok: true, path: finalPath, root, realAncestor };
}
