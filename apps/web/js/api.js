// API client: JSON over fetch + one SSE stream per game session.

let token = localStorage.getItem('ct_token') || null;
let user = JSON.parse(localStorage.getItem('ct_user') || 'null');

export const auth = {
  get token() { return token; },
  get user() { return user; },
  set(t, u) {
    token = t; user = u;
    localStorage.setItem('ct_token', t);
    localStorage.setItem('ct_user', JSON.stringify(u));
  },
  clear() {
    token = null; user = null;
    localStorage.removeItem('ct_token');
    localStorage.removeItem('ct_user');
  },
};

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && token) {
    auth.clear();
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let stream = null;

export function openStream(sessionId, handlers) {
  closeStream();
  stream = new EventSource(`/api/sessions/${sessionId}/events?token=${encodeURIComponent(token)}`);
  for (const [event, fn] of Object.entries(handlers)) {
    stream.addEventListener(event, (e) => fn(JSON.parse(e.data)));
  }
  return stream;
}

export function closeStream() {
  if (stream) { stream.close(); stream = null; }
}
