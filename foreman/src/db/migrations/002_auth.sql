-- Authentication support.
--
-- The identity tables landed in 001. What was missing is somewhere to keep a
-- challenge between the two halves of a WebAuthn ceremony, and the counters
-- rate limiting needs.

-- A challenge is single-use and short-lived. Storing it server-side is the
-- whole point: a challenge the client could choose is not a challenge.
CREATE TABLE auth_challenge (
  id          TEXT PRIMARY KEY,
  purpose     TEXT        NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  challenge   TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX auth_challenge_live ON auth_challenge (expires_at) WHERE used_at IS NULL;

-- Fixed-window counters. A row per (bucket, window), incremented on the way
-- in, so the limit holds across restarts and across processes rather than
-- living in one instance's memory.
CREATE TABLE rate_counter (
  bucket       TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX rate_counter_sweep ON rate_counter (window_start);

-- 001 allowed several credentials but gave no way to tell them apart at a
-- glance in the sessions list, and no transport hint for the browser.
ALTER TABLE credential ADD COLUMN transports TEXT[] NOT NULL DEFAULT '{}';
