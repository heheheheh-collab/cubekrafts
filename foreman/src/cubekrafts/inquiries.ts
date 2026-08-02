import type { Sql } from '../db/sql.ts';
import { upsertLead } from '../email/messages.ts';

/**
 * Reading inquiries out of Cubekrafts.
 *
 * Cubekrafts is a Lovable project, so its data lives in the Supabase Postgres
 * behind it and is read over PostgREST rather than over a bespoke API. That
 * is a better arrangement than the plan assumed: the key is scoped by row
 * level security rather than by our promise to only call GET.
 *
 * The table and its column names are configuration, not assumptions. Every
 * form is shaped differently, and hard-coding `email` and `message` here
 * would mean a code change the first time the site's form gains a field.
 */

export interface CubekraftsConfig {
  /** `https://<ref>.supabase.co` — no trailing slash, no `/rest/v1`. */
  url: string;
  /**
   * The anon key, with a row-level-security policy allowing SELECT on the
   * inquiries table and nothing else. Not the service role key: that one
   * bypasses RLS entirely and would let a prompt injection read every table.
   */
  key: string;
  table: string;
  columns: {
    id: string;
    email: string;
    name?: string;
    message?: string;
    createdAt?: string;
  };
}

export const DEFAULT_COLUMNS: CubekraftsConfig['columns'] = {
  id: 'id',
  email: 'email',
  name: 'name',
  message: 'message',
  createdAt: 'created_at',
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): CubekraftsConfig | null {
  const url = env['CUBEKRAFTS_SUPABASE_URL'];
  const key = env['CUBEKRAFTS_SUPABASE_KEY'];
  if (!url || !key) return null;

  return {
    url: url.replace(/\/+$/, ''),
    key,
    table: env['CUBEKRAFTS_INQUIRY_TABLE'] ?? 'inquiries',
    columns: {
      id: env['CUBEKRAFTS_COL_ID'] ?? DEFAULT_COLUMNS.id,
      email: env['CUBEKRAFTS_COL_EMAIL'] ?? DEFAULT_COLUMNS.email,
      ...(env['CUBEKRAFTS_COL_NAME'] ?? DEFAULT_COLUMNS.name
        ? { name: env['CUBEKRAFTS_COL_NAME'] ?? DEFAULT_COLUMNS.name }
        : {}),
      ...(env['CUBEKRAFTS_COL_MESSAGE'] ?? DEFAULT_COLUMNS.message
        ? { message: env['CUBEKRAFTS_COL_MESSAGE'] ?? DEFAULT_COLUMNS.message }
        : {}),
      ...(env['CUBEKRAFTS_COL_CREATED'] ?? DEFAULT_COLUMNS.createdAt
        ? { createdAt: env['CUBEKRAFTS_COL_CREATED'] ?? DEFAULT_COLUMNS.createdAt }
        : {}),
    },
  };
}

export interface Inquiry {
  externalId: string;
  email: string;
  name: string | null;
  message: string | null;
  at: string | null;
}

export class CubekraftsError extends Error {}

/** Injected so the tests do not need a Supabase, and so nothing here is mocked twice. */
export type Fetcher = typeof fetch;

/**
 * Read the most recent inquiries.
 *
 * Read-only by construction: this issues a GET and there is no other verb in
 * this file. A limit is always sent, because an inquiry table that has grown
 * to ten thousand rows should slow nothing down and cost nothing extra.
 */
export async function fetchInquiries(
  config: CubekraftsConfig,
  opts: { limit?: number; since?: string; fetcher?: Fetcher } = {},
): Promise<Inquiry[]> {
  const c = config.columns;
  const select = [c.id, c.email, c.name, c.message, c.createdAt]
    .filter((x): x is string => typeof x === 'string')
    .join(',');

  const url = new URL(`${config.url}/rest/v1/${config.table}`);
  url.searchParams.set('select', select);
  url.searchParams.set('limit', String(opts.limit ?? 25));
  if (c.createdAt) url.searchParams.set('order', `${c.createdAt}.desc`);
  if (opts.since && c.createdAt) url.searchParams.set(c.createdAt, `gte.${opts.since}`);

  const doFetch = opts.fetcher ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new CubekraftsError(
      `could not reach Cubekrafts: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    // A 401 here almost always means the key is right but the row level
    // security policy does not allow the read, which is a different fix from
    // a wrong key — so the body goes into the message.
    throw new CubekraftsError(`Cubekrafts refused the read (${response.status}): ${text.slice(0, 300)}`);
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = JSON.parse(text) as Array<Record<string, unknown>>;
  } catch {
    throw new CubekraftsError('Cubekrafts returned something that was not JSON');
  }
  if (!Array.isArray(rows)) throw new CubekraftsError('expected a list of inquiries');

  return rows.map((row) => ({
    externalId: String(row[c.id] ?? ''),
    email: String(row[c.email] ?? ''),
    name: c.name ? asText(row[c.name]) : null,
    message: c.message ? asText(row[c.message]) : null,
    at: c.createdAt ? asText(row[c.createdAt]) : null,
  }));
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface SyncResult {
  seen: number;
  newLeads: number;
  skipped: number;
}

/**
 * Pull inquiries in and make each one a lead.
 *
 * `upsertLead` is keyed on the address, so running this twice does not create
 * two of anybody. Rows with an unusable address are counted and skipped
 * rather than aborting the sync — one malformed submission should not stop
 * the other twenty-four being answered.
 */
export async function syncInquiries(
  sql: Sql,
  config: CubekraftsConfig,
  opts: { limit?: number; since?: string; fetcher?: Fetcher } = {},
): Promise<SyncResult> {
  const inquiries = await fetchInquiries(config, opts);
  let newLeads = 0;
  let skipped = 0;

  for (const inquiry of inquiries) {
    const { rows: before } = await sql.query(`SELECT 1 FROM lead WHERE lower(email) = lower($1)`, [
      inquiry.email,
    ]);
    try {
      await upsertLead(sql, {
        email: inquiry.email,
        ...(inquiry.name ? { name: inquiry.name } : {}),
        source: 'cubekrafts',
        // Someone who filled in the contact form asked to be replied to.
        // That is the consent, and it is the only kind this system accepts.
        consent: 'enquiry',
      });
    } catch {
      skipped++;
      continue;
    }
    if (before.length === 0) newLeads++;
  }

  return { seen: inquiries.length, newLeads, skipped };
}
