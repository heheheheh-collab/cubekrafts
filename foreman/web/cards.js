/**
 * Cards.
 *
 * A card exists when a list or a number reads better than a sentence. Nothing
 * here fetches or decides anything — it draws what it is handed and calls
 * `act` when a button is pressed, so there is exactly one place that changes
 * server state and it is not this file.
 *
 * Everything goes in through `textContent`, and nothing anywhere in this app
 * assigns markup as a string — test/static.test.ts enforces that. It is the
 * cheapest possible answer to the question of what happens when an agent
 * writes a task title containing a script tag.
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function card(heading, className = '') {
  const node = el('div', `card ${className}`.trim());
  if (heading) node.append(el('h3', null, heading));
  return node;
}

function rows(items) {
  const list = el('div', 'rows');
  for (const [key, value, tone] of items) {
    const row = el('div', 'row');
    row.append(el('span', 'k', key), el('span', `v ${tone ?? ''}`.trim(), value));
    list.append(row);
  }
  return list;
}

function ago(minutes) {
  if (minutes === undefined || minutes === null) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function when(value) {
  if (!value) return '—';
  const then = new Date(value);
  return ago((Date.now() - then.getTime()) / 60_000);
}

// ── approvals ───────────────────────────────────────────────────────────────

function approval(item, { act }) {
  const node = card(item.kind ?? item.tool, 'waiting');
  node.append(el('div', 'what', item.summary ?? item.reason ?? ''));

  // An email you cannot read in full is one you cannot meaningfully approve,
  // and the whole design rests on the founder having read it. The hash is the
  // one the sender will check against, so what is on screen is provably what
  // goes out.
  if (item.email && !item.email.missing) {
    const letter = el('div', 'letter');
    letter.append(el('div', 'to', `To: ${item.email.to}`));
    letter.append(el('div', 'subject', item.email.subject));
    letter.append(el('div', 'body', item.email.body));
    letter.append(el('div', 'meta', `frozen as ${item.email.hash}`));
    node.append(letter);
  }

  node.append(
    el('div', 'meta', `${item.role ?? 'an agent'} · waiting ${ago(item.waitingMinutes)}`),
  );

  const actions = el('div', 'actions');
  const approve = el('button', 'approve', 'Approve');
  const reject = el('button', 'reject', 'Decline');
  actions.append(reject, approve);
  node.append(actions);

  const settle = (text, tone) => {
    actions.replaceWith(el('div', 'meta', text));
    if (tone) node.className = 'card';
  };

  const press = async (button, decision) => {
    approve.disabled = true;
    reject.disabled = true;
    const result = await act(decision, { id: item.id });
    if (result?.cancelled) {
      approve.disabled = false;
      reject.disabled = false;
      return;
    }
    if (result?.error) {
      settle(result.error);
      return;
    }
    settle(decision === 'approve' ? 'Approved, and the run carried on.' : 'Declined.', true);
    void button;
  };

  approve.addEventListener('click', () => press(approve, 'approve'));
  reject.addEventListener('click', () => press(reject, 'reject'));
  return node;
}

// ── the rest ────────────────────────────────────────────────────────────────

const STATUS_TONE = {
  done: 'good',
  review: 'good',
  running: '',
  blocked: 'bad',
  cancelled: 'bad',
};

const RENDERERS = {
  approvals: (data, ctx) => {
    if (data.items.length === 0) {
      const empty = card('Approvals');
      empty.append(el('div', 'what', 'Nothing is waiting on you.'));
      return empty;
    }
    const wrap = document.createDocumentFragment();
    for (const item of data.items) wrap.append(approval(item, ctx));
    return wrap;
  },

  running: (data) => {
    const node = card('Running');
    node.append(
      rows(data.items.map((r) => [`${r.role} · ${r.title}`, ago(r.runningMinutes)])),
    );
    return node;
  },

  tasks: (data) => {
    const node = card('Tasks');
    node.append(
      rows(
        data.items
          .slice(0, 25)
          .map((t) => [t.title, t.status, STATUS_TONE[t.status] ?? '']),
      ),
    );
    return node;
  },

  questions: (data) => {
    const node = card('Questions');
    node.append(rows(data.items.map((q) => [`${q.role}: ${q.text}`, ago(q.waitingMinutes)])));
    return node;
  },

  spend: (data) => {
    const node = card('Spend today');
    const spent = data.todayUsd ?? 0;
    const cap = data.capUsd ?? 0;
    node.append(
      rows([
        ['Spent', `$${spent.toFixed(2)}`],
        ['Cap', `$${cap.toFixed(2)}`],
        ['Left', `$${Math.max(0, cap - spent).toFixed(2)}`, cap - spent <= 0 ? 'bad' : 'good'],
      ]),
    );
    const track = el('div', 'bar-track');
    const share = cap > 0 ? Math.min(1, spent / cap) : 0;
    const fill = el('div', `bar-fill ${share > 0.9 ? 'hot' : share > 0.6 ? 'warm' : ''}`.trim());
    fill.style.width = `${Math.round(share * 100)}%`;
    track.append(fill);
    node.append(track);
    return node;
  },

  standup: (data) => {
    const node = card('Standup');
    node.append(rows(data.rows ?? []));
    return node;
  },

  email: (data) => {
    const node = card('Email');
    node.append(
      rows(
        data.messages
          .slice(0, 20)
          .map((m) => [
            `${m.to_address} · ${m.subject}`,
            m.status,
            m.status === 'sent' ? 'good' : m.status === 'draft' ? '' : 'bad',
          ]),
      ),
    );
    if (data.suppressed.length > 0) {
      node.append(el('h3', null, 'Never write to these again'));
      node.append(rows(data.suppressed.map((s) => [s.address, s.reason, 'bad'])));
    }
    return node;
  },

  audit: (data) => {
    const node = card('Recent activity');
    node.append(
      rows(
        data.items
          .slice(0, 30)
          .map((a) => [`${a.actor} ${a.action}${a.subject ? ` · ${a.subject}` : ''}`, when(a.at)]),
      ),
    );
    return node;
  },

  sessions: (data, { act }) => {
    const node = card('Signed-in devices');
    const list = el('div', 'rows');
    for (const s of data.items) {
      const row = el('div', 'row');
      row.append(
        el('span', 'k', `${s.device ?? 'Unknown'}${s.current ? ' · this one' : ''}`),
      );
      const right = el('span', 'v');
      const revoke = el('button', 'reject', 'Revoke');
      revoke.style.flex = 'none';
      revoke.style.padding = '4px 10px';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        const result = await act('revoke', { id: s.id });
        right.textContent = result?.error ?? 'revoked';
        if (s.current) location.reload();
      });
      right.append(revoke);
      row.append(right);
      list.append(row);
    }
    node.append(list);
    return node;
  },

  authlog: (data) => {
    const node = card('Sign-ins and attempts');
    node.append(
      rows(
        data.items
          .slice(0, 30)
          .map((e) => [
            `${e.kind}${e.ip ? ` · ${e.ip}` : ''}`,
            e.ok ? when(e.at) : `failed ${when(e.at)}`,
            e.ok ? '' : 'bad',
          ]),
      ),
    );
    return node;
  },
};

/** Draw a card, or nothing at all for a shape we do not know. */
export function render(data, ctx = {}) {
  const renderer = RENDERERS[data?.type];
  if (!renderer) return null;
  return renderer(data, ctx);
}
