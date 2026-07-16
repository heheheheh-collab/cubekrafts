// Sign-in / register screen.

import { api, auth } from '../api.js';
import { el, esc } from '../util.js';

export function renderAuth(layout) {
  let mode = 'login';

  const draw = () => {
    layout(`
    <div class="center-wrap">
      <div class="case-card">
        <h1>COLD TRAIL</h1>
        <div class="sub">CONFIDENTIAL · HOMICIDE DIVISION · AUTHORIZED PERSONNEL ONLY</div>
        <div class="tabs">
          <button id="tab-login" class="${mode === 'login' ? 'active' : ''}">Sign in</button>
          <button id="tab-register" class="${mode === 'register' ? 'active' : ''}">New detective</button>
        </div>
        <form id="auth-form">
          <label for="handle">Detective handle</label>
          <input id="handle" autocomplete="username" maxlength="24" required>
          <label for="password">Password</label>
          <input id="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
          <button class="primary" type="submit">${mode === 'login' ? 'Open the case files' : 'Join the force'}</button>
          <div class="err" id="auth-err"></div>
        </form>
      </div>
    </div>`, { bare: true });

    el('tab-login').onclick = () => { mode = 'login'; draw(); };
    el('tab-register').onclick = () => { mode = 'register'; draw(); };
    el('auth-form').onsubmit = async (e) => {
      e.preventDefault();
      el('auth-err').textContent = '';
      try {
        const data = await api('POST', mode === 'login' ? '/api/login' : '/api/register', {
          handle: el('handle').value.trim(),
          password: el('password').value,
        });
        auth.set(data.token, data.user);
        location.hash = '#/home';
      } catch (err) {
        el('auth-err').textContent = esc(err.message);
      }
    };
  };
  draw();
}
