import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RuntimeFacts } from '../domain/types.ts';
import { ToolError } from './execute.ts';

const run = promisify(execFile);

/**
 * A git checkout the developer works in.
 *
 * Every command goes through `execFile` with an argv array — no shell, ever,
 * so there is no quoting to get wrong and no metacharacter to smuggle. The
 * classifier refuses argv containing them anyway; this is the second layer.
 *
 * Nothing here decides whether a command is allowed. That is `effects.ts`.
 * This file only knows how to run things and how to read the branch back,
 * and the branch it reads is the one the classifier is given — which is why
 * it must come from here rather than from the model.
 */

export interface WorkspaceOptions {
  /** Absolute path to the checkout. */
  dir: string;
  /** Seconds before a command is killed. Tests and builds are the slow ones. */
  timeoutSeconds?: number;
  /** Bytes of combined output kept. Beyond this the model gains nothing. */
  maxOutputBytes?: number;
  /** Passed to `git push`; absent means pushing is not configured. */
  token?: string;
  /** `owner/repo`, for opening the pull request. */
  repo?: string;
  /** What pull requests are opened against. */
  baseBranch?: string;
}

export interface CommandResult {
  ok: boolean;
  output: string;
}

export class Workspace {
  constructor(private readonly opts: WorkspaceOptions) {}

  get dir(): string {
    return this.opts.dir;
  }

  get baseBranch(): string {
    return this.opts.baseBranch ?? 'main';
  }

