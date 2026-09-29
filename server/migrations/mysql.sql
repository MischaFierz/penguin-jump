-- Schema for MySQL 8 / MariaDB 10.5+. Safe to run repeatedly (setup and updates do that).
-- Player accounts (accounts, auth_tokens, email_codes) are game-independent so several games/apps can
-- later share one login. Admin panel users (panel_*) are separate from player accounts.

CREATE TABLE IF NOT EXISTS accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(20) NOT NULL,
  username_norm VARCHAR(20) NOT NULL,
  email VARCHAR(190) NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  password_hash VARCHAR(255) NOT NULL,
  recovery_hash VARCHAR(255) NOT NULL,
  disabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at INT UNSIGNED NOT NULL,
  last_login_at INT UNSIGNED NULL,
  password_changed_at INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_accounts_norm (username_norm),
  KEY ix_accounts_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  client VARCHAR(32) NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  expires_at INT UNSIGNED NOT NULL,
  last_used_at INT UNSIGNED NULL,
  UNIQUE KEY uq_tokens_hash (token_hash),
  KEY ix_tokens_account (account_id),
  CONSTRAINT fk_tokens_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS email_codes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  account_id INT UNSIGNED NOT NULL,
  purpose VARCHAR(10) NOT NULL,
  email VARCHAR(190) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at INT UNSIGNED NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  KEY ix_codes_account (account_id, purpose),
  CONSTRAINT fk_codes_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panel_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(20) NOT NULL,
  username_norm VARCHAR(20) NOT NULL,
  display_name VARCHAR(60) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  role VARCHAR(12) NOT NULL,
  permissions INT UNSIGNED NOT NULL DEFAULT 0,
  totp_secret VARCHAR(255) NULL,
  totp_last_step INT UNSIGNED NULL,
  disabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at INT UNSIGNED NOT NULL,
  last_login_at INT UNSIGNED NULL,
  password_changed_at INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_panel_norm (username_norm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panel_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(40) NOT NULL,
  permissions INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_groups_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS panel_user_groups (
  user_id INT UNSIGNED NOT NULL,
  group_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, group_id),
  CONSTRAINT fk_pug_user FOREIGN KEY (user_id) REFERENCES panel_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_pug_group FOREIGN KEY (group_id) REFERENCES panel_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  name VARCHAR(40) NOT NULL PRIMARY KEY,
  value VARCHAR(500) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket CHAR(64) NOT NULL PRIMARY KEY,
  hits INT UNSIGNED NOT NULL,
  reset_at INT UNSIGNED NOT NULL,
  KEY ix_rate_reset (reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  at INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NULL,
  panel_user_id INT UNSIGNED NULL,
  action VARCHAR(40) NOT NULL,
  detail VARCHAR(500) NOT NULL DEFAULT '',
  ip_hash CHAR(16) NOT NULL DEFAULT '',
  KEY ix_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Levels: the official main levels and the community levels. Every published state is an immutable
-- version (hash of the content); runs and scores refer to the exact version that was played.
CREATE TABLE IF NOT EXISTS levels (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id VARCHAR(32) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  code VARCHAR(16) NOT NULL,
  title VARCHAR(40) NOT NULL DEFAULT '',
  author_id INT UNSIGNED NULL,
  world TINYINT UNSIGNED NOT NULL DEFAULT 1,
  sort INT NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL,
  draft MEDIUMTEXT NOT NULL,
  draft_updated_at INT UNSIGNED NOT NULL,
  current_version_id INT UNSIGNED NULL,
  plays INT UNSIGNED NOT NULL DEFAULT 0,
  likes INT UNSIGNED NOT NULL DEFAULT 0,
  reports INT UNSIGNED NOT NULL DEFAULT 0,
  created_at INT UNSIGNED NOT NULL,
  published_at INT UNSIGNED NULL,
  UNIQUE KEY uq_levels_code (game_id, code),
  KEY ix_levels_list (game_id, kind, status),
  KEY ix_levels_author (author_id),
  CONSTRAINT fk_levels_author FOREIGN KEY (author_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS level_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level_id INT UNSIGNED NOT NULL,
  hash CHAR(64) NOT NULL,
  data MEDIUMTEXT NOT NULL,
  verified_ticks INT UNSIGNED NULL,
  created_at INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_versions (level_id, hash),
  CONSTRAINT fk_versions_level FOREIGN KEY (level_id) REFERENCES levels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS level_likes (
  level_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  PRIMARY KEY (level_id, account_id),
  CONSTRAINT fk_likes_level FOREIGN KEY (level_id) REFERENCES levels (id) ON DELETE CASCADE,
  CONSTRAINT fk_likes_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS level_reports (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NULL,
  reason VARCHAR(200) NOT NULL DEFAULT '',
  ip_hash CHAR(16) NOT NULL DEFAULT '',
  created_at INT UNSIGNED NOT NULL,
  handled TINYINT(1) NOT NULL DEFAULT 0,
  KEY ix_reports_open (handled, level_id),
  CONSTRAINT fk_reports_level FOREIGN KEY (level_id) REFERENCES levels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS level_plays (
  level_id INT UNSIGNED NOT NULL,
  ip_hash CHAR(16) NOT NULL,
  PRIMARY KEY (level_id, ip_hash),
  CONSTRAINT fk_plays_level FOREIGN KEY (level_id) REFERENCES levels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE TABLE IF NOT EXISTS runs (
  id CHAR(32) NOT NULL PRIMARY KEY,
  game_id VARCHAR(32) NOT NULL,
  level_code VARCHAR(16) NOT NULL,
  level_version_id INT UNSIGNED NOT NULL,
  purpose VARCHAR(8) NOT NULL DEFAULT 'score',
  account_id INT UNSIGNED NULL,
  issued_at INT UNSIGNED NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  ip_hash CHAR(16) NOT NULL DEFAULT '',
  KEY ix_runs_issued (issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE TABLE IF NOT EXISTS scores (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id VARCHAR(32) NOT NULL,
  level_code VARCHAR(16) NOT NULL,
  level_version_id INT UNSIGNED NOT NULL,
  account_id INT UNSIGNED NULL,
  player_key VARCHAR(40) NOT NULL,
  nickname VARCHAR(20) NOT NULL,
  time_ticks INT UNSIGNED NOT NULL,
  score INT UNSIGNED NOT NULL,
  coins INT UNSIGNED NOT NULL,
  replay MEDIUMTEXT NOT NULL,
  client VARCHAR(16) NOT NULL DEFAULT '',
  created_at INT UNSIGNED NOT NULL,
  ip_hash CHAR(16) NOT NULL DEFAULT '',
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  KEY ix_scores_time (level_version_id, hidden, time_ticks),
  KEY ix_scores_score (level_version_id, hidden, score),
  KEY ix_scores_player (player_key),
  KEY ix_scores_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
