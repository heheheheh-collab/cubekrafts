// Precinct home: open a new case (solo / co-op / versus), join by code, daily case.

import { api } from '../api.js';
import { el, esc } from '../util.js';

export async function renderHome(layout) {
  layout(`
  <div class="home-grid">
    <div class="panel">
      <h2>OPEN A NEW CASE</h2>
      <div class="sub">A fresh, procedurally generated homicide. No two cases are alike.</div>
      <label for="mode">Mode</label>
      <select id="mode">
        <option value="solo">Solo — just you and the casefile</option>
        <option value="coop">Co-op squad — investigate with friends</option>
        <option value="versus">Versus — race rival detectives on the same case</option>
      </select>
      <label for="tier">Difficulty</label>
      <select id="tier">
        <option value="rookie">Rookie — 6–7 suspects</option>
        <option value="detective" selected>Detective — 9–11 suspects</option>
      </select>
      <button class="primary" id="create">Open case</button>
      <div class="err" id="create-err"></div>
    </div>

    <div class="panel">
      <h2>JOIN A SQUAD</h2>
      <div class="sub">Got an invite code from another detective? Enter it here.</div>
      <label for="code">Invite code</label>
      <input id="code" maxlength="6" placeholder="e.g. K7M2QX" style="text-transform:uppercase">
      <button class="primary" id="join">Join case</button>
      <div class="err" id="join-err"></div>
    </div>

    <div class="panel">
      <h2>THE DAILY CASE</h2>
      <div class="sub">One case, everyone. Same evidence, same killer. Fastest clean solve tops the board. No giving up — the culprit is revealed here the next day.</div>
      <button class="primary" id="daily">Take today's case</button>
      <table class="lb" id="lb"><tr><th>#</th><th>Detective</th><th>Score</th><th>Time</th></tr></table>
      <div style="margin-top:14px;border-top:1px solid var(--line);padding-top:10px">
        <button id="reveal-daily">Reveal yesterday's culprit</button>
        <div id="reveal-out" style="margin-top:8px"></div>
      </div>
    </div>
  </div>`);

  el('reveal-daily').onclick = async () => {
    el('reveal-out').innerHTML = '<span class="muted">Opening the file…</span>';
    try {
      const r = await api('GET', '/api/daily/solution');
      el('reveal-out').innerHTML = `<div class="verdict bad" style="margin-top:0">
        <b>${esc(r.day)}</b> — “${esc(r.title)}”, ${esc(r.town)}<br>
        The culprit was <b>${esc(r.killerName)}</b> — ${esc(r.motiveLabel)}. Method: ${esc(r.weapon)} (${esc(r.murderTimeText)}).</div>`;
    } catch (err) { el('reveal-out').innerHTML = `<div class="verdict bad" style="margin-top:0">${esc(err.message)}</div>`; }
  };

  el('create').onclick = async () => {
    el('create-err').textContent = '';
    try {
      const s = await api('POST', '/api/sessions', { mode: el('mode').value, tier: el('tier').value });
      location.hash = s.started ? `#/game/${s.id}` : `#/lobby/${s.id}`;
    } catch (err) { el('create-err').textContent = esc(err.message); }
  };

  el('join').onclick = async () => {
    el('join-err').textContent = '';
    try {
      const s = await api('POST', '/api/sessions/join', { code: el('code').value.trim().toUpperCase() });
      location.hash = s.started ? `#/game/${s.id}` : `#/lobby/${s.id}`;
    } catch (err) { el('join-err').textContent = esc(err.message); }
  };

  el('daily').onclick = async () => {
    const s = await api('POST', '/api/daily');
    location.hash = `#/game/${s.id}`;
  };

  try {
    const { rows } = await api('GET', '/api/daily/leaderboard');
    const lb = el('lb');
    if (lb) {
      rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${i + 1}</td><td>${esc(r.handle)}</td><td>${r.score}</td><td>${Math.round(r.durationMs / 60000)} min</td>`;
        lb.appendChild(tr);
      });
      if (!rows.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="4" class="muted">Nobody has cracked today\'s case yet.</td>';
        lb.appendChild(tr);
      }
    }
  } catch { /* leaderboard is decorative */ }
}
