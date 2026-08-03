import type { Sql } from '../db/sql.ts';
import { getSetting, setSetting } from '../db/repo.ts';

/**
 * The things Foreman needs from the outside world, set from inside the app.
 *
 * Each of these used to be an environment variable, which on a deployed
 * machine meant that turning a capability on was a redeploy — and, for the
 * secrets among them, meant the value lived in a hosting dashboard where it
 * is easy to leak and hard to rotate. They are settings now: typed into the
 * app, stored in the database, applied to `process.env` at boot before
 * anything reads it, and surviving restarts.
 *
 * The environment still works and still wins nothing: a stored value replaces
 * it, because pasting one into a running app is the more deliberate act. That
 * is the same rule the API key follows.
 *
 * Secrets are never returned. `status()` reports whether a value is present
 * and, for the ones where recognising it matters, the last four characters.
 * The export filters them out by key.
 */

export interface Field {
  /** The environment variable this fills in. Also the settings key suffix. */
  env: string;
  label: string;
  /** Never returned to the browser, never exported, never logged. */
  secret: boolean;
  placeholder?: string;
}

export interface Connection {
  id: string;
  title: string;
  /** What turns on when this is filled in. */
  enables: string;
  /** Shown when it is not configured: where the values come from. */
  how: string;
  fields: readonly Field[];
}

export const CONNECTIONS: readonly Connection[] = [
  {
    id: 'cubekrafts',
    title: 'Cubekrafts',
    enables: 'Sales can read the quote requests nobody has answered, and draft replies to them.',
    how:
      'In Supabase (the database behind QuoteCraft Pro): Edge Functions → foreman-unrouted → ' +
      'copy its URL. Then Settings → Edge Functions → Secrets → set FOREMAN_READ_SECRET to a ' +
      'long random string, and paste that same string below.',
    fields: [
      {
        env: 'CUBEKRAFTS_ENDPOINT',
        label: 'Read endpoint',
        secret: false,
        placeholder: 'https://….supabase.co/functions/v1/foreman-unrouted',
      },
      { env: 'CUBEKRAFTS_SECRET', label: 'Shared secret', secret: true },
    ],
  },
  {
    id: 'github',
    title: 'The site repository',
    enables: 'The developer can read the site, make changes on a branch, and open pull requests.',
    how:
      'In Lovable, connect the project to GitHub (GitHub → Connect). Then create a fine-grained ' +
      'token at github.com/settings/tokens with Contents: read and write on that one repository.',
    fields: [
      { env: 'GITHUB_REPO', label: 'Repository', secret: false, placeholder: 'owner/repo' },
      { env: 'GITHUB_TOKEN', label: 'Access token', secret: true },
    ],
  },
  {
    id: 'email',
    title: 'Sending email',
    enables: 'Approved replies are actually delivered, as you, instead of being recorded.',
    how:
      'Create an account at resend.com, add cubekrafts.com as a domain, and add the DNS records ' +
      'it gives you at GoDaddy. Note the SPF include it asks for — the check below verifies it.',
    fields: [
      { env: 'RESEND_API_KEY', label: 'Resend API key', secret: true },
      {
        env: 'EMAIL_FROM',
        label: 'From address',
        secret: false,
        placeholder: 'Cubekrafts <info@cubekrafts.com>',
      },
      { env: 'EMAIL_SPF_INCLUDE', label: 'SPF include', secret: false, placeholder: 'amazonses.com' },
    ],
  },
];

const FIELDS: readonly Field[] = CONNECTIONS.flatMap((c) => c.fields);

/** Settings key for a field. Prefixed so it cannot collide with anything else. */
export const settingKey = (env: string): string => `connection.${env}`;

/** Every settings key holding a secret, for the export to filter out. */
export const CONNECTION_SECRET_SETTINGS: readonly string[] = FIELDS.filter((f) => f.secret).map(
  (f) => settingKey(f.env),
);

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The environment as the process was started with, captured at module load —
 * before `applyConnections` overwrites anything.
 *
 * Clearing a stored value has to fall back to what the environment said, and
 * by then `process.env` no longer remembers it.
 */
const BOOT_ENV: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  FIELDS.map((f) => [f.env, process.env[f.env]]),
);

/**
 * Put stored values into `process.env`.
 *
 * Called once at boot, before anything reads the environment. Everything
 * downstream keeps reading `process.env` and never learns that a value came
 * from the database.
 */
export async function applyConnections(sql: Sql): Promise<void> {
  for (const field of FIELDS) {
    const stored = await getSetting<string | null>(sql, settingKey(field.env), null);
    const value = clean(stored);
    if (value) process.env[field.env] = value;
  }
}

export interface ConnectionStatus {
  id: string;
  title: string;
  enables: string;
  how: string;
  connected: boolean;
  fields: Array<{
    env: string;
    label: string;
    secret: boolean;
    placeholder?: string;
    /** Present for non-secrets; a masked hint for secrets; null when unset. */
    value: string | null;
    from: 'settings' | 'environment' | null;
  }>;
}

export async function status(sql: Sql): Promise<ConnectionStatus[]> {
  const out: ConnectionStatus[] = [];
  for (const connection of CONNECTIONS) {
    const fields: ConnectionStatus['fields'] = [];
    for (const field of connection.fields) {
      const stored = clean(await getSetting<string | null>(sql, settingKey(field.env), null));
      const live = clean(process.env[field.env]);
      const from = stored ? 'settings' : live ? 'environment' : null;
      fields.push({
        env: field.env,
        label: field.label,
        secret: field.secret,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        // A secret never comes back. Four characters is enough to tell two
        // keys apart and not enough to use one.
        value: !live ? null : field.secret ? `…${live.slice(-4)}` : live,
        from,
      });
    }
    // Connected means every field that has no default is filled in. The SPF
    // include is the one optional field, so it is not counted.
    const required = connection.fields.filter((f) => f.env !== 'EMAIL_SPF_INCLUDE');
    const connected = required.every((f) => clean(process.env[f.env]).length > 0);
    out.push({ ...connection, connected, fields });
  }
  return out;
}

/**
 * Save what was typed, and put it in force.
 *
 * An empty string clears a stored value and falls back to the environment —
 * the same shape as removing the API key. Unknown keys are ignored rather
 * than rejected, so a browser sending a field this build does not have cannot
 * fail the whole save.
 */
export async function save(sql: Sql, values: Record<string, unknown>): Promise<void> {
  for (const field of FIELDS) {
    if (!(field.env in values)) continue;
    const value = clean(values[field.env]);
    await setSetting(sql, settingKey(field.env), value === '' ? null : value);
    if (value !== '') {
      process.env[field.env] = value;
    } else if (BOOT_ENV[field.env] !== undefined) {
      process.env[field.env] = BOOT_ENV[field.env];
    } else {
      delete process.env[field.env];
    }
  }
}
