import { resolve, sep, isAbsolute } from 'node:path';

/**
 * Path containment.
 *
 * The rule that matters: resolve first, then compare. Comparing raw strings
 * lets `../` and `..%2f` walk straight out, and comparing with `startsWith`
 * on an unterminated prefix lets `/srv/app-secrets` pass a check for `/srv/app`.
 *
 * Symlinks are deliberately *not* resolved here — `realpath` touches the disk
 * and this function must stay pure and synchronous so it can sit on the hot
 * path of the classifier. Callers that open the file are responsible for
 * opening it without following links out of the jail; see `guards/fs.ts`.
 */

export interface JailResult {
  ok: boolean;
  /** The resolved absolute path, present whether or not it was allowed. */
  resolved: string;
  /** The root it resolved into, when allowed. */
  root?: string;
  reason?: string;
}

/** True when `child` is `parent` itself or lies beneath it. */
export function isWithin(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  if (c === p) return true;
  // Terminating the prefix is what stops /srv/app matching /srv/app-secrets.
  return c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Resolve `candidate` against the first root that contains it.
 *
 * A relative candidate is resolved against each root in turn, so a role with
 * one root can use relative paths naturally. An absolute candidate must land
 * inside a root on its own merits.
 */
export function confine(candidate: string, roots: readonly string[]): JailResult {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return { ok: false, resolved: '', reason: 'path is empty' };
  }
  if (candidate.includes('\0')) {
    return { ok: false, resolved: '', reason: 'path contains a null byte' };
  }
  if (roots.length === 0) {
    return { ok: false, resolved: resolve(candidate), reason: 'role has no allowed roots' };
  }

  for (const root of roots) {
    const absRoot = resolve(root);
    const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(absRoot, candidate);
    if (isWithin(absRoot, resolved)) {
      return { ok: true, resolved, root: absRoot };
    }
  }

  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(roots[0]!, candidate);
  return {
    ok: false,
    resolved,
    reason: `path resolves to ${resolved}, which is outside every allowed root`,
  };
}
