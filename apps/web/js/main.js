// Hash router + top-level layout.

import { auth, closeStream } from './api.js';
import { esc, el } from './util.js';
import { renderAuth } from './views/auth.js';
import { renderHome } from './views/home.js';
import { renderLobby } from './views/lobby.js';
import { renderGame } from './views/game.js';
import { showTutorial, shouldAutoShow } from './views/tutorial.js';

function layout(inner, { bare = false } = {}) {
  const app = el('app');
  if (bare) { app.innerHTML = inner; return; }
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/home">COLD TRAIL<small>procedural case files</small></a>
      <div class="spacer"></div>
      ${auth.user ? `<button id="help" class="ghost">How to play</button>
      <span class="muted whoami">Det. ${esc(auth.user.handle)}</span>
      <button id="logout">Sign out</button>` : ''}
    </header>
    ${inner}`;
  const out = el('logout');
  if (out) out.onclick = () => { auth.clear(); closeStream(); location.hash = '#/login'; };
  const help = el('help');
  if (help) help.onclick = () => showTutorial(true);
}

async function route() {
  closeStream();
  const hash = location.hash || '#/home';
  const [, page, arg] = hash.slice(1).split('/');

  if (!auth.user && page !== 'login') { location.hash = '#/login'; return; }
  if (auth.user && page === 'login') { location.hash = '#/home'; return; }

  try {
    if (page === 'login') return renderAuth(layout);
    if (page === 'lobby' && arg) return await renderLobby(layout, arg);
    if (page === 'game' && arg) return await renderGame(layout, arg);
    const home = await renderHome(layout);
    if (shouldAutoShow()) setTimeout(() => showTutorial(), 350); // first-run welcome
    return home;
  } catch (err) {
    layout(`<div class="center-wrap"><div class="case-card">
      <h1>DEAD END</h1>
      <p class="err">${esc(err.message)}</p>
      <button class="primary" onclick="location.hash='#/home'">Back to the precinct</button>
    </div></div>`);
  }
}

window.addEventListener('hashchange', route);
route();
