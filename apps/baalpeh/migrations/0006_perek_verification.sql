-- Parent verification of a perek by email (docs/PARENT_VERIFICATION.md §3).

-- One emailed "test me" request. The token itself is never stored.
CREATE TABLE perek_tests (
  id          TEXT PRIMARY KEY,                 -- crypto.randomUUID(); also the email idempotency key suffix
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  child_id    TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  masechta    TEXT NOT NULL,                    -- catalog id, e.g. 'berakhot'
  perek       INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,             -- sha256 hex of the link token
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,                 -- created_at + 30 d
  consumed_at INTEGER,                          -- set together with outcome
  outcome     TEXT CHECK (outcome IS NULL OR outcome IN ('verified', 'covered', 'failed', 'revoked'))
  -- verified: this link confirmed it. covered: another link for the same perek confirmed it first.
  -- failed: the email provider refused the send (doesn't count for the cooldown). revoked: an admin un-verify killed it.
);
CREATE INDEX perek_tests_child_created ON perek_tests (child_id, created_at);
CREATE INDEX perek_tests_child_perek ON perek_tests (child_id, masechta, perek);
CREATE INDEX perek_tests_user_created ON perek_tests (user_id, created_at);
CREATE INDEX perek_tests_expires ON perek_tests (expires_at);

-- Server-authoritative verified state. Written only through worker/lib/verification.ts (the confirm route, and later
-- the parent admin), never by /api/sync.
CREATE TABLE perek_verifications (
  child_id    TEXT NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,                    -- denormalized owner for pull queries (as in progress)
  masechta    TEXT NOT NULL,
  perek       INTEGER NOT NULL,
  verified    INTEGER NOT NULL CHECK (verified IN (0, 1)),  -- 0 = un-verified by admin; row kept so it syncs down
  verified_at INTEGER,                          -- when it last became 1
  source      TEXT NOT NULL CHECK (source IN ('email', 'admin')),
  test_id     TEXT,                             -- perek_tests.id that confirmed it; NULL for admin edits
  updated_at  INTEGER NOT NULL,                 -- server clock
  rev         INTEGER NOT NULL,                 -- users.rev at last write (sync cursor)
  PRIMARY KEY (child_id, masechta, perek)
);
CREATE INDEX perek_verifications_user_rev ON perek_verifications (user_id, rev);
