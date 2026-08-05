import { get, post, listen, ApiError } from './api.js';
import * as passkey from './webauthn.js';
import { render } from './cards.js';
import { voice } from './voice.js';
import { core } from './core.js';

/**
 * The whole front end.
 *
 * One conversation surface. You type or speak; it answers, and the answer is
 * a card when a card says it better than a sentence. Everything the agents do
 * arrives on the same thread through the event stream, so the app is never
 * showing you a number that stopped being true a minute ago.
 */

const $ = (id) => document.getElementById(id);
const screens = { boot: $('boot'), gate: $('gate'), app: $('app') };

let snapshot = null;
let connected = false;
/**
 * The uplink has three states, not two.
 *
 * `refresh()` runs before the event stream is opened, so on every load there
 * was a moment where "not connected yet" was reported as "connection lost" —
 * and the orb went amber, which is the colour reserved for something being
 * wrong. Nothing was wrong; the stream had simply not opened yet.
 */
let link = 'opening';
let stopListening = null;

// ── screens ─────────────────────────────────────────────────────────────────

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

// ── the thread ──────────────────────────────────────────────────────────────

const thread = $('thread');

function atBottom() {
  return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
}

function append(node) {
  // Only follow the conversation down if the reader is already at the bottom.
  // Yanking the view while someone is reading back through it is rude.
  const follow = atBottom();
  thread.append(node);
  if (follow) thread.scrollTop = thread.scrollHeight;
  // A thread that grows without limit eventually makes the phone stutter.
  while (thread.children.length > 200) thread.firstChild.remove();
  return node;
}

function turn(kind, text, { whisper, card } = {}) {
  const el = document.createElement('div');
  el.className = `turn ${kind}`;

  if (text) {
    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text;
    el.append(body);
  }
  if (whisper) {
    const w = document.createElement('div');
    w.className = 'whisper';
    w.textContent = whisper;
    el.append(w);
  }
  if (card) el.append(card);
  return append(el);
}

const said = (text) => turn('you', text);
const noted = (text) => turn('event', text);

function answered(text, card, { speak = true } = {}) {
  turn('it', text, card ? { card } : {});
  if (speak && text) voice.say(text);
}

// ── the header ──────────────────────────────────────────────────────────────

function pill(label, tone, onClick) {
  const el = document.createElement('button');
  el.className = `pill ${tone ?? ''}`.trim();
  el.textContent = label;
  if (onClick) el.addEventListener('click', onClick);
  return el;
}

function paintPills() {
  const pills = $('pills');
  pills.replaceChildren();
  if (!snapshot) return;

  const waiting = snapshot.approvals.length;
  if (waiting > 0) {
    pills.append(
      pill(`${waiting} waiting`, 'waiting', () => ask("what's pending")),
    );
  }
  if (snapshot.running.length > 0) {
    pills.append(
      pill(`${snapshot.running.length} running`, 'moving', () => ask("what's running")),
    );
  }
  if (snapshot.questions.length > 0) {
    pills.append(
      pill(`${snapshot.questions.length} asked`, 'waiting', () => ask('any questions')),
    );
  }
  if (snapshot.paused) pills.append(pill('paused', 'bad', () => ask('resume')));

  const spent = snapshot.spendTodayUsd ?? 0;
  const cap = snapshot.spendCapUsd ?? 0;
  const hot = cap > 0 && spent / cap > 0.8;
  pills.append(pill(`$${spent.toFixed(2)}`, hot ? 'bad' : '', () => ask('spend')));

  if (!connected) pills.append(pill('offline', 'bad'));
  if (waiting === 0 && snapshot.running.length === 0 && !snapshot.paused) {
    pills.append(pill('all clear', ''));
  }
}

async function refresh() {
  try {
    snapshot = await get('/api/snapshot');
    paintPills();
    core.update(snapshot, { link });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return toGate();
    // A failed read is a lost uplink whatever the stream thinks.
    connected = false;
    link = 'lost';
    paintPills();
    core.update(snapshot, { link });
  }
}

// ── talking ─────────────────────────────────────────────────────────────────

const say = $('say');

async function ask(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  said(trimmed);
  say.value = '';
  // Typing is a gesture, so this is the point at which sound is allowed to
  // exist at all. The orb puffs on the same tick the message leaves.
  core.tones.unlock();
  const done = core.begin();

  try {
    const reply = await post('/api/talk', { text: trimmed });
    if (reply.needsModel) {
      snapshot = reply.snapshot;
      paintPills();
      await escalate(trimmed);
      return;
    }
    answered(reply.speech, reply.card ? render(reply.card, { act }) : null);
    core.succeeded();
    await refresh();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return toGate();
    core.failed();
    answered(`That didn't work: ${err.message}`, null, { speak: false });
  } finally {
    done();
  }
}

