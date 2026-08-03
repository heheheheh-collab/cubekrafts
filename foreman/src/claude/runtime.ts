import type { Sql } from '../db/sql.ts';
import { getSetting, setSetting } from '../db/repo.ts';
import { checkProvider, modelClientFromEnv, type ModelClient } from './provider.ts';
import { modelFor, providerFromEnv, type Provider } from './catalog.ts';
import type { Turn, TurnResult } from './client.ts';

/**
 * The model, changeable while the app is running.
 *
 * The key used to be an environment variable and nothing else, which meant
 * that on a deployed machine changing it was a redeploy. Now it is a setting:
 * paste it into the app, the app checks it against the real API, and every
 * agent from the next turn onward uses it. Remove it and the app falls back
 * to whatever the environment said.
 *
 * One instance of this is threaded everywhere a client goes, so a swap is one
 * assignment here rather than a hunt for every place that captured the old
 * client. Everything downstream sees `Pick<Claude, 'turn'>` and never learns
 * the provider changed.
 *
 * The stored key wins over the environment. Both being set is a person having
 * deliberately pasted a key into a running app that already had one, and the
 * more recent, more deliberate act is the one to honour.
 *
 * The key itself never leaves this module except inside `process.env`, which
 * is how every env-reading decision (provider, catalog, prices, the SDK)
 * stays consistent without each of them learning about settings. It is never
 * logged, never returned by `status()`, and the export filters it out.
 */

export const KEY_SETTING = 'model.anthropicKey';

/** Settings the export must never include. Checked by test/provider.test.ts. */
export const SECRET_SETTINGS: readonly string[] = [KEY_SETTING];

export interface ModelStatus {
  provider: Provider;
  model: string;
  /** Where the key in force came from. Null when no key is set anywhere. */
  keySource: 'settings' | 'environment' | null;
  /** Enough to recognise it, never enough to use it. */
  keyHint: string | null;
  lastCheck: string;
}

const shapeOk = (key: string): boolean => key.startsWith('sk-ant-') && key.length >= 40;

type Checker = (env: NodeJS.ProcessEnv, client: ModelClient) => Promise<string>;

export class SwitchingModel implements ModelClient {
  private inner: ModelClient;
  private keyFromSettings = false;
  private lastCheck = 'not checked yet';
  /** Whatever the process was started with, kept for falling back to. */
  private readonly envKey: string | undefined;
  /** The real request against the real API — injectable so tests stay offline. */
  private readonly checker: Checker;

  constructor(opts: { checker?: Checker } = {}) {
    this.envKey = process.env['ANTHROPIC_API_KEY'];
    this.inner = modelClientFromEnv();
    this.checker = opts.checker ?? checkProvider;
  }

  turn(t: Turn): Promise<TurnResult> {
    return this.inner.turn(t);
  }

  /** Boot: put a previously saved key back in force. Never throws. */
  async adoptStoredKey(sql: Sql): Promise<void> {
    const stored = await getSetting<string | null>(sql, KEY_SETTING, null);
    if (typeof stored === 'string' && shapeOk(stored)) this.apply(stored);
  }

  /**
   * Save (or clear, with null) the key, switch over, and prove it works.
   * Returns the new status, whose `lastCheck` is the API's own verdict.
   */
  async setKey(sql: Sql, key: string | null): Promise<ModelStatus> {
    if (key !== null && !shapeOk(key)) {
      throw new Error("that does not look like an Anthropic key — they start with 'sk-ant-'");
    }
    await setSetting(sql, KEY_SETTING, key);
    if (key !== null) {
      this.apply(key);
    } else {
      // Fall back to what the process was started with, which may be nothing.
      this.keyFromSettings = false;
      if (this.envKey !== undefined) process.env['ANTHROPIC_API_KEY'] = this.envKey;
      else delete process.env['ANTHROPIC_API_KEY'];
      this.inner = modelClientFromEnv();
    }
    await this.check();
    return this.status();
  }

  /** The real request, against the provider now in force. Caches the verdict. */
  async check(): Promise<string> {
    this.lastCheck = await this.checker(process.env, this.inner);
    return this.lastCheck;
  }

  status(): ModelStatus {
    const key = process.env['ANTHROPIC_API_KEY'];
    return {
      provider: this.provider(),
      model: modelFor('top').model,
      keySource: key === undefined ? null : this.keyFromSettings ? 'settings' : 'environment',
      keyHint: key === undefined ? null : `sk-ant-…${key.slice(-4)}`,
      lastCheck: this.lastCheck,
    };
  }

  provider(): Provider {
    return providerFromEnv();
  }

  private apply(key: string): void {
    process.env['ANTHROPIC_API_KEY'] = key;
    this.keyFromSettings = true;
    this.inner = modelClientFromEnv();
  }
}
