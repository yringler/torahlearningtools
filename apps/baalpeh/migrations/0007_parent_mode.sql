-- Parent mode (docs/PARENT_MODE.md §4). Additive: every existing session and login request becomes 'learner'.

-- Sessions: scope is set by the INSERT and never changed. Unlock state lives only on parent rows.
ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'learner' CHECK (scope IN ('learner', 'parent'));
ALTER TABLE sessions ADD COLUMN id TEXT;               -- public id for the change log (randomUUID); NULL on old rows
ALTER TABLE sessions ADD COLUMN login_email TEXT;      -- the address the sign-in went to (ready for several per account)
ALTER TABLE sessions ADD COLUMN unlocked_at INTEGER;   -- parent: when the PIN was last entered
ALTER TABLE sessions ADD COLUMN unlocked_until INTEGER; -- parent: idle re-lock deadline; NULL = locked

ALTER TABLE login_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'learner' CHECK (scope IN ('learner', 'parent'));
CREATE INDEX login_requests_email_scope_created ON login_requests (email, scope, created_at);

-- One PIN per ACCOUNT (not per login).
CREATE TABLE account_pins (
  user_id        TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  hash           TEXT NOT NULL,                 -- hex PBKDF2-SHA256(HMAC(AUTH_SECRET, "pin:"+user_id+":"+pin), salt)
  salt           TEXT NOT NULL,                 -- 16 random bytes, hex
  iterations     INTEGER NOT NULL,
  failed         INTEGER NOT NULL DEFAULT 0 CHECK (failed BETWEEN 0 AND 5), -- wrong tries in a row (reserved first)
  locked_at      INTEGER,                       -- set at the 5th wrong try; cleared only by setting a PIN via reset
  set_at         INTEGER NOT NULL,
  set_by_session TEXT                           -- sessions.id, NULL when set from a reset link
);

-- "Forgot PIN?" links. The token is never stored.
CREATE TABLE pin_resets (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email             TEXT NOT NULL,              -- where the link went (users.email today)
  token_hash        TEXT NOT NULL UNIQUE,
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,           -- created_at + 1 h
  consumed_at       INTEGER,                    -- used, superseded, or send failed
  requested_via     TEXT NOT NULL CHECK (requested_via IN ('parent', 'test_page')),
  requested_session TEXT                        -- sessions.id when requested from parent mode
);
CREATE INDEX pin_resets_user_created ON pin_resets (user_id, created_at);
CREATE INDEX pin_resets_expires ON pin_resets (expires_at);

-- The fence for parent edits (§8): the users.rev at which a parent last wrote the row. NULL = never.
ALTER TABLE progress ADD COLUMN parent_rev INTEGER;
ALTER TABLE children ADD COLUMN parent_rev INTEGER;

-- The change log shown in parent mode. Keyed to the account; the actor columns name the login.
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at            INTEGER NOT NULL,
  action        TEXT NOT NULL CHECK (action IN (
                  'pin_set', 'pin_changed', 'pin_reset', 'pin_locked',
                  'perek_verified', 'perek_unverified', 'progress_edited',
                  'child_added', 'child_removed', 'child_edited')),
  child_id      TEXT,                           -- no FK: the entry outlives the child
  child_name    TEXT,                           -- snapshot at the time
  detail        TEXT NOT NULL DEFAULT '{}',     -- JSON, shapes in docs/PARENT_MODE.md §6.6
  via           TEXT NOT NULL CHECK (via IN ('parent', 'test_link', 'pin_reset_link')),
  actor_email   TEXT,                           -- sessions.login_email, or the address the link went to
  actor_session TEXT,                           -- sessions.id; NULL for links
  actor_device  TEXT                            -- User-Agent, cut to 200 chars
);
CREATE INDEX audit_log_user_at ON audit_log (user_id, at);
