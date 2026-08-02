import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate, defaultMigrationsDir } from '../src/db/migrate.ts';
import {
  CubekraftsError,
  configFromEnv,
  fetchInquiries,
  syncInquiries,
  type CubekraftsConfig,
} from '../src/cubekrafts/inquiries.ts';
import { suppress } from '../src/email/messages.ts';
import { classify } from '../src/tools/effects.ts';
import { toolsFor } from '../src/tools/registry.ts';
import { DEFAULT_POLICY } from '../src/domain/types.ts';

/**
 * Reading enquiries out of Cubekrafts.
 *
 * Cubekrafts is a Lovable project, so this is PostgREST over the Supabase
 * behind it. The fetch is injected: what is worth testing is the request we
 * build, the mapping we apply, and what happens to a row that is junk — not
 * whether `fetch` works.
 */

let pg: PGlite;

const config: CubekraftsConfig = {
  url: 'https://abcdef.supabase.co',
  key: 'anon-key',
  table: 'inquiries',
  columns: { id: 'id', email: 'email', name: 'name', message: 'message', createdAt: 'created_at' },
  extra: [],
};

/** What a quoting tool's row actually looks like: the answer is in the fields. */
const quoteConfig: CubekraftsConfig = {
  ...config,
  table: 'quote_requests',
  extra: ['product', 'width_ft', 'needs_delivery', 'options'],
};

