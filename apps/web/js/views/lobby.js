// Pre-game lobby: share the code, watch detectives arrive, host starts.

import { api, auth, openStream } from '../api.js';
import { el, esc } from '../util.js';

export async function renderLobby(layout, sessionId) {
  let state = await api('GET', `/api/sessions/${sessionId}`);
  if (state.started) { location.hash = `#/game/${sessionId}`; return; }

  const modeLabel = { solo: 'Solo', coop: 'Co-op squad', versus: 'Versus race' }[state.mode];

  layout(`
  <div class="lobby">
    <div class="panel">
      <h2>CASE LOBBY — ${esc(modeLabel).toUpperCase()} · ${esc(state.tier).toUpperCase()}</h2>
      <div class="sub">Share this code. Rival or partner, they join with it from the precinct screen.</div>
      <div class="join-code">${esc(state.code)}</div>
      <div class="muted" style="text-align:center">waiting for detectives…</div>
      <div id="players" style="margin-top:18px"></div>
      ${state.hostId === auth.user.id
        ? '<button class="primary" id="start" style="width:100%;margin-top:20px">Open the casefile — start investigation</button>'
        : '<div class="muted" style="margin-top:20px;text-align:center">The host opens the casefile when everyone\'s in.</div>'}
      <div class="err" id="lobby-err"></div>
    </div>
  </div>`);

  const drawPlayers = (players) => {
    el('players').innerHTML = players.map((p) => `
      <div class="player-row">
        <span class="dot ${p.online ? 'on' : ''}"></span>
        <span>Det. ${esc(p.name)}</span>
        ${p.isHost ? '<span class="tag amber">host</span>' : ''}
      </div>`).join('');
  };
  drawPlayers(state.players);

  openStream(sessionId, {
    players: drawPlayers,
    started: () => { location.hash = `#/game/${sessionId}`; },
  });

  const startBtn = el('start');
  if (startBtn) {
    startBtn.onclick = async () => {
      try {
        await api('POST', `/api/sessions/${sessionId}/start`);
        location.hash = `#/game/${sessionId}`;
      } catch (err) { el('lobby-err').textContent = esc(err.message); }
    };
  }
}
