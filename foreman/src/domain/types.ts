/**
 * Core vocabulary. Everything in the system is described in these terms, and
 * nothing here knows about HTTP, Postgres, or Claude.
 */

/** The roles on the payroll. Charters live in the database; this is the identity. */
export type RoleName =
  | 'coo'
  | 'developer'
  | 'sales'
  | 'marketing'
  | 'content'
  | 'finance';

export const ROLE_NAMES: readonly RoleName[] = [
  'coo',
  'developer',
  'sales',
  'marketing',
  'content',
  'finance',
];

/**
 * What a tool call does to the world.
 *
 * - `safe`      reversible, server-side, invisible outside the system. Executes.
 * - `guarded`   goes outbound, spends money, or writes to something the founder
 *               owns. Queues for approval.
 * - `forbidden` not for this role, ever. Refused, logged, run aborted.
 */
export type Effect = 'safe' | 'guarded' | 'forbidden';

/** How much rope a given (role, tool) pair has been given. */
export type Autonomy =
  | 'propose' // L0 — describe only, never execute
  | 'approve' // L1 — execute after the founder approves
  | 'notify' // L2 — execute now, tell the founder, offer an undo
  | 'auto'; // L3 — execute silently, audit log only

export const AUTONOMY_ORDER: readonly Autonomy[] = ['propose', 'approve', 'notify', 'auto'];

/**
 * Tools that may never be promoted above `approve`, by any path — not by the
 * ratchet, not by the "always allow" button, not by an API call.
 *
 * These two reach a real person and a real repository. The design's honesty
 * depends on a human having read each one, so the system must not be able to
 * quietly stop asking. See PLAN.md §10.
 */
export const NEVER_PROMOTABLE: ReadonlySet<string> = new Set(['email.send', 'git.push']);

/** A classification result, always carrying the reason it was reached. */
export interface Classification {
  effect: Effect;
  /** Human-readable, written for the audit log and the approvals screen. */
  reason: string;
}

/** What the agent loop should do with a tool call, once effect meets autonomy. */
export type Disposition =
  | { action: 'execute'; reason: string }
  | { action: 'queue'; reason: string } // park the run, wait for the founder
  | { action: 'refuse'; reason: string }; // abort the run

/** A tool call as the model emitted it, before anything has been decided. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Everything the classifier is allowed to consult. Deliberately explicit. */
export interface PolicyConfig {
  /** Absolute directories each role may read and write within. */
  allowedRoots: Partial<Record<RoleName, readonly string[]>>;
  /** Hosts reachable without approval. Anything else is guarded, not refused. */
  allowedHosts: readonly string[];
  /** Exact commands the developer may run, as full argv arrays. */
  allowedCommands: readonly (readonly string[])[];
  /** Branches no agent may ever write to, whatever the tool. */
  protectedBranches: readonly string[];
  /** Branch names an agent may create and commit to, as a prefix. */
  agentBranchPrefix: string;
}

export const DEFAULT_POLICY: PolicyConfig = {
  allowedRoots: {},
  allowedHosts: [],
  allowedCommands: [
    ['npm', 'test'],
    ['npm', 'run', 'lint'],
    ['npm', 'run', 'build'],
    ['npm', 'ci'],
  ],
  protectedBranches: ['main', 'master'],
  agentBranchPrefix: 'foreman/',
};
