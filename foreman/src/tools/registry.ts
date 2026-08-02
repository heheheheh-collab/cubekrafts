import type { Autonomy, RoleName } from '../domain/types.ts';

/**
 * The tool surface, defined once.
 *
 * `input_schema` is plain JSON Schema so it can be handed to the model
 * unchanged, and `strict` is set on every tool so arguments validate exactly
 * rather than approximately.
 *
 * Descriptions are prescriptive about *when* to call a tool, not just what it
 * does. That phrasing measurably improves whether the model reaches for the
 * right one.
 */

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  /** Roles allowed to hold this tool at all. Anything else is forbidden. */
  grantedTo: readonly RoleName[];
  /** Where a fresh grant starts. Never above `approve` for guarded tools. */
  defaultAutonomy: Autonomy;
}

function obj(
  properties: Record<string, unknown>,
  required: string[],
): ToolSpec['input_schema'] {
  return { type: 'object', properties, required, additionalProperties: false };
}

const str = (description: string) => ({ type: 'string', description });

export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'fs.read',
    description:
      'Read a UTF-8 text file. Call this before editing anything, and before ' +
      'claiming a file contains something.',
    input_schema: obj({ path: str('Path to the file, relative to your workspace.') }, ['path']),
    grantedTo: ['developer', 'content'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'fs.write',
    description:
      'Create or overwrite a text file. Read the file first if it already exists — ' +
      'this replaces the whole contents.',
    input_schema: obj(
      { path: str('Path to the file.'), content: str('Full new contents.') },
      ['path', 'content'],
    ),
    grantedTo: ['developer', 'content'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'fs.list',
    description: 'List the entries of a directory. Use this to orient before reading.',
    input_schema: obj({ path: str('Directory to list.') }, ['path']),
    grantedTo: ['developer', 'content'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'git.branch',
    description:
      'Create and check out a branch. Every piece of work starts on its own branch ' +
      'named foreman/<task-id>.',
    input_schema: obj({ name: str('Branch name. Must start with foreman/.') }, ['name']),
    grantedTo: ['developer'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'git.commit',
    description:
      'Commit staged and unstaged changes on the current branch. Write the message ' +
      'as a sentence explaining why, not what.',
    input_schema: obj({ message: str('Commit message.') }, ['message']),
    grantedTo: ['developer'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'git.diff',
    description: 'Show the diff of the working tree, for review or for a summary.',
    input_schema: obj({}, []),
    grantedTo: ['developer'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'git.push',
    description:
      'Push the current branch and open a pull request. Requires approval every ' +
      'single time, and can never push to a protected branch.',
    input_schema: obj(
      { title: str('Pull request title.'), body: str('Pull request description.') },
      ['title', 'body'],
    ),
    grantedTo: ['developer'],
    defaultAutonomy: 'approve',
  },
  {
    name: 'shell.run',
    description:
      'Run one allowlisted command, such as the test suite or the linter. Call this ' +
      'after making code changes and before claiming they work.',
    input_schema: obj(
      { argv: { type: 'array', items: { type: 'string' }, description: 'Command and arguments.' } },
      ['argv'],
    ),
    grantedTo: ['developer'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'http.fetch',
    description:
      'Fetch a URL as text. Call this when you need the actual contents of a page ' +
      'rather than a search result summary.',
    input_schema: obj({ url: str('Absolute https URL.') }, ['url']),
    grantedTo: ['marketing', 'content'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'email.draft',
    description: 'Save a draft reply against a lead. Drafting never sends anything.',
    input_schema: obj(
      {
        lead_id: str('The lead this reply belongs to.'),
        subject: str('Subject line.'),
        body: str('Message body, plain text.'),
      },
      ['lead_id', 'subject', 'body'],
    ),
    grantedTo: ['sales'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'email.send',
    description:
      'Send a drafted message to the lead. Always requires the founder to read and ' +
      'approve it first; it is never sent automatically.',
    input_schema: obj({ draft_id: str('The draft to send.') }, ['draft_id']),
    grantedTo: ['sales'],
    defaultAutonomy: 'approve',
  },
  {
    name: 'artifact.create',
    description:
      'Record a finished deliverable — a post, a brief, a report. This is how work ' +
      'leaves your hands and reaches review.',
    input_schema: obj(
      {
        kind: str('One of: post, brief, report, doc, plan, diff.'),
        title: str('Short title.'),
        body: str('Full contents, markdown.'),
      },
      ['kind', 'title', 'body'],
    ),
    grantedTo: ['coo', 'developer', 'sales', 'marketing', 'content', 'finance'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'artifact.publish',
    description:
      'Publish a finished artifact. This is visible outside the company, so it ' +
      'always waits for the founder to read and approve it first.',
    input_schema: obj(
      { artifact_id: str('The artifact to publish.'), where: str('Channel or destination.') },
      ['artifact_id', 'where'],
    ),
    grantedTo: ['content', 'marketing'],
    defaultAutonomy: 'approve',
  },
  {
    name: 'memory.search',
    description:
      'Search past artifacts, run summaries and rejection reasons. Call this before ' +
      'starting anything that resembles work already done.',
    input_schema: obj({ query: str('Search terms.') }, ['query']),
    grantedTo: ['coo', 'developer', 'sales', 'marketing', 'content', 'finance', 'concierge'],
    defaultAutonomy: 'auto',
  },

  // ── the work graph ────────────────────────────────────────────────────────
  // Internal, reversible, and invisible outside the building, so all of these
  // are safe. What they queue is not: a task the COO writes still has every
  // one of its own tool calls classified when it actually runs.
  {
    name: 'org.look_up',
    description:
      'Read the current state of the company: tasks, runs, approvals, questions, ' +
      'goals, artifacts, spend, or activity. Call this before answering anything ' +
      'about what is happening — never answer from memory.',
    input_schema: obj(
      {
        view: str(
          'One of: tasks, runs, approvals, questions, goals, artifacts, spend, activity.',
        ),
        query: str('Optional filter, matched against titles.'),
      },
      ['view'],
    ),
    grantedTo: ['coo', 'concierge'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'org.set_goal',
    description:
      'Record a goal the founder has just stated. A goal is an outcome, not a task — ' +
      'the COO is what breaks it into work.',
    input_schema: obj(
      { title: str('The outcome, in the founder’s words.'), why: str('Why it matters.') },
      ['title'],
    ),
    grantedTo: ['coo', 'concierge'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'org.dispatch',
    description:
      'Create one task and hand it to a role. Every task needs a definition of done ' +
      'specific enough that the role can check its own work against it. Work that ' +
      'spans two roles is two tasks.',
    input_schema: obj(
      {
        title: str('Short title.'),
        spec: str('What to do, and any context the role will not have.'),
        definition_of_done: str('How the role knows it is finished. Be concrete.'),
        owner_role: str('One of: developer, sales, marketing, content, finance.'),
        priority: { type: 'integer', description: 'Lower runs sooner. Default 100.' },
      },
      ['title', 'spec', 'definition_of_done', 'owner_role'],
    ),
    grantedTo: ['coo', 'concierge'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'org.review',
    description:
      'Accept a finished task or send it back. Sending it back must carry a reason ' +
      'the role can act on; "make it better" is not one.',
    input_schema: obj(
      {
        task_id: str('The task under review.'),
        verdict: str('One of: accept, revise, escalate.'),
        notes: str('What is right, or precisely what to change.'),
      },
      ['task_id', 'verdict', 'notes'],
    ),
    grantedTo: ['coo'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'org.answer',
    description:
      'Answer a question an agent parked. The task it belongs to becomes runnable again.',
    input_schema: obj(
      { question_id: str('The question being answered.'), answer: str('The answer.') },
      ['question_id', 'answer'],
    ),
    grantedTo: ['concierge'],
    defaultAutonomy: 'auto',
  },
  {
    name: 'org.control',
    description:
      'Stop or restart all work. Use this when the founder says stop, hold off, or ' +
      'carry on. It takes effect before the next task is claimed.',
    input_schema: obj({ paused: { type: 'boolean', description: 'True to stop.' } }, ['paused']),
    grantedTo: ['concierge'],
    defaultAutonomy: 'auto',
  },

  {
    name: 'ask_founder',
    description:
      'Park this task and ask the founder a question. Call this instead of guessing ' +
      'when a decision is genuinely not yours to make. Asking is always better than ' +
      'inventing an answer and proceeding.',
    input_schema: obj({ question: str('One specific question.') }, ['question']),
    grantedTo: ['coo', 'developer', 'sales', 'marketing', 'content', 'finance'],
    defaultAutonomy: 'auto',
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolSpec | undefined {
  return BY_NAME.get(name);
}

/** The tools a role may hold, in a stable order so the prompt prefix caches. */
export function toolsFor(role: RoleName): ToolSpec[] {
  return TOOLS.filter((t) => t.grantedTo.includes(role)).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}
