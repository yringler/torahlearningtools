-- Append-only practice log. Denormalized columns support parent stats; `data` holds the full event JSON.
CREATE TABLE events (
  id          TEXT PRIMARY KEY,                 -- client UUID (idempotent inserts)
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id    TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  at          INTEGER NOT NULL,                 -- client ms
  day         TEXT NOT NULL,                    -- child's local yyyy-mm-dd
  type        TEXT NOT NULL CHECK (type IN ('recite', 'check', 'session', 'reset')),
  task        TEXT,
  perek       INTEGER,
  mishnah     INTEGER,
  grade       TEXT CHECK (grade IS NULL OR grade IN ('pass', 'help', 'notyet')),
  peeks       INTEGER,
  slips       INTEGER,
  ms          INTEGER,
  data        TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX events_child_at ON events (child_id, at);
CREATE INDEX events_user ON events (user_id);
