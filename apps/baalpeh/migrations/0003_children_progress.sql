CREATE TABLE children (
  id         TEXT PRIMARY KEY,                  -- client-generated UUID
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  data       TEXT NOT NULL,                     -- ChildMeta JSON
  deleted    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL,                  -- LWW clock (client ms, clamped to server now)
  rev        INTEGER NOT NULL,                  -- users.rev at last write
  created_at INTEGER NOT NULL
);
CREATE INDEX children_user_rev ON children (user_id, rev);

CREATE TABLE progress (
  child_id   TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,                     -- denormalized owner for pull queries
  kind       TEXT NOT NULL CHECK (kind IN ('m', 'p', 'd')),
  key        TEXT NOT NULL,                     -- "p:m" | "p" | "yyyy-mm-dd"
  data       TEXT NOT NULL,                     -- JSON (MishnahProgressData | PerekProgressData | {})
  updated_at INTEGER NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (child_id, kind, key)
);
CREATE INDEX progress_user_rev ON progress (user_id, rev);
