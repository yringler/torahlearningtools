CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,                -- "<name>:<hmac(subject) prefix>"
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
CREATE INDEX rate_limits_window ON rate_limits (window_start);