/** Captures the request and returns whatever the test wants back. */
function fakeFetch(rows: unknown, opts: { status?: number; body?: string } = {}) {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const body = opts.body ?? JSON.stringify(rows);
    return new Response(body, { status: opts.status ?? 200 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const oneRow = [
  { id: 7, email: 'Ravi@Example.com', name: 'Ravi', message: 'Need a site office', created_at: '2026-08-01T09:00:00Z' },
];

beforeAll(async () => {
  pg = new PGlite();
  await migrate(pg, defaultMigrationsDir());
}, 120_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`
    DELETE FROM email_message; DELETE FROM email_suppression; DELETE FROM lead;
  `);
});

// ── the request ─────────────────────────────────────────────────────────────

describe('the request it builds', () => {
  it('asks only for the columns it was told about', async () => {
    const { fetcher, calls } = fakeFetch(oneRow);
    await fetchInquiries(config, { fetcher });
    expect(calls[0]!.url.searchParams.get('select')).toBe('id,email,name,message,created_at');
  });

  it('always sends a limit, so a big table costs nothing extra', async () => {
    const { fetcher, calls } = fakeFetch([]);
    await fetchInquiries(config, { fetcher });
    expect(calls[0]!.url.searchParams.get('limit')).toBe('25');

    const second = fakeFetch([]);
    await fetchInquiries(config, { fetcher: second.fetcher, limit: 5 });
    expect(second.calls[0]!.url.searchParams.get('limit')).toBe('5');
  });

  it('asks for the newest first', async () => {
    const { fetcher, calls } = fakeFetch([]);
    await fetchInquiries(config, { fetcher });
    expect(calls[0]!.url.searchParams.get('order')).toBe('created_at.desc');
  });

  it('sends the key both ways PostgREST wants it', async () => {
    const { fetcher, calls } = fakeFetch([]);
    await fetchInquiries(config, { fetcher });
    expect(calls[0]!.headers['apikey']).toBe('anon-key');
    expect(calls[0]!.headers['authorization']).toBe('Bearer anon-key');
  });

  it('hits the right table on the right host', async () => {
    const { fetcher, calls } = fakeFetch([]);
    await fetchInquiries(config, { fetcher });
    expect(calls[0]!.url.origin).toBe('https://abcdef.supabase.co');
    expect(calls[0]!.url.pathname).toBe('/rest/v1/inquiries');
  });

  it('works against a form whose columns are named differently', async () => {
    // Every contact form is shaped differently. Hard-coding `email` here
    // would mean a code change the first time the site's form gains a field.
    const renamed: CubekraftsConfig = {
      ...config,
      table: 'contact_submissions',
      columns: { id: 'uuid', email: 'from_email', name: 'full_name', createdAt: 'submitted_at' },
      extra: [],
    };
    const { fetcher, calls } = fakeFetch([
      { uuid: 'abc', from_email: 'a@b.com', full_name: 'A B', submitted_at: '2026-08-01' },
    ]);
    const inquiries = await fetchInquiries(renamed, { fetcher });

    expect(calls[0]!.url.searchParams.get('select')).toBe('uuid,from_email,full_name,submitted_at');
    expect(inquiries[0]).toEqual({
      externalId: 'abc',
      email: 'a@b.com',
      name: 'A B',
      message: null,
      at: '2026-08-01',
      detail: [],
    });
  });
});

// ── what comes back ─────────────────────────────────────────────────────────

describe('what it makes of the answer', () => {
  it('maps a row into an enquiry', async () => {
    const { fetcher } = fakeFetch(oneRow);
    expect(await fetchInquiries(config, { fetcher })).toEqual([
      {
        externalId: '7',
        email: 'Ravi@Example.com',
        name: 'Ravi',
        message: 'Need a site office',
        at: '2026-08-01T09:00:00Z',
        detail: [],
      },
    ]);
  });

  it('explains a refused read rather than swallowing it', async () => {
    // A 401 here usually means the key is right and the row level security
    // policy is wrong, which is a different fix — so the body is in the message.
    const { fetcher } = fakeFetch(null, { status: 401, body: '{"message":"permission denied"}' });
    await expect(fetchInquiries(config, { fetcher })).rejects.toThrow(/401.*permission denied/);
  });

  it('says so when the answer is not JSON', async () => {
    const { fetcher } = fakeFetch(null, { body: '<html>nope</html>' });
    await expect(fetchInquiries(config, { fetcher })).rejects.toThrow(CubekraftsError);
  });

  it('reports a network failure as a Cubekrafts problem, not a crash', async () => {
    const exploding = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as typeof fetch;
    await expect(fetchInquiries(config, { fetcher: exploding })).rejects.toThrow(
      /could not reach Cubekrafts/,
    );
  });
});

// ── a quote request, which is what this actually reads ──────────────────────

describe('a quoting tool row', () => {
  const row = [
    {
      id: 9,
      email: 'ravi@example.com',
      name: 'Ravi',
      message: null,
      created_at: '2026-08-01T09:00:00Z',
      product: 'Site office',
      width_ft: 20,
      needs_delivery: true,
      options: ['insulation', 'AC'],
    },
  ];

  it('asks for the extra columns too', async () => {
    const { fetcher, calls } = fakeFetch(row);
    await fetchInquiries(quoteConfig, { fetcher });
    expect(calls[0]!.url.searchParams.get('select')).toBe(
      'id,email,name,message,created_at,product,width_ft,needs_delivery,options',
    );
  });

  it('carries the fields the request actually consists of', async () => {
    // Without this, Sales gets an address and a null message — everything the
    // customer actually asked for having been dropped on the floor.
    const { fetcher } = fakeFetch(row);
    const [inquiry] = await fetchInquiries(quoteConfig, { fetcher });
    expect(inquiry!.detail).toEqual([
      ['product', 'Site office'],
      ['width_ft', '20'],
      ['needs_delivery', 'true'],
      ['options', 'insulation, AC'],
    ]);
  });

  it('drops an extra column that is empty rather than showing a blank', async () => {
    const { fetcher } = fakeFetch([{ ...row[0], product: null, options: [] }]);
    const [inquiry] = await fetchInquiries(quoteConfig, { fetcher });
    expect(inquiry!.detail.map(([k]) => k)).toEqual(['width_ft', 'needs_delivery']);
  });

  it('does not ask for the same column twice', async () => {
    const overlapping: CubekraftsConfig = { ...config, extra: ['message', 'product'] };
    const { fetcher, calls } = fakeFetch(row);
    await fetchInquiries(overlapping, { fetcher });
    const select = calls[0]!.url.searchParams.get('select')!.split(',');
    expect(new Set(select).size).toBe(select.length);
  });
});

// ── the secret-gated endpoint, which is what production uses ────────────────

describe('reading through the edge function', () => {
  const viaEndpoint: CubekraftsConfig = {
    ...config,
    endpoint: 'https://iugvjigrpknhnogzjcec.supabase.co/functions/v1/foreman-unrouted',
    key: 'shared-secret',
  };

  it('calls the endpoint verbatim rather than building a PostgREST path', async () => {
    const { fetcher, calls } = fakeFetch([]);
    await fetchInquiries(viaEndpoint, { fetcher });
    expect(calls[0]!.url.pathname).toBe('/functions/v1/foreman-unrouted');
    expect(calls[0]!.url.pathname).not.toContain('rest/v1');
  });

  it('sends only the bearer secret, never an apikey header', async () => {
    // The endpoint holds the credentials; a stray key header would be noise
    // at best and a leaked anon key at worst.
    const { fetcher, calls } = fakeFetch([]);
    await fetchInquiries(viaEndpoint, { fetcher });
    expect(calls[0]!.headers['authorization']).toBe('Bearer shared-secret');
    expect(calls[0]!.headers['apikey']).toBeUndefined();
  });

  it('leaves the column list and ordering to the endpoint', async () => {
    // It is the thing holding the service role key, so what it selects and in
    // what order is its business, not ours to ask for.
    const { fetcher, calls } = fakeFetch([]);
    await fetchInquiries(viaEndpoint, { fetcher, limit: 50 });
    expect(calls[0]!.url.searchParams.get('select')).toBeNull();
    expect(calls[0]!.url.searchParams.get('order')).toBeNull();
    expect(calls[0]!.url.searchParams.get('limit')).toBe('50');
  });

  it('maps the rows exactly as it would from PostgREST', async () => {
    const real: CubekraftsConfig = {
      ...viaEndpoint,
      columns: { id: 'id', email: 'email', name: 'customer_name', message: 'note', createdAt: 'created_at' },
      extra: ['city', 'category', 'budget_range', 'timeline', 'phone'],
    };
    const { fetcher } = fakeFetch([
      {
        id: 'f1e2', customer_name: 'Ravi', email: 'ravi@example.com', phone: '9876543210',
        city: 'bangalore', category: 'Modular Kitchen', budget_range: '3-5L',
        timeline: 'Within 1 month', note: null, created_at: '2026-08-02T10:00:00Z',
      },
    ]);
    const [inquiry] = await fetchInquiries(real, { fetcher });
    expect(inquiry).toMatchObject({ externalId: 'f1e2', email: 'ravi@example.com', name: 'Ravi', message: null });
    expect(inquiry!.detail).toEqual([
      ['city', 'bangalore'],
      ['category', 'Modular Kitchen'],
      ['budget_range', '3-5L'],
      ['timeline', 'Within 1 month'],
      ['phone', '9876543210'],
    ]);
  });

  it('surfaces the endpoint refusing a bad secret', async () => {
    const { fetcher } = fakeFetch(null, { status: 401, body: '{"error":"unauthorized"}' });
    await expect(fetchInquiries(viaEndpoint, { fetcher })).rejects.toThrow(/401.*unauthorized/);
  });
});

// ── turning them into leads ─────────────────────────────────────────────────

describe('syncing', () => {
  it('makes each enquiry a lead Sales can draft to', async () => {
    const { fetcher } = fakeFetch(oneRow);
    expect(await syncInquiries(pg, config, { fetcher })).toEqual({
      seen: 1,
      newLeads: 1,
      skipped: 0,
    });
    const { rows } = await pg.query<{ email: string; source: string; consent: string }>(
      `SELECT email, source, consent FROM lead`,
    );
    expect(rows[0]).toMatchObject({ source: 'cubekrafts', consent: 'enquiry' });
  });

  it('does not create two of anybody when run twice', async () => {
    await syncInquiries(pg, config, { fetcher: fakeFetch(oneRow).fetcher });
    expect(await syncInquiries(pg, config, { fetcher: fakeFetch(oneRow).fetcher })).toMatchObject({
      seen: 1,
      newLeads: 0,
    });
    const { rows } = await pg.query(`SELECT id FROM lead`);
    expect(rows).toHaveLength(1);
  });

  it('skips a junk address instead of losing the whole batch', async () => {
    // One malformed submission must not stop the other twenty-four being
    // answered.
    const { fetcher } = fakeFetch([
      { id: 1, email: 'not-an-address', name: 'Broken' },
      { id: 2, email: 'good@example.com', name: 'Fine' },
    ]);
    expect(await syncInquiries(pg, config, { fetcher })).toEqual({
      seen: 2,
      newLeads: 1,
      skipped: 1,
    });
  });

  it('leaves a suppressed person suppressed', async () => {
    // Someone who unsubscribed and then filled the form in again is still
    // somebody the sender will refuse, and re-syncing must not undo that.
    await suppress(pg, 'ravi@example.com', 'unsubscribe');
    await syncInquiries(pg, config, { fetcher: fakeFetch(oneRow).fetcher });
    const { rows } = await pg.query<{ unsubscribed_at: Date | null }>(
      `SELECT unsubscribed_at FROM lead WHERE lower(email) = 'ravi@example.com'`,
    );
    expect(rows[0]?.unsubscribed_at ?? null).not.toBeNull();
  });
});

// ── configuration ───────────────────────────────────────────────────────────

describe('configuration', () => {
  it('is absent until both the url and the key are set', () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ CUBEKRAFTS_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
    expect(configFromEnv({ CUBEKRAFTS_SUPABASE_KEY: 'k' })).toBeNull();
  });

  it('tolerates a trailing slash on the url, which is how it gets pasted', () => {
    const c = configFromEnv({
      CUBEKRAFTS_SUPABASE_URL: 'https://x.supabase.co/',
      CUBEKRAFTS_SUPABASE_KEY: 'k',
    });
    expect(c!.url).toBe('https://x.supabase.co');
  });

  it('prefers the endpoint and its secret when both are configured', () => {
    const c = configFromEnv({
      CUBEKRAFTS_ENDPOINT: 'https://x.supabase.co/functions/v1/foreman-unrouted',
      CUBEKRAFTS_SECRET: 's3cret',
    });
    expect(c).toMatchObject({
      endpoint: 'https://x.supabase.co/functions/v1/foreman-unrouted',
      key: 's3cret',
    });
  });

  it('needs a secret even with an endpoint', () => {
    expect(configFromEnv({ CUBEKRAFTS_ENDPOINT: 'https://x/functions/v1/f' })).toBeNull();
  });

  it('reads the extra columns as a list, tolerating spaces', () => {
    const c = configFromEnv({
      CUBEKRAFTS_SUPABASE_URL: 'https://x.supabase.co',
      CUBEKRAFTS_SUPABASE_KEY: 'k',
      CUBEKRAFTS_COL_EXTRA: 'product, width_ft ,budget',
    });
    expect(c!.extra).toEqual(['product', 'width_ft', 'budget']);
  });

  it('has no extras until it is given some', () => {
    const c = configFromEnv({
      CUBEKRAFTS_SUPABASE_URL: 'https://x.supabase.co',
      CUBEKRAFTS_SUPABASE_KEY: 'k',
    });
    expect(c!.extra).toEqual([]);
  });

  it('defaults the table and lets it be overridden', () => {
    const base = { CUBEKRAFTS_SUPABASE_URL: 'https://x.supabase.co', CUBEKRAFTS_SUPABASE_KEY: 'k' };
    expect(configFromEnv(base)!.table).toBe('inquiries');
    expect(configFromEnv({ ...base, CUBEKRAFTS_INQUIRY_TABLE: 'contacts' })!.table).toBe('contacts');
    expect(configFromEnv({ ...base, CUBEKRAFTS_COL_EMAIL: 'from_email' })!.columns.email).toBe(
      'from_email',
    );
  });
});

