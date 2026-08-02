/**
 * Everything that talks to the server.
 *
 * One place, so cookie handling and error handling cannot be got subtly
 * different at one call site out of thirty.
 */

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `request failed (${status})`);
    this.status = status;
    this.body = body ?? {};
  }

  /** The session is fine; it is the age that is wrong. Prompt for a passkey. */
  get needsReauth() {
    return this.status === 403 && this.body.reauth === true;
  }
}

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    // `Origin` is a forbidden header name — script cannot set it, and does
    // not need to: the browser attaches it to every non-GET fetch, which is
    // exactly what makes the server's check worth having.
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text.slice(0, 200) };
  }

  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed;
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body ?? {});

/**
 * The live channel.
 *
 * `EventSource` reconnects on its own, which is most of why it is here rather
 * than a websocket. `onDrop` fires when it goes quiet so the header can say
 * so instead of silently showing stale numbers.
 */
export function listen({ onEvent, onOpen, onDrop }) {
  let source = null;

  const connect = () => {
    source = new EventSource('/api/stream');
    source.onopen = () => onOpen?.();
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        /* a frame we cannot read is not worth breaking the stream over */
      }
    };
    source.onerror = () => onDrop?.();
  };

  connect();
  return () => source?.close();
}
