import { Pool } from 'pg';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Sql } from '../db/sql.ts';
import { migrate } from '../db/migrate.ts';
import { setSetting, getSetting } from '../db/repo.ts';
import { modelFor, type Provider } from '../claude/catalog.ts';
import { SwitchingModel } from '../claude/runtime.ts';
import { builtinEngineAvailable } from '../claude/provider.ts';
import { PRESETS } from '../claude/presets.ts';
import { DEFAULT_POLICY, type PolicyConfig } from '../domain/types.ts';
import { stableSystemFor } from '../agents/charters.ts';
import { EventBus } from './events.ts';
import { createApp } from './app.ts';
import { startScheduler, SETTINGS, type TickDeps } from '../scheduler/tick.ts';
import { makeSinks } from '../tools/sinks.ts';
import { configFromEnv, sweepChallenges } from '../auth/passkey.ts';
import { sweep as sweepRateCounters } from '../auth/ratelimit.ts';
import { ask } from '../concierge/ask.ts';
import { transportFromEnv } from '../email/transport.ts';
import { checkDomain, domainOf, summarise } from '../email/deliverability.ts';
import { Workspace } from '../tools/workspace.ts';
import { standupIfDue } from '../scheduler/standup.ts';
import { configFromEnv as cubekraftsFromEnv } from '../cubekrafts/inquiries.ts';
import { applyConnections } from './connections.ts';
import { redact } from '../tools/workspace.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The entrypoint.
 *
 * Migrate, seed, wire, listen, tick.
 *
 * The bind address defaults to loopback and only opens up when `FOREMAN_HOST`
 * says so, which is what the deployed container sets. Authentication is on
 * either way: there is no flag that turns the gate off, because a flag like
 * that is eventually left on by accident.
 */

const PORT = Number(process.env['PORT'] ?? 7777);
const HOST = process.env['FOREMAN_HOST'] ?? '127.0.0.1';
const HOME = process.env['FOREMAN_HOME'] ?? join(homedir(), '.foreman');
/** True when something else terminates TLS and forwards the caller's address. */
const TRUST_PROXY = process.env['FOREMAN_TRUST_PROXY'] === 'true';

/** The two hostnames browsers treat as a secure context without TLS. */
const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1';

/** What the boot log says about where thinking happens. */
function providerLine(provider: Provider, model: string): string {
  if (provider === 'anthropic') return `model: Anthropic (${model})`;
  if (provider === 'builtin') {
    return builtinEngineAvailable()
      ? `model: ${model}, running inside Foreman — no account, no key, nothing sent anywhere`
      : 'model: none yet — paste an Anthropic key under ⋯ → Model and it starts working';
  }
  const named = process.env['FOREMAN_PROVIDER']?.trim().toLowerCase();
  const free = named ? PRESETS[named]?.needsKey : undefined;
  if (named && free === true) return `model: ${model} on ${named}'s free tier`;
  return `model: ${model} on this machine — nothing sent anywhere, and it costs nothing`;
}

/** Who is on the payroll, and on which model. */
const STAFF = [
  { id: 'coo', tier: 'top', effort: 'high' },
  { id: 'content', tier: 'mid', effort: 'high' },
  { id: 'sales', tier: 'mid', effort: 'high' },
  { id: 'developer', tier: 'top', effort: 'high' },
  { id: 'marketing', tier: 'mid', effort: 'high' },
  // Cheapest tier: this is arithmetic over rows the database already has,
  // and it runs often enough that the difference shows up on the bill.
  { id: 'finance', tier: 'cheap', effort: 'medium' },
] as const;

/**
 * Make sure there is a repository for the developer to work in.
 *
 * A hosted Foreman usually has no permanent disk, so the checkout is empty on
 * every boot and nothing ever put a repository there. Cloning here is what
 * makes the developer role work on the machines this app is actually deployed
 * to, rather than only on a laptop where somebody cloned it by hand once.
 *
 * Never throws: a bad token or a missing repository is a capability that stays
 * switched off, not a reason for the whole company to refuse to start. The
 * token is kept out of the returned line, because that line gets printed.
 */
