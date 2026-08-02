import {
  type Autonomy,
  type Classification,
  type Disposition,
  type PolicyConfig,
  type RoleName,
  type RuntimeFacts,
  type ToolCall,
  NEVER_PROMOTABLE,
  ROLE_NAMES,
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
 *   3. Runtime state arrives in `facts`, never in `call.args`. The args are
 *      model output; letting the model assert which branch it is on would let
 *      it authorise its own push.
 */

/** The only things org.look_up can be pointed at. Anything else is a typo or a probe. */
const ORG_VIEWS: readonly string[] = [
  'tasks',
  'runs',
  'approvals',
  'questions',
  'goals',
  'artifacts',
  'spend',
  'activity',
];

const REVIEW_VERDICTS: readonly string[] = ['accept', 'revise', 'escalate'];

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
  facts: RuntimeFacts = {},
): Classification {
  // Underscore-prefixed keys are reserved for runtime facts and must never
  // arrive from the model. Their presence means either a bug in the caller or
  // an attempt to smuggle state past the classifier; either way, refuse.
  const smuggled = Object.keys(call.args).find((k) => k.startsWith('_'));
  if (smuggled !== undefined) {
    return forbidden(`argument ${smuggled} is reserved and may not be model-supplied`);
  }

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
      // The branch comes from git, via `facts` — never from the model. A call
      // that arrives without it is refused rather than assumed safe.
      const branch = facts.currentBranch;
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
      const branch = facts.currentBranch;
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

    case 'artifact.publish': {
      const artifactId = readString(call.args, 'artifact_id');
      const where = readString(call.args, 'where');
      if (artifactId === undefined || where === undefined) {
        return forbidden('artifact.publish needs both artifact_id and where');
      }
      return guarded(`publishing ${artifactId} to ${where}`);
    }

    case 'memory.search':
      return safe('reading past work');

    // The work graph is Foreman's own database. Writing to it queues work; it
    // does not do any. Everything queued is classified again when it actually
    // runs, so dispatch cannot launder a forbidden action into a safe one.
    case 'org.look_up': {
      const view = readString(call.args, 'view');
      if (view === undefined) return forbidden('org.look_up called without a view');
      if (!ORG_VIEWS.includes(view)) return forbidden(`there is no ${view} view`);
      return safe(`reading ${view}`);
    }

    case 'org.set_goal': {
      if (readString(call.args, 'title') === undefined) {
        return forbidden('org.set_goal called without a title');
      }
      return safe('recording a goal');
    }

    case 'org.dispatch': {
      const owner = readString(call.args, 'owner_role');
      if (owner === undefined) return forbidden('org.dispatch called without an owner_role');
      // Work can only be handed to somebody who exists, and never to the
      // concierge, which is not a worker and has no run loop.
      if (!ROLE_NAMES.includes(owner as RoleName) || owner === 'coo') {
        return forbidden(`${owner} cannot be given a task`);
      }
      if (readString(call.args, 'definition_of_done') === undefined) {
        return forbidden('a task cannot be dispatched without a definition of done');
      }
      return safe(`creating a task for ${owner}`);
    }

    case 'org.review': {
      const verdict = readString(call.args, 'verdict');
      if (readString(call.args, 'task_id') === undefined) {
        return forbidden('org.review called without a task_id');
      }
      if (verdict === undefined || !REVIEW_VERDICTS.includes(verdict)) {
        return forbidden(`${verdict ?? 'nothing'} is not a review verdict`);
      }
      return safe(`recording a ${verdict} verdict`);
    }

    case 'org.answer': {
      if (readString(call.args, 'question_id') === undefined) {
        return forbidden('org.answer called without a question_id');
      }
      if (readString(call.args, 'answer') === undefined) {
        return forbidden('org.answer called without an answer');
      }
      return safe('answering a parked question');
    }

    case 'org.control': {
      const paused = call.args['paused'];
      if (typeof paused !== 'boolean') {
        return forbidden('org.control needs paused to be true or false');
      }
      return safe(paused ? 'stopping all work' : 'restarting work');
    }

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
