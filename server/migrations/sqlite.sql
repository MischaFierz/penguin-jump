-- SQLite version of mysql.sql (automated tests and the local test server; production uses MySQL/MariaDB).

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  email TEXT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL,
  permissions INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT NULL,
  totp_last_step INTEGER NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NULL,
  password_changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS panel_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  permissions INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS panel_user_groups (
  user_id INTEGER NOT NULL REFERENCES panel_users (id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES panel_groups (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS settings (
  name TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
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
  panel_user_id INTEGER NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  author_id INTEGER NULL REFERENCES accounts (id) ON DELETE CASCADE,
  world INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  draft TEXT NOT NULL,
  draft_updated_at INTEGER NOT NULL,
  current_version_id INTEGER NULL,
  plays INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  published_at INTEGER NULL,
  UNIQUE (game_id, code)
);

CREATE TABLE IF NOT EXISTS level_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id INTEGER NOT NULL REFERENCES levels (id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  verified_ticks INTEGER NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (level_id, hash)
);

CREATE TABLE IF NOT EXISTS level_likes (
  level_id INTEGER NOT NULL REFERENCES levels (id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (level_id, account_id)
);

CREATE TABLE IF NOT EXISTS level_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id INTEGER NOT NULL REFERENCES levels (id) ON DELETE CASCADE,
  account_id INTEGER NULL,
  reason TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS level_plays (
  level_id INTEGER NOT NULL REFERENCES levels (id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (level_id, ip_hash)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT NOT NULL PRIMARY KEY,
  game_id TEXT NOT NULL,
  level_code TEXT NOT NULL,
  level_version_id INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'score',
  account_id INTEGER NULL,
  issued_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  level_code TEXT NOT NULL,
  level_version_id INTEGER NOT NULL,
  account_id INTEGER NULL,
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

CREATE INDEX IF NOT EXISTS ix_levels_list ON levels (game_id, kind, status);
CREATE INDEX IF NOT EXISTS ix_scores_time ON scores (level_version_id, hidden, time_ticks);
CREATE INDEX IF NOT EXISTS ix_scores_score ON scores (level_version_id, hidden, score);
CREATE INDEX IF NOT EXISTS ix_scores_player ON scores (player_key);
CREATE INDEX IF NOT EXISTS ix_codes_account ON email_codes (account_id, purpose)