  /**
   * Run a command in the checkout.
   *
   * A non-zero exit is a result, not an exception: a failing test suite is
   * information the agent needs, and throwing would abort the run over
   * exactly the situation it exists to fix.
   */
  async exec(argv: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<CommandResult> {
    const [command, ...args] = argv;
    if (!command) throw new ToolError('no command given');

    try {
      const { stdout, stderr } = await run(command, args, {
        cwd: this.opts.dir,
        timeout: (this.opts.timeoutSeconds ?? 300) * 1000,
        maxBuffer: this.opts.maxOutputBytes ?? 4_000_000,
        // A deliberately minimal environment. The API key, the database URL
        // and the GitHub token are not in it, so a command that decides to
        // print its environment prints nothing worth having.
        env: {
          PATH: process.env['PATH'] ?? '/usr/bin:/bin',
          HOME: this.opts.dir,
          LANG: 'C.UTF-8',
          CI: 'true',
          ...env,
        },
      });
      return { ok: true, output: [stdout, stderr].filter(Boolean).join('\n').trim() };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
      if (e.killed) {
        return { ok: false, output: `timed out after ${this.opts.timeoutSeconds ?? 300}s` };
      }
      return {
        ok: false,
        output: [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim(),
      };
    }
  }

  private async git(...args: string[]): Promise<CommandResult> {
    return this.exec(['git', ...args]);
  }

  /**
   * The branch actually checked out, read from git.
   *
   * This is the value the classifier compares against the protected list, so
   * it must never come from anywhere else. If it cannot be read, the caller
   * gets `undefined` and the classifier refuses — which is the right answer,
   * because a push whose target nobody can name is not one to allow.
   */
  async currentBranch(): Promise<string | undefined> {
    const result = await this.git('rev-parse', '--abbrev-ref', 'HEAD');
    if (!result.ok) return undefined;
    const branch = result.output.trim();
    return branch && branch !== 'HEAD' ? branch : undefined;
  }

  async facts(): Promise<RuntimeFacts> {
    const branch = await this.currentBranch();
    return branch === undefined ? {} : { currentBranch: branch };
  }

  /**
   * The base branch as the remote has it, if the remote can be reached.
   *
   * Cubekrafts is a Lovable project, so `main` moves without us: every prompt
   * in that editor is a commit somebody else pushed. A branch cut from a
   * local base that was last updated on Tuesday produces a pull request that
   * conflicts with work already merged, which is a slow and confusing way to
   * waste a review.
   *
   * Best effort on purpose. No remote, no token, no network — the branch is
   * still cut, from whatever is local, and the caller is told so rather than
   * the whole task failing over a fetch.
   */
  private async fetchBase(): Promise<{ ref: string; fresh: boolean; why?: string }> {
    const { token, repo } = this.opts;
    const remote = token && repo ? `https://x-access-token:${token}@github.com/${repo}.git` : 'origin';

    const fetched = await this.exec(['git', 'fetch', '--depth', '1', remote, this.baseBranch]);
    if (!fetched.ok) {
      return {
        ref: this.baseBranch,
        fresh: false,
        why: redact(fetched.output, token ?? '').slice(0, 200),
      };
    }
    return { ref: 'FETCH_HEAD', fresh: true };
  }

  async createBranch(name: string): Promise<string> {
    const base = await this.fetchBase();

    // Cut straight from the fetched ref rather than checking out the base and
    // resetting it. Same result, and it never touches the local base branch,
    // so nothing of anyone else's is discarded to get here.
    const made = await this.git('checkout', '-b', name, base.ref);
    if (!made.ok) {
      // Already exists: switch to it rather than failing. A resumed run
      // reaching for its own branch again is normal.
      const switched = await this.git('checkout', name);
      if (!switched.ok) throw new ToolError(`could not create ${name}: ${made.output}`);
      return `switched to the existing branch ${name}`;
    }

    return base.fresh
      ? `created and checked out ${name}, from ${this.baseBranch} as the remote has it now`
      : `created and checked out ${name}, from the local ${this.baseBranch} — could not reach the ` +
        `remote, so this may be behind (${base.why ?? 'no reason given'})`;
  }

  async commitAll(message: string): Promise<string> {
    const added = await this.git('add', '-A');
    if (!added.ok) throw new ToolError(`git add failed: ${added.output}`);

    const status = await this.git('status', '--porcelain');
    if (status.ok && status.output.trim() === '') return 'nothing to commit — no files changed';

    // Identity on the command rather than in a config file, so the checkout
    // carries no state about who Foreman is between runs.
    const committed = await this.exec([
      'git',
      '-c',
      'user.name=Foreman',
      '-c',
      'user.email=foreman@localhost',
      'commit',
      '-m',
      message,
    ]);
    if (!committed.ok) throw new ToolError(`git commit failed: ${committed.output}`);
    return committed.output;
  }

  async diff(): Promise<string> {
    const staged = await this.git('diff', 'HEAD');
    const untracked = await this.git('ls-files', '--others', '--exclude-standard');
    const parts = [staged.output];
    if (untracked.output.trim()) parts.push(`\nUntracked files:\n${untracked.output}`);
    const text = parts.join('\n').trim();
    return text || 'no changes in the working tree';
  }

  /**
   * Push the current branch and open a pull request.
   *
   * The token goes into the remote URL for the length of one command and is
   * never written to `.git/config`, so a later `git remote -v` — by an agent
   * or by a person reading the audit log — does not reveal it.
   */
  async pushAndOpenPr(input: { branch: string; title: string; body: string }): Promise<string> {
    const { token, repo } = this.opts;
    if (!token || !repo) {
      throw new ToolError(
        'pushing is not configured on this instance — no GitHub token or repository',
      );
    }

    const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
    const pushed = await this.exec(['git', 'push', remote, `HEAD:${input.branch}`, '--force-with-lease']);
    if (!pushed.ok) {
      // The token could appear in git's own error output.
      throw new ToolError(`push failed: ${redact(pushed.output, token)}`);
    }

    const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.branch,
        base: this.baseBranch,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const text = await response.text();
    if (!response.ok) {
      // An existing pull request for the branch is a 422, and the push has
      // already updated it, so the work is not lost and saying so is honest.
      if (response.status === 422 && text.includes('already exists')) {
        return `pushed ${input.branch}; a pull request for it was already open and now has the new commits`;
      }
      throw new ToolError(`pushed ${input.branch}, but opening the pull request failed: ${text.slice(0, 300)}`);
    }

    const pr = JSON.parse(text) as { html_url?: string; number?: number };
    return `pushed ${input.branch} and opened pull request #${pr.number}: ${pr.html_url}`;
  }
}

/** Never let a token reach a log, a transcript, or a model. */
export function redact(text: string, token: string): string {
  return token ? text.split(token).join('[redacted]') : text;
}