/**
 * Anything the fast path did not recognise goes to the model.
 *
 * The two are deliberately different code paths: the fast one must never wait
 * on a network call to Anthropic, and the slow one must never pretend to be
 * instant. The thinking line is what makes the difference visible rather than
 * looking like a stall.
 */
async function escalate(text) {
  const thinking = turn('it', 'Thinking…');
  const done = core.begin();
  try {
    const reply = await post('/api/ask', { text });
    thinking.remove();
    answered(reply.speech, reply.card ? render(reply.card, { act }) : null);
    core.succeeded();
    for (const line of reply.did ?? []) noted(line);
    await refresh();
  } catch (err) {
    thinking.remove();
    core.failed();
    if (err instanceof ApiError && err.status === 404) {
      // The model path is not wired up in this build. Say so plainly rather
      // than inventing an answer.
      answered(
        "I don't have a quick answer for that yet. Try: what's pending, what's running, spend, standup, pause, resume.",
        null,
        { speak: false },
      );
      return;
    }
    answered(`That didn't work: ${err.message}`, null, { speak: false });
  } finally {
    done();
  }
}

// ── acting on a card ────────────────────────────────────────────────────────

/** What a card's buttons call. Kept here so cards.js stays about drawing. */
async function act(action, payload) {
  try {
    if (action === 'approve' || action === 'reject') {
      const body = { decision: action };
      if (action === 'reject') {
        const reason = prompt('Why? The agent is told, so it does not retry the same thing.');
        if (reason === null) return { cancelled: true };
        if (reason.trim()) body.reason = reason.trim();
      }
      const res = await post(`/api/approvals/${payload.id}/decide`, body);
      await refresh();
      return res;
    }
    if (action === 'revoke') {
      await post(`/api/auth/sessions/${payload.id}/revoke`, {});
      return { ok: true };
    }
    if (action === 'connect') {
      return await post('/api/connections', payload);
    }
    if (action === 'setkey') {
      return await post('/api/model/key', { apiKey: payload.apiKey ?? null });
    }
  } catch (err) {
    if (err instanceof ApiError && err.needsReauth) {
      const ok = await reauthenticate();
      if (ok) return act(action, payload);
      return { error: 'needs your passkey' };
    }
    return { error: err.message };
  }
  return { error: `unknown action ${action}` };
}

/** Step-up: prove it is still you, then carry on with whatever was refused. */
async function reauthenticate() {
  answered('Confirm with your passkey.', null, { speak: false });
  try {
    await passkey.signIn();
    return true;
  } catch (err) {
    if (!(err instanceof passkey.Cancelled)) {
      answered(`Could not confirm: ${err.message}`, null, { speak: false });
    }
    return false;
  }
}

// ── the live stream ─────────────────────────────────────────────────────────

const NARRATION = {
  'run.started': (e) => `${e.role} started work`,
  'run.finished': (e) => `a run finished — ${e.outcome}`,
  'approval.decided': (e) => `approval ${e.decision}d`,
  'spend.cap': (e) => `daily cap is now $${e.capUsd}`,
  'model.changed': (e) => `now thinking with ${e.model}`,
};

function connect() {
  stopListening?.();
  stopListening = listen({
    onOpen: () => {
      connected = true;
      link = 'open';
      paintPills();
      core.update(snapshot, { link });
    },
    onDrop: () => {
      connected = false;
      link = 'lost';
      paintPills();
      core.update(snapshot, { link });
    },
    onEvent: (event) => {
      // The one event worth interrupting for: something is waiting on you.
      if (event.type === 'approval.pending') {
        // Something stopped and is waiting on a person: the one event worth
        // making a noise about when nobody is looking at the screen.
        core.succeeded();
        answered(`${event.tool} needs you: ${event.summary}`, null, { speak: true });
      } else if (event.type === 'paused') {
        noted(event.paused ? 'paused' : 'running again');
      } else if (event.type === 'tick' && event.ran) {
        noted(event.kind === 'supervision' ? 'the COO is reviewing' : 'a task was picked up');
      } else if (event.type === 'standup') {
        answered(event.speech, null, { speak: false });
      } else if (NARRATION[event.type]) {
        noted(NARRATION[event.type](event));
      }
      void refresh();
    },
  });
}

// ── the menu ────────────────────────────────────────────────────────────────

const menu = $('menu');

