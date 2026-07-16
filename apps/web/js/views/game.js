// The Detective Desk: document viewers, interactive map, shared suspect
// board, squad chat, accusation flow, versus race state and the debrief.

import { api, auth, openStream } from '../api.js';
import { el, esc, fmtTime, clock, initials } from '../util.js';

export async function renderGame(layout, sessionId) {
  let state = await api('GET', `/api/sessions/${sessionId}`);
  if (!state.started) { location.hash = `#/lobby/${sessionId}`; return; }

  const c = state.case;
  const docs = c.documents;
  const suspects = docs.find((d) => d.kind === 'background_checks').payload.rows;
  const mapDoc = docs.find((d) => d.kind === 'map');
  const nameOf = {};
  for (const d of docs.find((x) => x.kind === 'call_logs').payload.subscribers) nameOf[d.charId] = d.name;

  let activeDocId = docs[0].id;
  let railTab = 'suspects';
  let readDocs = new Set(state.me?.readDocs || []);
  const localBoard = {}; // versus keeps notes client-side only

  const modeLabel = { solo: 'SOLO', coop: 'CO-OP SQUAD', versus: 'VERSUS RACE' }[state.mode];

  layout(`
  <div class="banner" id="banner">
    <b>${esc(c.title)}</b> · ${esc(c.town)} · case ${esc(c.id)} · <span class="tag amber">${modeLabel}</span>
    ${state.mode !== 'solo' ? ` · invite code <b>${esc(state.code)}</b>` : ''}
    <span id="banner-msg"></span>
  </div>
  <div class="desk">
    <nav class="desk-col doc-list" id="doc-list"></nav>
    <main class="desk-col doc-view" id="doc-view"></main>
    <aside class="rail">
      <div class="rail-tabs" id="rail-tabs"></div>
      <div class="rail-body" id="rail-body"></div>
    </aside>
  </div>`);

  // ------------------------------------------------------------ doc list ----
  const GROUPS = [
    ['REPORTS', (d) => ['briefing', 'crime_scene', 'autopsy'].includes(d.kind)],
    ['RECORDS', (d) => ['call_logs', 'background_checks', 'map'].includes(d.kind)],
    ['STATEMENTS', (d) => d.kind === 'witness_statement'],
  ];

  function shortTitle(d) {
    if (d.kind === 'witness_statement') return d.title.replace('Witness Statement — ', '');
    return { briefing: 'Case briefing', crime_scene: 'Crime scene', autopsy: 'Autopsy report', call_logs: 'Call records', background_checks: 'Background checks', map: 'Area map' }[d.kind] || d.title;
  }

  function drawDocList() {
    const whoRead = (docId) => {
      if (state.mode !== 'coop') return '';
      const others = state.players.filter((p) => p.id !== auth.user.id && p.readDocs?.includes(docId));
      return others.length ? `<span class="who">${others.map((p) => esc(initials(p.name))).join(' ')}</span>` : '';
    };
    el('doc-list').innerHTML = GROUPS.map(([label, match]) => `
      <div class="doc-group">${label}</div>
      ${docs.filter(match).map((d) => `
        <button class="doc-item ${d.id === activeDocId ? 'active' : ''}" data-doc="${d.id}">
          <span class="read">${readDocs.has(d.id) ? '✓' : '·'}</span>
          <span>${esc(shortTitle(d))}</span>
          ${whoRead(d.id)}
        </button>`).join('')}
    `).join('');
    for (const btn of el('doc-list').querySelectorAll('[data-doc]')) {
      btn.onclick = () => openDoc(btn.dataset.doc);
    }
  }

  // ---------------------------------------------------------- doc viewer ----
  function openDoc(docId) {
    activeDocId = docId;
    if (!readDocs.has(docId)) {
      readDocs.add(docId);
      api('POST', `/api/sessions/${sessionId}/read`, { docId }).catch(() => {});
    }
    drawDocList();
    const d = docs.find((x) => x.id === docId);
    el('doc-view').innerHTML = `<article class="paper">
      <div class="stamp">${esc(c.town)} P.D. · case ${esc(c.id)} · confidential</div>
      <h2>${esc(d.title)}</h2>
      ${renderDoc(d)}
    </article>`;
    wireDoc(d);
    el('doc-view').scrollTop = 0;
  }

  function prosePara(text) {
    return text.split('\n').filter((l) => l.trim()).map((l) => `<p>${esc(l)}</p>`).join('');
  }

  function renderDoc(d) {
    if (d.kind === 'crime_scene') {
      return d.payload.markers.map((m) => `<div class="marker"><b>[${m.n}] ${esc(m.label)}.</b> ${esc(m.detail)}</div>`).join('');
    }
    if (d.kind === 'call_logs') {
      const subs = d.payload.subscribers;
      return `
        ${prosePara(d.prose)}
        <div class="toolrow">
          <span>FILTER LINE:</span>
          <select id="cdr-filter"><option value="">— all subscribers —</option>
            ${subs.map((s) => `<option value="${esc(s.charId)}">${esc(s.name)} (${esc(s.number)})</option>`).join('')}
          </select>
        </div>
        <table><thead><tr><th>Time</th><th>From</th><th>To</th><th>Dur</th><th>From tower</th><th>To tower</th><th>Note</th></tr></thead>
        <tbody>${d.payload.rows.map((r, i) => `
          <tr data-row="${i}" data-from="${esc(r.fromCharId || '')}" data-to="${esc(r.toCharId || '')}">
            <td>${fmtTime(r.time)}</td>
            <td>${esc(nameOf[r.fromCharId] || r.from)}</td>
            <td>${esc(nameOf[r.toCharId] || r.to)}</td>
            <td>${r.durationMin}m</td>
            <td>${esc(r.fromTower || '—')}</td>
            <td>${esc(r.toTower || '—')}</td>
            <td>${esc(r.note || '')}</td>
          </tr>`).join('')}</tbody></table>
        <div class="subidx">Cross-reference tower IDs with the area map — a handset registers to whichever cell site is nearest.</div>`;
    }
    if (d.kind === 'background_checks') {
      return `${prosePara(d.prose)}${d.payload.rows.map((r) => `
        <div class="marker"><b>${esc(r.name)}</b>, ${r.age}, ${esc(r.occupation)} — ${esc(r.relationship)}.<br>
        ${r.motiveId ? '⚑ ' : ''}${esc(r.motiveNote)}</div>`).join('')}`;
    }
    if (d.kind === 'map') {
      return `${prosePara(d.prose)}
        <canvas id="mapcanvas" width="760" height="760"></canvas>
        <div class="map-readout" id="map-readout">Click two points to measure travel time.</div>`;
    }
    return prosePara(d.prose || '');
  }

  function wireDoc(d) {
    if (d.kind === 'call_logs') {
      const sel = el('cdr-filter');
      sel.onchange = () => {
        const v = sel.value;
        for (const tr of el('doc-view').querySelectorAll('tbody tr')) {
          tr.classList.toggle('hl', !!v && (tr.dataset.from === v || tr.dataset.to === v));
        }
      };
    }
    if (d.kind === 'map') wireMap(d);
  }

  // ------------------------------------------------------ interactive map ----
  function wireMap(d) {
    const cv = el('mapcanvas');
    const ctx = cv.getContext('2d');
    const { locations, towers, travel } = d.payload;
    const PAD = 42; const SIZE = cv.width - PAD * 2; const KM = 8.5;
    const X = (x) => PAD + (x / KM) * SIZE;
    const Y = (y) => cv.height - PAD - (y / KM) * SIZE;
    let picked = [];

    const KIND_STYLE = {
      home: { color: '#6b5b3e', r: 5 },
      bar: { color: '#8c2f2f', r: 7 }, diner: { color: '#8c2f2f', r: 7 },
      motel: { color: '#8c2f2f', r: 7 }, office: { color: '#3e5b6b', r: 7 },
      store: { color: '#3e5b6b', r: 7 }, park: { color: '#3e6b45', r: 7 },
      bridge: { color: '#3e5b6b', r: 7 },
    };

    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#d5c9a8'; ctx.lineWidth = 1;
      for (let k = 0; k <= KM; k += 1) {
        ctx.beginPath(); ctx.moveTo(X(0), Y(k)); ctx.lineTo(X(KM), Y(k)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(k), Y(0)); ctx.lineTo(X(k), Y(KM)); ctx.stroke();
      }
      ctx.font = '11px Courier New'; ctx.fillStyle = '#8a7c5c';
      ctx.fillText('1 square = 1 km · drive ≈ 4 min/km + 3', PAD, 20);

      for (const t of towers) {
        ctx.strokeStyle = '#8a7c5c';
        ctx.beginPath(); ctx.arc(X(t.x), Y(t.y), 14, 0, Math.PI * 2); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#8a7c5c';
        ctx.beginPath(); ctx.moveTo(X(t.x) - 5, Y(t.y) + 5); ctx.lineTo(X(t.x) + 5, Y(t.y) + 5); ctx.lineTo(X(t.x), Y(t.y) - 6); ctx.closePath(); ctx.fill();
        ctx.fillText(t.id.replace('tower_', 'T'), X(t.x) + 8, Y(t.y) - 6);
      }

      if (picked.length === 2) {
        ctx.strokeStyle = '#a33'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(X(picked[0].x), Y(picked[0].y)); ctx.lineTo(X(picked[1].x), Y(picked[1].y)); ctx.stroke();
        ctx.lineWidth = 1;
      }

      ctx.font = '10.5px Courier New';
      for (const l of locations) {
        const s = KIND_STYLE[l.kind] || KIND_STYLE.home;
        const sel = picked.includes(l);
        ctx.fillStyle = sel ? '#a33' : s.color;
        ctx.beginPath(); ctx.arc(X(l.x), Y(l.y), sel ? s.r + 2 : s.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4a4230';
        const label = l.kind === 'home' ? l.name.split(',')[0] : l.name;
        ctx.fillText(label, X(l.x) + 8, Y(l.y) + 3);
      }
    }

    cv.onclick = (e) => {
      const rect = cv.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (cv.width / rect.width);
      const my = (e.clientY - rect.top) * (cv.height / rect.height);
      let best = null; let bestD = 18;
      for (const l of locations) {
        const dd = Math.hypot(X(l.x) - mx, Y(l.y) - my);
        if (dd < bestD) { best = l; bestD = dd; }
      }
      if (!best) return;
      if (picked.length === 2 || (picked.length === 1 && picked[0] === best)) picked = [];
      picked.push(best);
      if (picked.length === 2) {
        const dist = Math.hypot(picked[0].x - picked[1].x, picked[0].y - picked[1].y);
        const drive = dist < 0.05 ? 0 : Math.round(dist * travel.driveMinPerKm) + travel.driveOverhead;
        const walk = Math.round(dist * travel.walkMinPerKm);
        el('map-readout').innerHTML = `<b>${esc(picked[0].name)}</b> → <b>${esc(picked[1].name)}</b>: ${dist.toFixed(1)} km · drive ~${drive} min · walk ~${walk} min`;
      } else {
        el('map-readout').textContent = `${picked[0].name} — now click a destination.`;
      }
      draw();
    };
    draw();
  }

  // ------------------------------------------------------------ right rail ----
  function drawRailTabs() {
    const tabs = [['suspects', 'SUSPECTS']];
    if (state.mode === 'coop') tabs.push(['chat', 'SQUAD CHAT']);
    tabs.push(['accuse', 'ACCUSE']);
    if (state.debrief) tabs.push(['debrief', 'DEBRIEF']);
    el('rail-tabs').innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="${railTab === id ? 'active' : ''}">${label}</button>`).join('');
    for (const b of el('rail-tabs').querySelectorAll('[data-tab]')) {
      b.onclick = () => { railTab = b.dataset.tab; drawRail(); };
    }
  }

  function drawRail() {
    drawRailTabs();
    if (railTab === 'suspects') drawSuspects();
    else if (railTab === 'chat') drawChat();
    else if (railTab === 'accuse') drawAccuse();
    else if (railTab === 'debrief') drawDebrief();
  }

  // -- suspects board (shared in solo/coop, local in versus) --
  const boardOf = (id) => (state.mode === 'versus' ? localBoard : state.board)[id]
    || { means: false, motive: false, opportunity: false, status: 'open', note: '' };

  function drawSuspects() {
    el('rail-body').innerHTML = suspects.map((s) => {
      const b = boardOf(s.charId);
      return `
      <div class="suspect-card ${b.status}" data-sus="${s.charId}">
        <h4>${esc(s.name)} ${s.motiveId ? '<span class="tag red">⚑ motive</span>' : ''}</h4>
        <div class="rel">${esc(s.relationship)} · ${esc(s.occupation)}</div>
        <div class="mmo">
          ${['means', 'motive', 'opportunity'].map((k) => `<label><input type="checkbox" data-k="${k}" ${b[k] ? 'checked' : ''}>${k.slice(0, 3)}</label>`).join('')}
        </div>
        <div class="statusrow">
          <button data-status="cleared" class="${b.status === 'cleared' ? 'sel-cleared' : ''}">cleared</button>
          <button data-status="open" class="${b.status === 'open' ? 'active' : ''}">?</button>
          <button data-status="prime" class="${b.status === 'prime' ? 'sel-prime' : ''}">PRIME</button>
        </div>
        <textarea data-k="note" placeholder="notes…">${esc(b.note)}</textarea>
      </div>`;
    }).join('');

    for (const card of el('rail-body').querySelectorAll('[data-sus]')) {
      const sid = card.dataset.sus;
      for (const cb of card.querySelectorAll('input[type=checkbox]')) {
        cb.onchange = () => pushBoard(sid, { [cb.dataset.k]: cb.checked });
      }
      for (const b of card.querySelectorAll('[data-status]')) {
        b.onclick = () => { pushBoard(sid, { status: b.dataset.status }); drawSuspects(); };
      }
      const ta = card.querySelector('textarea');
      let t = null;
      ta.oninput = () => { clearTimeout(t); t = setTimeout(() => pushBoard(sid, { note: ta.value }), 500); };
    }
  }

  function pushBoard(suspectId, patch) {
    const store = state.mode === 'versus' ? localBoard : state.board;
    store[suspectId] = { ...boardOf(suspectId), ...patch };
    if (state.mode !== 'versus') {
      api('POST', `/api/sessions/${sessionId}/board`, { suspectId, patch }).catch(() => {});
    }
  }

  // -- chat --
  function drawChat() {
    el('rail-body').innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%">
        <div class="chat-log" id="chat-log"></div>
        <form class="chat-form" id="chat-form"><input id="chat-input" placeholder="talk to the squad…" maxlength="500"><button class="primary">➤</button></form>
      </div>`;
    for (const msg of state.chat) appendChat(msg, false);
    scrollChat();
    el('chat-form').onsubmit = async (e) => {
      e.preventDefault();
      const input = el('chat-input');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await api('POST', `/api/sessions/${sessionId}/chat`, { text }).catch(() => {});
    };
  }

  function appendChat(msg, scroll = true) {
    const log = el('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="by">${esc(msg.byName)}:</span> ${esc(msg.text)}<span class="at">${clock(msg.at)}</span>`;
    log.appendChild(div);
    if (scroll) scrollChat();
  }
  const scrollChat = () => { const log = el('chat-log'); if (log) log.scrollTop = log.scrollHeight; };

  // -- accuse --
  function windowSlots() {
    const slots = [];
    for (let w = 1200; w <= 1410; w += 30) slots.push(w);
    return slots;
  }

  function drawAccuse() {
    const me = state.me || {};
    const lockedFor = Math.max(0, (me.lockedUntil || 0) - Date.now());
    el('rail-body').innerHTML = `
      <div class="accuse-form">
        <p class="muted" style="margin-top:0">A formal accusation goes to the D.A. — name the killer, the motive, the weapon and the half-hour it happened. ${state.mode === 'versus' ? 'A wrong accusation locks you out for 3 minutes and your rivals will hear about it.' : 'Wrong accusations cost score.'}</p>
        <label>The killer</label>
        <select id="acc-suspect"><option value="">— select —</option>${suspects.map((s) => `<option value="${esc(s.charId)}">${esc(s.name)}</option>`).join('')}</select>
        <label>The motive</label>
        <select id="acc-motive"><option value="">— select —</option>${c.taxonomy.motives.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</select>
        <label>The weapon</label>
        <select id="acc-weapon"><option value="">— select —</option>${c.taxonomy.weapons.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join('')}</select>
        <label>Time of the murder</label>
        <select id="acc-window"><option value="">— select —</option>${windowSlots().map((w) => `<option value="${w}">${fmtTime(w)} – ${fmtTime(w + 30)}</option>`).join('')}</select>
        <button class="primary" id="acc-submit" style="width:100%;margin-top:14px" ${lockedFor > 0 || me.solved || state.winnerId ? 'disabled' : ''}>Submit accusation</button>
        <div id="acc-verdict">${lockedFor > 0 ? `<div class="verdict bad">Locked out for ${Math.ceil(lockedFor / 1000)}s after a wrong accusation.</div>` : ''}</div>
      </div>`;

    el('acc-submit').onclick = async () => {
      const payload = {
        suspectId: el('acc-suspect').value,
        motiveId: el('acc-motive').value,
        weapon: el('acc-weapon').value,
        windowStart: Number(el('acc-window').value),
      };
      if (!payload.suspectId || !payload.motiveId || !payload.weapon || !payload.windowStart) {
        el('acc-verdict').innerHTML = '<div class="verdict bad">The D.A. wants all four: killer, motive, weapon, time.</div>';
        return;
      }
      try {
        const v = await api('POST', `/api/sessions/${sessionId}/accuse`, payload);
        if (v.correct) {
          state.debrief = v.debrief;
          state.me.solved = true;
          state.me.score = v.score;
          state.verdictBreakdown = v.breakdown;
          railTab = 'debrief';
          drawRail();
          openDebriefDoc();
        } else {
          if (v.lockedUntil) state.me.lockedUntil = v.lockedUntil;
          el('acc-verdict').innerHTML = `<div class="verdict bad">Wrong. The suspect walks and the trail goes colder.${v.lockedUntil ? ' Locked out 3 minutes.' : ` (wrong attempts: ${v.wrongAttempts})`}</div>`;
          if (v.lockedUntil) drawAccuse();
        }
      } catch (err) {
        el('acc-verdict').innerHTML = `<div class="verdict bad">${esc(err.message)}</div>`;
      }
    };
  }

  // -- debrief --
  function drawDebrief() {
    const d = state.debrief;
    if (!d) { el('rail-body').innerHTML = '<p class="muted">Nothing to see yet.</p>'; return; }
    const bd = state.verdictBreakdown;
    el('rail-body').innerHTML = `
      ${state.me?.score != null ? `<div class="verdict good">CASE CLOSED — score ${state.me.score}${bd ? `<br><span class="muted">motive ${bd.motive ? '✓' : '✗'} · weapon ${bd.weapon ? '✓' : '✗'} · time ${bd.window ? '✓' : '✗'}</span>` : ''}</div>` : ''}
      <p><b>${esc(d.killerName)}</b> killed the victim at ${esc(d.murderTimeText)} — ${esc(d.motiveLabel)}, with the ${esc(d.weapon)}.</p>
      <p class="muted">Open the full debrief in the reading pane →</p>
      <button class="primary" id="open-debrief" style="width:100%">Read the full debrief</button>`;
    el('open-debrief').onclick = openDebriefDoc;
  }

  function openDebriefDoc() {
    const d = state.debrief;
    if (!d) return;
    activeDocId = null;
    drawDocList();
    el('doc-view').innerHTML = `<div class="debrief"><article class="paper">
      <div class="stamp">${esc(c.town)} P.D. · case ${esc(c.id)} · CLOSED</div>
      <h2>DEBRIEF — WHAT REALLY HAPPENED</h2>
      <p><b>${esc(d.killerName)}</b> murdered the victim at <b>${esc(d.murderTimeText)}</b> with the <b>${esc(d.weapon)}</b>. Motive: <b>${esc(d.motiveLabel)}</b>.</p>
      <h3 style="font-family:var(--mono)">The fair path to the answer</h3>
      <ol>${d.keyEvidence.map((k) => `<li>${esc(k)}</li>`).join('')}</ol>
      <h3 style="font-family:var(--mono)">The killer's real evening</h3>
      ${d.killerTimeline.map((s) => `<div class="timeline-row"><span>${fmtTime(s.start)} – ${fmtTime(s.end)}</span><span>${esc(s.place)} — ${esc(s.activity)}</span></div>`).join('')}
      <h3 style="font-family:var(--mono)">Who was lying, and why</h3>
      ${d.liars.map((l) => `<div class="marker"><b>${esc(l.name)}</b> — ${esc(l.why)}</div>`).join('')}
    </article></div>`;
    el('doc-view').scrollTop = 0;
  }

  // ------------------------------------------------------------- realtime ----
  openStream(sessionId, {
    players: (players) => { state.players = players; drawDocList(); },
    chat: (msg) => { if (railTab === 'chat') appendChat(msg); },
    board: ({ suspectId, entry, byId }) => {
      if (byId === auth.user.id) return;
      state.board[suspectId] = entry;
      if (railTab === 'suspects' && !el('rail-body').contains(document.activeElement)) drawSuspects();
    },
    accusation: (ev) => {
      if (ev.byId === auth.user.id) return;
      const msg = el('banner-msg');
      if (msg) {
        msg.innerHTML = ev.correct
          ? ` · <span class="tag green">Det. ${esc(ev.byName)} CLOSED THE CASE</span>`
          : ` · <span class="tag red">Det. ${esc(ev.byName)} accused the wrong person</span>`;
      }
    },
    solved: async () => {
      state = await api('GET', `/api/sessions/${sessionId}`);
      drawRail();
      if (state.debrief && !state.me?.score) openDebriefDoc();
    },
  });

  // ---------------------------------------------------------------- boot ----
  drawDocList();
  openDoc(activeDocId);
  drawRail();
}
