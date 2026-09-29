-- Schema for MySQL 8 / MariaDB 10.5+. Safe to run repeatedly (the setup page does that).
-- Account tables are game-independent so several games/apps can later share one login.

CREATE TABLE IF NOT EXISTS accounts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(20) NOT NULL,
  username_norm VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  recovery_hash VARCHAR(255) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  totp_secret VARCHAR(255) NULL,
  totp_last_step INT UNSIGNED NULL,
  disabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at INT UNSIGNED NOT NULL,
  last_login_at INT UNSIGNED NULL,
  password_changed_at INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_accounts_norm (username_norm)
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
  action VARCHAR(40) NOT NULL,
  detail VARCHAR(500) NOT NULL DEFAULT '',
  ip_hash CHAR(16) NOT NULL DEFAULT '',
  KEY ix_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runs (
  id CHAR(32) NOT NULL PRIMARY KEY,
  game_id VARCHAR(32) NOT NULL,
  level_id VARCHAR(16) NOT NULL,
  issued_at INT UNSIGNED NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  ip_hash CHAR(16) NOT NULL DEFAULT '',
  KEY ix_runs_issued (issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

CREATE TABLE IF NOT EXISTS scores (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id VARCHAR(32) NOT NULL,
  level_id VARCHAR(16) NOT NULL,
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
  KEY ix_scores_time (game_id, level_id, hidden, time_ticks),
  KEY ix_scores_score (game_id, level_id, hidden, score),
  KEY ix_scores_player (player_key),
  CONSTRAINT fk_scores_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