// ── permissions ─────────────────────────────────────────────────────────────

describe('who can read enquiries', () => {
  it('is granted to the roles that need them and nobody else', () => {
    for (const role of ['sales', 'coo', 'concierge', 'marketing'] as const) {
      expect({ role, has: toolsFor(role).some((t) => t.name === 'cubekrafts.inquiries') }).toEqual({
        role,
        has: true,
      });
    }
    for (const role of ['content', 'developer', 'finance'] as const) {
      expect({ role, has: toolsFor(role).some((t) => t.name === 'cubekrafts.inquiries') }).toEqual({
        role,
        has: false,
      });
    }
  });

  it('is safe, because no argument can point it at another host', () => {
    const verdict = classify(
      'sales',
      { id: 't', name: 'cubekrafts.inquiries', args: { limit: 10 } },
      DEFAULT_POLICY,
    );
    expect(verdict.effect).toBe('safe');
  });

  it('refuses a limit that is not a sane number', () => {
    for (const limit of [0, -1, 500, 'all']) {
      const verdict = classify(
        'sales',
        { id: 't', name: 'cubekrafts.inquiries', args: { limit } },
        DEFAULT_POLICY,
      );
      expect({ limit, effect: verdict.effect }).toEqual({ limit, effect: 'forbidden' });
    }
  });

  it('is refused to a role that was never granted it', () => {
    expect(
      classify('developer', { id: 't', name: 'cubekrafts.inquiries', args: {} }, DEFAULT_POLICY)
        .effect,
    ).toBe('forbidden');
  });
});
