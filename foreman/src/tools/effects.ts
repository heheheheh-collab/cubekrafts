import {
  type Autonomy,
  type Classification,
  type Disposition,
  type PolicyConfig,
  type RoleName,
  type ToolCall,
  NEVER_PROMOTABLE,
} from '../domain/types.ts';
import { getTool } from './registry.ts';
import { confine } from '../guards/jail.ts';

/**
 * The security boundary.
 *
 * Every tool call passes through `classify` before anything executes. The
 * result is a function of the role, the tool, *and* the arguments — committing
 * to a foreman/ branch is safe, committing to main is forbidden, and the tool
 * name alone cannot tell you which.
 *
 * Two rules this file exists to enforce:
 *   1. Default deny. An unrecognised tool, an ungranted tool, or an argument
 *      shape we do not understand is `forbidden`, never `guarded`.
 *   2. No I/O, no clock, no randomness. This must be exhaustively testable, and
 *      a reviewer must be able to read the whole thing in one sitting.
 */

const forbidden = (reason: string): Classification => ({ effect: 'forbidden', reason });
const guarded = (reason: string): Classification => ({ effect: 'guarded', reason });
const safe = (reason: string): Classification => ({ effect: 'safe', reason });

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

export function classify(
  role: RoleName,
  call: ToolCall,
  policy: PolicyConfig,
): Classification {
  const spec = getTool(call.name);
  if (!spec) {
    return forbidden(`no tool named ${call.name} exists`);
  }
  if (!spec.grantedTo.includes(role)) {
    return forbidden(`${call.name} is not granted to ${role}`);
  }

  const roots = policy.allowedRoots[role] ?? [];

  switch (call.name) {
    case 'fs.read':
    case 'fs.write':
    case 'fs.list': {
      const path = readString(call.args, 'path');
      if (path === undefined) return forbidden(`${call.name} called without a path`);
      const jail = confine(path, roots);
      if (!jail.ok) return forbidden(jail.reason ?? 'path is outside the workspace');
      return safe(`${call.name} within ${jail.root}`);
    }

    case 'git.branch': {
      const name = readString(call.args, 'name');
      if (name === undefined) return forbidden('git.branch called without a name');
      if (policy.protectedBranches.includes(name)) {
        return forbidden(`${name} is a protected branch`);
      }
      if (!name.startsWith(policy.agentBranchPrefix)) {
        return forbidden(`branch must start with ${policy.agentBranchPrefix}, got ${name}`);
      }
      return safe(`creating ${name}`);
    }

    case 'git.commit': {
      // The branch is runtime state, not an argument, so the caller passes the
      // checked-out branch in as `_branch`. A call that arrives without it is
      // refused rather than assumed safe.
      const branch = readString(call.args, '_branch');
      if (branch === undefined) return forbidden('current branch was not supplied to the classifier');
      if (policy.protectedBranches.includes(branch)) {
        return forbidden(`refusing to commit on protected branch ${branch}`);
      }
      if (!branch.startsWith(policy.agentBranchPrefix)) {
        return forbidden(`refusing to commit on ${branch}, which is not an agent branch`);
      }
      return safe(`committing on ${branch}`);
    }

    case 'git.diff':
      return safe('reading the working tree');

    case 'git.push': {
      const branch = readString(call.args, '_branch');
      if (branch === undefined) return forbidden('current branch was not supplied to the classifier');
      if (policy.protectedBranches.includes(branch)) {
        return forbidden(`refusing to push to protected branch ${branch}`);
      }
      if (!branch.startsWith(policy.agentBranchPrefix)) {
        return forbidden(`refusing to push ${branch}, which is not an agent branch`);
      }
      return guarded(`pushing ${branch} and opening a pull request`);
    }

    case 'shell.run': {
      const argv = call.args['argv'];
      if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
        return forbidden('shell.run needs a non-empty array of string arguments');
      }
      // No shell is involved — argv is exec'd directly — but a command carrying
      // metacharacters is a sign the model expected one, and the safest response
      // to that mistake is to refuse rather than to run something surprising.
      const suspicious = argv.find((a) => /[;&|`$><\n]/.test(a));
      if (suspicious !== undefined) {
        return forbidden(`argument ${JSON.stringify(suspicious)} contains shell metacharacters`);
      }
      const allowed = policy.allowedCommands.some(
        (cmd) => cmd.length === argv.length && cmd.every((part, i) => part === argv[i]),
      );
      if (!allowed) return forbidden(`${argv.join(' ')} is not an allowlisted command`);
      return safe(`running ${argv.join(' ')}`);
    }

    case 'http.fetch': {
      const raw = readString(call.args, 'url');
      if (raw === undefined) return forbidden('http.fetch called without a url');
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return forbidden(`${raw} is not a valid URL`);
      }
      if (url.protocol !== 'https:') return forbidden(`refusing ${url.protocol} — https only`);
      if (hostMatches(url.hostname, policy.allowedHosts)) {
        return safe(`fetching ${url.hostname}, which is allowlisted`);
      }
      return guarded(`fetching ${url.hostname}, which is not allowlisted`);
    }

    case 'email.draft':
      return safe('saving a draft, which sends nothing');

    case 'email.send': {
      const draftId = readString(call.args, 'draft_id');
      if (draftId === undefined) return forbidden('email.send called without a draft_id');
      return guarded('sending a real email to a real person');
    }

    case 'artifact.create':
      return safe('recording a deliverable');

    case 'memory.search':
      return safe('reading past work');

    case 'ask_founder':
      return safe('parking the task and asking a question');

    default:
      // Unreachable while the registry and this switch agree; if they ever
      // diverge, the missing case must fail closed.
      return forbidden(`${call.name} has no classification rule`);
  }
}

/** Exact host match, or a leading-dot suffix match for `.example.com` entries. */
function hostMatches(hostname: string, allowed: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((entry) => {
    const e = entry.toLowerCase();
    if (e.startsWith('.')) return host === e.slice(1) || host.endsWith(e);
    return host === e;
  });
}

/**
 * Effect meets autonomy, and the loop learns what to do.
 *
 * A `forbidden` call is refused whatever the autonomy level — autonomy can
 * loosen an approval requirement, never a prohibition.
 */
export function disposition(c: Classification, autonomy: Autonomy): Disposition {
  if (c.effect === 'forbidden') return { action: 'refuse', reason: c.reason };
  if (autonomy === 'propose') return { action: 'queue', reason: `proposed only: ${c.reason}` };
  if (c.effect === 'safe') return { action: 'execute', reason: c.reason };
  // guarded
  return autonomy === 'approve'
    ? { action: 'queue', reason: c.reason }
    : { action: 'execute', reason: c.reason };
}

/**
 * Guard on the promotion path. Called wherever autonomy is written — the
 * ratchet, the "always allow" button, the settings API — so there is no route
 * that quietly stops asking about the two actions that reach the outside world.
 */
export function canPromote(tool: string, to: Autonomy): { ok: boolean; reason?: string } {
  if (!NEVER_PROMOTABLE.has(tool)) return { ok: true };
  if (to === 'propose' || to === 'approve') return { ok: true };
  return {
    ok: false,
    reason: `${tool} can never run unattended — the founder reads every one`,
  };
}
