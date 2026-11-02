CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,                -- sha256 hex of the cookie token; the token itself is never stored
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,                -- sliding: last use + 30 days
  user_agent   TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