const VIEWS = {
  approvals: async () => {
    const items = await get('/api/approvals');
    return items.length === 0
      ? ['Nothing is waiting on you.', null]
      : [`${items.length} waiting on you.`, render({ type: 'approvals', items }, { act })];
  },
  tasks: async () => {
    const items = await get('/api/tasks');
    return [`${items.length} tasks.`, render({ type: 'tasks', items }, { act })];
  },
  connections: async () => {
    const items = await get('/api/connections');
    const off = items.filter((c) => !c.connected).length;
    return [
      off === 0 ? 'Everything is connected.' : `${off} of ${items.length} still to connect.`,
      render({ type: 'connections', items }, { act }),
    ];
  },
  model: async () => {
    const s = await get('/api/model');
    const speech =
      s.keyHint || s.provider === 'anthropic'
        ? `Running on ${s.model}.`
        : `Running on ${s.model ?? 'nothing yet'} — paste an Anthropic key here to switch.`;
    return [speech, render({ type: 'model', ...s }, { act })];
  },
  spend: async () => {
    const s = await get('/api/spend');
    return [
      `$${s.todayUsd.toFixed(2)} of $${s.capUsd.toFixed(2)} today.`,
      render({ type: 'spend', ...s }, { act }),
    ];
  },
  // The scheduler runs every ten minutes, which is right for a machine that
  // is always on and wrong for somebody sitting in front of it waiting to see
  // whether the thing works at all.
  runnow: async () => {
    const r = await post('/api/tick', {});
    if (!r.ran) {
      const why = {
        paused: 'Everything is paused. Say "resume".',
        cap_reached: "Today's spend cap is used up.",
        no_work: 'Nothing to do — no task is ready and nothing needs the COO.',
        no_role_config: `No configuration for the role that task belongs to (${r.detail ?? '?'}).`,
      };
      return [why[r.why] ?? `Nothing ran: ${r.why}`, null];
    }
    const what = r.kind === 'supervision' ? 'The COO took a pass' : `Picked up ${r.taskId}`;
    return [`${what} — ${r.outcome?.kind ?? 'finished'}.`, null];
  },

  standup: async () => {
    const s = await get('/api/standup');
    return [s.speech, render({ type: 'standup', rows: s.rows }, { act })];
  },
  audit: async () => {
    const items = await get('/api/audit');
    return ['Recent activity.', render({ type: 'audit', items }, { act })];
  },
  email: async () => {
    const [{ messages, suppressed }, dns] = await Promise.all([
      get('/api/email'),
      get('/api/email/dns'),
    ]);
    // The DNS verdict goes first. Everything else on this card is moot if the
    // domain disavows us.
    const blocked = dns.configured && dns.looksSendable === false;
    return [
      blocked
        ? `${dns.domain} will not let us send as it yet.`
        : `${messages.length} messages, ${suppressed.length} suppressed addresses.`,
      render({ type: 'email', messages, suppressed, dns }, { act }),
    ];
  },
  export: async () => {
    // Straight to a download rather than into the thread: it is a file, and
    // the fresh-session gate has already been satisfied by getting here.
    const res = await fetch('/api/export', { credentials: 'same-origin' });
    if (res.status === 403) throw new ApiError(403, await res.json());
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `foreman-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return ['Everything is in that file — the work, the artifacts, and your charters.', null];
  },
  sessions: async () => {
    const items = await get('/api/auth/sessions');
    return [`${items.length} signed-in devices.`, render({ type: 'sessions', items }, { act })];
  },
  authlog: async () => {
    const items = await get('/api/auth/log');
    return ['Sign-ins and attempts.', render({ type: 'authlog', items }, { act })];
  },
  addkey: async () => {
    await passkey.register({ label: `Added ${new Date().toLocaleDateString()}` });
    return ['That passkey is registered. You can sign in with it now.', null];
  },
  signout: async () => {
    await post('/api/auth/signout', {});
    location.reload();
    return ['Signing out.', null];
  },
};

async function runView(name) {
  menu.hidden = true;
  $('menu-button').setAttribute('aria-expanded', 'false');
  const view = VIEWS[name];
  if (!view) return;
  try {
    const [text, card] = await view();
    answered(text, card, { speak: false });
  } catch (err) {
    if (err instanceof passkey.Cancelled) return;
    if (err instanceof ApiError && err.status === 401) return toGate();
    if (err instanceof ApiError && err.needsReauth) {
      if (await reauthenticate()) return runView(name);
      return;
    }
    answered(`That didn't work: ${err.message}`, null, { speak: false });
  }
}

// ── the gate ────────────────────────────────────────────────────────────────

function gateError(message) {
  const el = $('gate-error');
  el.textContent = message ?? '';
  el.hidden = !message;
}

function toGate() {
  show('gate');
  void drawGate();
}

async function drawGate() {
  const state = await get('/api/auth/state');
  const primary = $('gate-primary');
  const lede = $('gate-lede');
  gateError(null);

  if (!passkey.supported()) {
    lede.textContent =
      'This browser cannot do passkeys. Open Foreman in Safari, Chrome, or Edge.';
    primary.hidden = true;
    return;
  }

  if (!state.claimed) {
    lede.textContent =
      'Nobody has set this up yet. Register a passkey and this becomes your account — there is no second one.';
    primary.textContent = 'Register this device';
    primary.onclick = () => claim();
    $('gate-recover').hidden = true;
    return;
  }

  lede.textContent = 'Sign in with your passkey.';
  primary.textContent = 'Use passkey';
  primary.onclick = () => signIn();
  $('gate-recover').hidden = false;
}

