-- Parent accounts and passwordless login requests.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,               -- crypto.randomUUID()
  email         TEXT NOT NULL UNIQUE,           -- trimmed, NFC, lowercased
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  rev           INTEGER NOT NULL DEFAULT 0      -- per-account sync revision counter
);

CREATE TABLE login_requests (
  id          TEXT PRIMARY KEY,                 -- crypto.randomUUID()
  email       TEXT NOT NULL,                    -- normalized; user may not exist yet
  token_hash  TEXT NOT NULL UNIQUE,             -- sha256 hex of the magic-link token
  code_hash   TEXT NOT NULL,                    -- HMAC(AUTH_SECRET, "code:"+id+":"+code) hex
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,                 -- created_at + 15 min
  consumed_at INTEGER,                          -- set on success, supersede, or lockout
  attempts    INTEGER NOT NULL DEFAULT 0,       -- wrong code attempts
  ip_hash     TEXT
);
CREATE INDEX login_requests_email_created ON login_requests (email, created_at);
CREATE INDEX login_requests_expires ON login_requests (expires_at);
