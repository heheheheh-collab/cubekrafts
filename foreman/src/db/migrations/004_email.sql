-- Email.
--
-- The one place the system speaks to a real person as the founder, so it gets
-- its own tables rather than living in `artifact` as a draft with a funny
-- kind. Four rules are enforced here rather than in code:
--
--   1. A drafted message is immutable. Revising means a new row.
--   2. An address that has bounced or unsubscribed cannot be written to.
--   3. Every send carries an idempotency key, unique forever.
--   4. A sent message records which provider id it became.

CREATE TABLE lead (
  id              TEXT PRIMARY KEY,
  email           TEXT        NOT NULL,
  name            TEXT,
  source          TEXT        NOT NULL DEFAULT 'unknown',
  -- Why we are allowed to write to this person at all. An enquiry through the
  -- site is consent; a list someone bought is not.
  consent         TEXT        NOT NULL DEFAULT 'enquiry'
                    CHECK (consent IN ('enquiry', 'reply', 'existing_customer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX lead_address ON lead (lower(email));

-- A message, frozen the moment it is written.
CREATE TABLE email_message (
  id            TEXT PRIMARY KEY,
  lead_id       TEXT        NOT NULL REFERENCES lead (id) ON DELETE CASCADE,
  task_id       TEXT        REFERENCES task (id) ON DELETE SET NULL,
  to_address    TEXT        NOT NULL,
  subject       TEXT        NOT NULL,
  body          TEXT        NOT NULL,
  -- sha256 over the canonical payload. What the founder read hashes to this;
  -- if the sender ever computes something different, it refuses to send.
  payload_hash  TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sent', 'failed', 'suppressed')),
  -- Unique forever, so a retry — or a double tap on a phone — cannot send
  -- the same message twice.
  idempotency_key TEXT      NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  provider_id   TEXT,
  error         TEXT
);
CREATE INDEX email_message_by_lead ON email_message (lead_id, created_at DESC);
CREATE INDEX email_message_sent ON email_message (sent_at) WHERE status = 'sent';

-- Rule 1, enforced where no code path can go around it. The founder approves
-- a specific body; a message whose body can change after that is not frozen,
-- it is merely usually the same.
CREATE FUNCTION email_message_is_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW.to_address <> OLD.to_address
     OR NEW.subject <> OLD.subject
     OR NEW.body <> OLD.body
     OR NEW.payload_hash <> OLD.payload_hash
     OR NEW.lead_id <> OLD.lead_id
  THEN
    RAISE EXCEPTION 'an email is frozen once drafted; write a new one instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_message_frozen
  BEFORE UPDATE ON email_message
  FOR EACH ROW EXECUTE FUNCTION email_message_is_frozen();

-- Rule 2. One row per address we must never write to again.
CREATE TABLE email_suppression (
  address     TEXT PRIMARY KEY,
  reason      TEXT        NOT NULL
                CHECK (reason IN ('bounce', 'complaint', 'unsubscribe', 'manual')),
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What the provider told us afterwards.
CREATE TABLE email_event (
  id          BIGSERIAL PRIMARY KEY,
  message_id  TEXT        REFERENCES email_message (id) ON DELETE SET NULL,
  provider_id TEXT,
  kind        TEXT        NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX email_event_recent ON email_event (at DESC);
