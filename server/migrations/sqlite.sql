-- SQLite version of mysql.sql (used by the automated tests; production uses MySQL/MariaDB).

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT NULL,
  totp_last_step INTEGER NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NULL,
  password_changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL PRIMARY KEY,
  hits INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account_id INTEGER NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT NOT NULL PRIMARY KEY,
  game_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  account_id INTEGER NULL REFERENCES accounts (id) ON DELETE SET NULL,
  player_key TEXT NOT NULL,
  nickname TEXT NOT NULL,
  time_ticks INTEGER NOT NULL,
  score INTEGER NOT NULL,
  coins INTEGER NOT NULL,
  replay TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  ip_hash TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_scores_time ON scores (game_id, level_id, hidden, time_ticks);
CREATE INDEX IF NOT EXISTS ix_scores_score ON scores (game_id, level_id, hidden, score);
CREATE INDEX IF NOT EXISTS ix_scores_player ON scores (player_key)