async function withGateButton(fn) {
  const primary = $('gate-primary');
  primary.disabled = true;
  gateError(null);
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof passkey.Cancelled)) gateError(err.message);
  } finally {
    primary.disabled = false;
  }
}

const claim = () =>
  withGateButton(async () => {
    const result = await passkey.register({ label: 'First device' });
    if (result.recoveryCode) {
      // Shown exactly once, and the app does not move on until it has been
      // acknowledged — this is the only copy that will ever exist.
      $('gate-primary').hidden = true;
      $('gate-lede').hidden = true;
      $('recovery-shown').hidden = false;
      $('recovery-code').textContent = result.recoveryCode;
      $('recovery-ack').onclick = () => enter();
      return;
    }
    await enter();
  });

const signIn = () =>
  withGateButton(async () => {
    await passkey.signIn();
    await enter();
  });

async function recover(event) {
  event.preventDefault();
  gateError(null);
  try {
    const result = await post('/api/auth/recover', { code: $('recover-code').value });
    $('recover-form').hidden = true;
    $('gate-primary').hidden = true;
    $('recovery-shown').hidden = false;
    $('recovery-code').textContent = result.recoveryCode;
    $('recovery-ack').onclick = () => enter();
  } catch (err) {
    gateError(err.message);
  }
}

// ── in ──────────────────────────────────────────────────────────────────────

async function enter() {
  show('app');
  core.attach($('core'));
  await refresh();
  connect();
  await greet();
  say.focus();
}

async function greet() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const waiting = snapshot?.approvals.length ?? 0;
  const running = snapshot?.running.length ?? 0;

  const bits = [];
  if (waiting > 0) bits.push(`${waiting} waiting on you`);
  if (running > 0) bits.push(`${running} running`);
  if (snapshot?.paused) bits.push('everything is paused');

  answered(
    bits.length === 0
      ? `${part}. Jordan here — nothing needs you.`
      : `${part}. Jordan here — ${bits.join(', ')}.`,
    waiting > 0 && snapshot ? render({ type: 'approvals', items: snapshot.approvals }, { act }) : null,
    { speak: false },
  );

  // Before nine, lead with what happened overnight — that is the whole reason
  // this thing is hosted rather than sitting on a laptop that was asleep.
  if (hour < 9) {
    try {
      const standup = await get('/api/standup');
      if (standup.speech) answered(standup.speech, render({ type: 'standup', rows: standup.rows }, { act }), { speak: false });
    } catch {
      /* the greeting is not worth an error message */
    }
  }
}

// ── wiring ──────────────────────────────────────────────────────────────────

$('send').addEventListener('click', () => ask(say.value));
say.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ask(say.value);
});
$('recover-form').addEventListener('submit', recover);
$('gate-recover').addEventListener('click', () => {
  $('recover-form').hidden = false;
  $('gate-recover').hidden = true;
  $('recover-code').focus();
});
$('menu-button').addEventListener('click', () => {
  menu.hidden = !menu.hidden;
  $('menu-button').setAttribute('aria-expanded', String(!menu.hidden));
});
menu.addEventListener('click', (e) => {
  const name = e.target.closest('button')?.dataset.do;
  if (name) void runView(name);
});
document.addEventListener('click', (e) => {
  if (!menu.hidden && !menu.contains(e.target) && e.target !== $('menu-button')) menu.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') menu.hidden = true;
  // Anywhere on the page, start typing and you are talking to it.
  if (!screens.app.hidden && e.key.length === 1 && document.activeElement === document.body) {
    say.focus();
  }
});
document.addEventListener('visibilitychange', () => {
  // Coming back to a backgrounded tab, the numbers are old and the stream may
  // have been reaped. Both are cheap to fix and jarring to leave wrong.
  if (!document.hidden && !screens.app.hidden) {
    void refresh();
    if (!connected) connect();
  }
});

voice.attach({
  button: $('mic'),
  onHeard: (text) => ask(text),
  // The waveform is the whole feedback that it is hearing you, so it is
  // driven by the recogniser's own events rather than by a guess.
  onState: (on) => core.listening(on),
});

// ── boot ────────────────────────────────────────────────────────────────────

(async function boot() {
  try {
    const state = await get('/api/auth/state');
    if (state.signedIn) await enter();
    else toGate();
  } catch {
    show('gate');
    $('gate-lede').textContent = 'Cannot reach the server. It may still be starting.';
    $('gate-primary').textContent = 'Try again';
    $('gate-primary').onclick = () => location.reload();
  }
})();