async function ensureCheckout(workspace: Workspace, dir: string): Promise<string> {
  const branch = await workspace.currentBranch();
  if (branch !== undefined) return `${dir} on ${branch}`;

  const repo = process.env['GITHUB_REPO'];
  const token = process.env['GITHUB_TOKEN'];
  if (!repo || !token) {
    return `none at ${dir} — connect the repository under \u22ef \u2192 Connections and the developer starts working`;
  }

  try {
    await mkdir(dir, { recursive: true });
    // Shallow: the developer reads and branches, and a full history of a site
    // repository is minutes of boot time bought for nothing.
    await run('git', ['clone', '--depth', '50', `https://x-access-token:${token}@github.com/${repo}.git`, dir], {
      env: { PATH: process.env['PATH'] ?? '' },
    });
    const cloned = await workspace.currentBranch();
    return `${dir} on ${cloned ?? 'unknown'} — cloned ${repo}`;
  } catch (err) {
    const detail = redact(err instanceof Error ? err.message : String(err), token);
    return `could not clone ${repo}: ${detail.slice(0, 160)}`;
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const sql = pool as unknown as Sql;

  const applied = await migrate(sql);
  if (applied.length > 0) console.log(`applied ${applied.length} migration(s): ${applied.join(', ')}`);

  // Before anything reads the environment. Connections typed into the app are
  // stored in the database, and everything downstream keeps reading
  // `process.env` without knowing where the value came from.
  await applyConnections(sql);

  const roles: TickDeps['roles'] = {};
  const allowedRoots: PolicyConfig['allowedRoots'] = {};
  for (const member of STAFF) {
    await sql.query(
      `INSERT INTO role (id, name, model, effort, enabled) VALUES ($1, $1, $2, $3, TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [member.id, modelFor(member.tier).model, member.effort],
    );
    const dir =
      member.id === 'developer'
        ? (process.env['FOREMAN_CHECKOUT'] ?? join(HOME, 'checkout'))
        : join(HOME, 'workspace', member.id);
    await mkdir(dir, { recursive: true });
    allowedRoots[member.id] = [dir];
    roles[member.id] = {
      name: member.id,
      tier: member.tier,
      effort: member.effort,
      stableSystem: stableSystemFor(member.id),
    };
  }

  if ((await getSetting<number | null>(sql, SETTINGS.dailyCapUsd, null)) === null) {
    await setSetting(sql, SETTINGS.dailyCapUsd, 5);
  }

  // The model is swappable while running: a key pasted under ⋯ → Model is
  // saved in the database, wins over the environment, and survives restarts.
  // It is adopted here, before anything that might print or use a model.
  //
  // The boot check makes the real request rather than counting variables:
  // "present" was technically true of an invalid key and told you nothing, so
  // the first thing you learned was a 401 in the middle of a conversation. It
  // never blocks startup and never prints the key.
  const claude = new SwitchingModel();
  await claude.adoptStoredKey(sql);
  console.log(providerLine(claude.provider(), modelFor('top').model));
  void claude.check().then((line) => console.log(`  ${line}`));

  const policy: PolicyConfig = {
    ...DEFAULT_POLICY,
    allowedRoots,
    allowedHosts: ['cubekrafts.com', '.cubekrafts.com'],
  };

  // The checkout the developer works in. On a host with no permanent disk it
  // is empty on every boot, so it is cloned rather than assumed — otherwise
  // the developer is permanently unable to work on exactly the machines this
  // app is meant to run on.
  const checkout = process.env['FOREMAN_CHECKOUT'] ?? join(HOME, 'checkout');

  const bus = new EventBus();

  /**
   * Everything downstream of a connection setting, built here so that saving
   * one can rebuild it without a restart.
   *
   * `sinks` is reassigned rather than mutated in place, and every consumer
   * reads `tickDeps.sinks` at call time, so a new transport or a new
   * Cubekrafts endpoint is in force on the very next tool call.
   */
  const wire = async (): Promise<void> => {
    const transport = transportFromEnv();
    console.log(
      `email transport: ${transport.name}${transport.name === 'recording' ? ' (nothing will actually be sent)' : ''}`,
    );

    // Checked rather than discovered from customers who never replied. A
    // report, never a gate: DNS is somebody else's infrastructure, and a
    // lookup timing out is not a reason to refuse to start.
    const from = process.env['EMAIL_FROM'];
    const sendingDomain = from ? domainOf(from) : null;
    if (sendingDomain) {
      void checkDomain(sendingDomain, {
        ...(process.env['EMAIL_SPF_INCLUDE']
          ? { expectedInclude: process.env['EMAIL_SPF_INCLUDE'] }
          : {}),
      })
        .then((report) => console.log(summarise(report)))
        .catch((err: unknown) => console.error('could not check the sending domain', err));
    }

    const cubekrafts = cubekraftsFromEnv();
    console.log(
      cubekrafts
        ? `cubekrafts: connected to ${new URL(cubekrafts.url).hostname}`
        : 'cubekrafts: not connected — sales has nothing to reply to',
    );
    tickDeps.sinks = makeSinks(sql, HOME, transport, cubekrafts ?? undefined);

    // Rebuilt too: the token and repository are read when the Workspace is
    // constructed, so a repository connected after boot would otherwise be
    // invisible until a restart.
    tickDeps.workspace = new Workspace({
      dir: checkout,
      baseBranch: process.env['FOREMAN_BASE_BRANCH'] ?? 'main',
      ...(process.env['GITHUB_TOKEN'] ? { token: process.env['GITHUB_TOKEN'] } : {}),
      ...(process.env['GITHUB_REPO'] ? { repo: process.env['GITHUB_REPO'] } : {}),
    });
    console.log(`checkout: ${await ensureCheckout(tickDeps.workspace, checkout)}`);
  };

  const tickDeps: TickDeps = {
    sql,
    claude,
    policy,
    sinks: makeSinks(sql, HOME),
    roles,
  };
  await wire();

  const webauthn = configFromEnv();
  console.log(`origin: ${webauthn.origin} (relying party ${webauthn.rpID})`);

  // Reachable from off-box, but the origin says plain http — so the session
  // cookie cannot carry `Secure` and WebAuthn will refuse the ceremony
  // outright. Almost always a forgotten FOREMAN_ORIGIN after a deploy, and
  // silently serving a sign-in that cannot work is the worst way to find out.
  if (HOST !== '127.0.0.1' && !webauthn.origin.startsWith('https:') && !isLocal(webauthn.rpID)) {
    console.error(
      `refusing to start: bound to ${HOST} but FOREMAN_ORIGIN is ${webauthn.origin}.\n` +
        'Passkeys require https on anything that is not localhost, and the session\n' +
        'cookie would go out without Secure. Set FOREMAN_ORIGIN to the https address.',
    );
    process.exit(1);
  }

  const app = createApp({
    sql,
    bus,
    tickDeps,
    webauthn,
    security: {
      origin: webauthn.origin,
      https: webauthn.origin.startsWith('https:'),
      trustProxy: TRUST_PROXY,
    },
    // Read from tickDeps rather than captured, so a connection saved after
    // boot is in force on the very next call rather than the next restart.
    ask: (text, snapshot) => ask(text, snapshot, { sql, claude, policy, sinks: tickDeps.sinks! }),
    model: claude,
    onConnectionsChanged: wire,
    ...(process.env['EMAIL_WEBHOOK_SECRET']
      ? { webhookSecret: process.env['EMAIL_WEBHOOK_SECRET'] }
      : {}),
    decideDeps: {
      context: ({ runId: _runId, role }) => ({
        claude,
        model: modelFor(tickDeps.roles[role]!.tier),
        effort: tickDeps.roles[role]!.effort,
        policy,
        facts: {},
        readFacts: () => tickDeps.workspace!.facts(),
        workspace: tickDeps.workspace!,
        autonomy: () => 'approve',
        sinks: tickDeps.sinks!,
        stableSystem: tickDeps.roles[role]!.stableSystem,
      }),
    },
  });

  // The standup is checked on every tick and written once a day, so it is
  // waiting when you wake up rather than generated when you ask.
  const announceStandup = async () => {
    const standup = await standupIfDue(sql);
    if (standup) bus.publish({ type: 'standup', speech: standup.speech, needsYou: standup.needsYou });
  };

  const scheduler = startScheduler(tickDeps, {
    intervalMs: Number(process.env['TICK_MS'] ?? 10 * 60 * 1000),
    onResult: (r) => {
      bus.publish(
        r.ran
          ? { type: 'tick', ran: true, kind: r.kind, taskId: r.taskId }
          : { type: 'tick', ran: false, why: r.why },
      );
      void announceStandup().catch((err: unknown) => console.error('standup failed', err));
    },
  });

  // Expired challenges and spent rate-limit windows are dead weight rather
  // than a correctness problem, so they go on a slow timer rather than in the
  // request path.
  const janitor = setInterval(
    () => {
      void Promise.all([sweepChallenges(sql), sweepRateCounters(sql)]).catch((err: unknown) =>
        console.error('sweep failed', err),
      );
    },
    60 * 60 * 1000,
  );
  janitor.unref?.();

  app.listen(PORT, HOST, () => {
    console.log(`foreman listening on http://${HOST}:${PORT}`);
    console.log(`staff: ${STAFF.map((m) => m.id).join(', ')}`);
  });

  const shutdown = async () => {
    console.log('shutting down');
    clearInterval(janitor);
    scheduler.stop();
    bus.closeAll();
    app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
