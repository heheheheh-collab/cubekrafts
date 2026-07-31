-- Foreman, initial schema.
--
-- Postgres. Migrations are numbered files applied in order and never edited
-- once committed; corrections go in a new file.

-- ── identity ────────────────────────────────────────────────────────────────
-- Exactly one owner, enforced by a partial unique index on a constant.

CREATE TABLE owner (
  id          TEXT PRIMARY KEY,
  email       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  singleton   BOOLEAN     NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX owner_is_singleton ON owner ((singleton));

CREATE TABLE credential (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT        NOT NULL REFERENCES owner (id) ON DELETE CASCADE,
  public_key    BYTEA       NOT NULL,
  sign_count    BIGINT      NOT NULL DEFAULT 0,
  label         TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

CREATE TABLE recovery_code (
  hash        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at     TIMESTAMPTZ
);

CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT        NOT NULL UNIQUE,
  device        TEXT,
  ip            INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX session_live ON session (last_seen_at) WHERE revoked_at IS NULL;

CREATE TABLE auth_event (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT        NOT NULL,
  ip          INET,
  user_agent  TEXT,
  ok          BOOLEAN     NOT NULL,
  detail      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX auth_event_recent ON auth_event (at DESC);

-- ── org ─────────────────────────────────────────────────────────────────────

CREATE TABLE role (
  id             TEXT PRIMARY KEY,
  name           TEXT        NOT NULL UNIQUE,
  model          TEXT        NOT NULL,
  effort         TEXT        NOT NULL DEFAULT 'high'
                   CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  enabled        BOOLEAN     NOT NULL DEFAULT FALSE,
  concurrency    INT         NOT NULL DEFAULT 1 CHECK (concurrency BETWEEN 1 AND 4),
  second_reader  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE charter (
  id          BIGSERIAL PRIMARY KEY,
  role_id     TEXT        NOT NULL REFERENCES role (id) ON DELETE CASCADE,
  version     INT         NOT NULL,
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role_id, version)
);

CREATE TABLE tool_grant (
  role_id   TEXT NOT NULL REFERENCES role (id) ON DELETE CASCADE,
  tool      TEXT NOT NULL,
  autonomy  TEXT NOT NULL DEFAULT 'approve'
              CHECK (autonomy IN ('propose', 'approve', 'notify', 'auto')),
  config    JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (role_id, tool),
  -- The promotion guard, restated where it cannot be bypassed by a bad code
  -- path. See PLAN.md §10 and src/tools/effects.ts:canPromote.
  CONSTRAINT never_unattended CHECK (
    tool NOT IN ('email.send', 'git.push') OR autonomy IN ('propose', 'approve')
  )
);

-- ── work graph ──────────────────────────────────────────────────────────────

CREATE TABLE goal (
  id           TEXT PRIMARY KEY,
  title        TEXT        NOT NULL,
  why          TEXT,
  target_date  DATE,
  status       TEXT        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'met', 'abandoned')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE initiative (
  id          TEXT PRIMARY KEY,
  goal_id     TEXT        NOT NULL REFERENCES goal (id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  owner_role  TEXT        NOT NULL REFERENCES role (id),
  status      TEXT        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'done', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task (
  id                 TEXT PRIMARY KEY,
  initiative_id      TEXT REFERENCES initiative (id) ON DELETE CASCADE,
  title              TEXT        NOT NULL,
  spec               TEXT        NOT NULL,
  definition_of_done TEXT        NOT NULL,
  owner_role         TEXT        NOT NULL REFERENCES role (id),
  status             TEXT        NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'ready', 'running', 'blocked',
                                         'review', 'revise', 'done', 'cancelled')),
  priority           INT         NOT NULL DEFAULT 100,
  due                DATE,
  blocked_by         TEXT[]      NOT NULL DEFAULT '{}',
  high_stakes        BOOLEAN     NOT NULL DEFAULT FALSE,
  revision_count     INT         NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at          TIMESTAMPTZ,
  -- A task cannot become runnable without a written definition of done.
  CONSTRAINT dod_required_when_ready CHECK (
    status = 'draft' OR length(btrim(definition_of_done)) > 0
  )
);
CREATE INDEX task_claimable ON task (priority, created_at) WHERE status = 'ready';

-- ── execution ───────────────────────────────────────────────────────────────

CREATE TABLE run (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT        NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  role_id             TEXT        NOT NULL REFERENCES role (id),
  model               TEXT        NOT NULL,
  effort              TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'parked', 'done', 'failed', 'aborted')),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ,
  input_tokens        INT         NOT NULL DEFAULT 0,
  cached_input_tokens INT         NOT NULL DEFAULT 0,
  output_tokens       INT         NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(12, 6) NOT NULL DEFAULT 0,
  summary             TEXT,
  error               TEXT
);
CREATE INDEX run_by_task ON run (task_id, started_at DESC);

CREATE TABLE tool_call (
  id            TEXT PRIMARY KEY,
  run_id        TEXT        NOT NULL REFERENCES run (id) ON DELETE CASCADE,
  seq           INT         NOT NULL,
  tool          TEXT        NOT NULL,
  args          JSONB       NOT NULL,
  effect_class  TEXT        NOT NULL CHECK (effect_class IN ('safe', 'guarded', 'forbidden')),
  reason        TEXT        NOT NULL,
  approved_by   TEXT,
  result_hash   TEXT,
  ok            BOOLEAN,
  ms            INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE TABLE message (
  id       BIGSERIAL PRIMARY KEY,
  run_id   TEXT   NOT NULL REFERENCES run (id) ON DELETE CASCADE,
  seq      INT    NOT NULL,
  role     TEXT   NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content  JSONB  NOT NULL,
  UNIQUE (run_id, seq)
);

-- ── outputs and decisions ───────────────────────────────────────────────────

CREATE TABLE artifact (
  id           TEXT PRIMARY KEY,
  task_id      TEXT        REFERENCES task (id) ON DELETE SET NULL,
  kind         TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  storage_key  TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'review', 'accepted', 'rejected', 'published')),
  version      INT         NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE review (
  id           BIGSERIAL PRIMARY KEY,
  artifact_id  TEXT        NOT NULL REFERENCES artifact (id) ON DELETE CASCADE,
  reviewer     TEXT        NOT NULL,
  kind         TEXT        NOT NULL CHECK (kind IN ('coo', 'second_reader')),
  verdict      TEXT        NOT NULL CHECK (verdict IN ('accept', 'revise', 'escalate', 'objections', 'none')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approval (
  id              TEXT PRIMARY KEY,
  run_id          TEXT        NOT NULL REFERENCES run (id) ON DELETE CASCADE,
  tool_call_id    TEXT        NOT NULL REFERENCES tool_call (id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL,
  preview         JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  reason          TEXT,
  promoted_to_l2  BOOLEAN     NOT NULL DEFAULT FALSE,
  -- A decision must record when it was made.
  CONSTRAINT decided_has_timestamp CHECK (
    (status = 'pending') = (decided_at IS NULL)
  )
);
CREATE INDEX approval_pending ON approval (created_at) WHERE status = 'pending';

CREATE TABLE question (
  id           TEXT PRIMARY KEY,
  task_id      TEXT        NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  role_id      TEXT        NOT NULL REFERENCES role (id),
  text         TEXT        NOT NULL,
  answer       TEXT,
  asked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at  TIMESTAMPTZ
);

-- ── ops ─────────────────────────────────────────────────────────────────────

CREATE TABLE audit (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor    TEXT        NOT NULL,
  action   TEXT        NOT NULL,
  subject  TEXT,
  detail   JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_recent ON audit (at DESC);

CREATE TABLE setting (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);

CREATE TABLE spend_day (
  date           DATE PRIMARY KEY,
  usd            NUMERIC(12, 6) NOT NULL DEFAULT 0,
  input_tokens   BIGINT         NOT NULL DEFAULT 0,
  output_tokens  BIGINT         NOT NULL DEFAULT 0
);
