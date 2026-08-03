/**
 * Tool names on the wire.
 *
 * The API requires every tool name to match `^[a-zA-Z0-9_-]{1,128}$`. Ours are
 * dotted — `fs.read`, `org.look_up`, `email.send` — because the dot carries
 * real meaning: it names the family a tool belongs to, and that grouping is
 * what the classifier, the audit log and the `never_unattended` database
 * constraint are all written in terms of.
 *
 * So the dot stays internal and is translated at the boundary, which is where
 * a format requirement belongs. Renaming everything to `email_send` would have
 * meant rewriting a CHECK constraint in a committed migration, invalidating
 * every row of audit history, and losing the grouping — all to satisfy
 * something only the HTTP layer cares about.
 *
 * The separator is a double underscore rather than a single one, because
 * `org.look_up` already contains a single. `org__look_up` reverses exactly;
 * `org_look_up` would come back as `org.look.up`.
 */

import { TOOLS } from '../tools/registry.ts';

const SEPARATOR = '__';

/** What the API is willing to accept. */
export const WIRE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function toWireName(name: string): string {
  return name.split('.').join(SEPARATOR);
}

export function fromWireName(wire: string): string {
  return wire.split(SEPARATOR).join('.');
}

/**
 * Built from the registry rather than computed per call.
 *
 * A model can return a name we never sent — a hallucination, or a stale tool
 * from an earlier turn — and the round trip has to be a lookup rather than a
 * transformation so that those come back unchanged and get refused by the
 * classifier as the unknown tools they are.
 */
const BY_WIRE: ReadonlyMap<string, string> = new Map(
  TOOLS.map((t) => [toWireName(t.name), t.name]),
);

/** The internal name for something the model asked for, or the string as sent. */
export function resolveToolName(wire: string): string {
  return BY_WIRE.get(wire) ?? wire;
}
