<?php
declare(strict_types=1);

namespace App\Accounts;

use App\Db;
use App\Security;

/**
 * Player accounts. Deliberately independent of any game: the tables (accounts, auth_tokens)
 * can later serve several games and apps with one login.
 * No e-mail or other personal data: username + password, plus a one-time recovery code.
 */
final class Accounts
{
    public const TOKEN_DAYS = 90;
    private const COMMON = ['password', 'passwort', 'motdepasse', '1234567890', '12345678910', 'qwertzuiop', 'qwertyuiop', 'azertyuiop',
        'iloveyou12', 'password12', 'password123', 'passwort123', 'abcdefghij', '0123456789', 'letmein123', 'welcome123'];

    /** @return string|null error key, or null when valid */
    public static function validateUsername(string $name): ?string
    {
        if (!preg_match('/^[A-Za-z0-9_-]{3,20}$/', $name)) return 'err.username_format';
        if (Nickname::isOffensive($name) || Nickname::isReserved($name)) return 'err.username_taken';
        return null;
    }

    public static function validatePassword(string $pw, string $username = ''): ?string
    {
        $len = mb_strlen($pw);
        if ($len < 10) return 'err.password_short';
        if ($len > 128 || (!defined('PASSWORD_ARGON2ID') && strlen($pw) > 72)) return 'err.password_long';
        $low = mb_strtolower($pw);
        if (in_array($low, self::COMMON, true) || ($username !== '' && str_contains($low, strtolower($username)))) return 'err.password_weak';
        if (count(array_unique(mb_str_split($pw))) < 4) return 'err.password_weak';
        return null;
    }

    public static function hash(string $pw): string
    {
        return defined('PASSWORD_ARGON2ID')
            ? password_hash($pw, PASSWORD_ARGON2ID, ['memory_cost' => 65536, 'time_cost' => 3, 'threads' => 1])
            : password_hash($pw, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    private static function needsRehash(string $hash): bool
    {
        return defined('PASSWORD_ARGON2ID')
            ? password_needs_rehash($hash, PASSWORD_ARGON2ID, ['memory_cost' => 65536, 'time_cost' => 3, 'threads' => 1])
            : password_needs_rehash($hash, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    public static function newRecoveryCode(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code = '';
        for ($i = 0; $i < 20; $i++) $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        return implode('-', str_split($code, 5));
    }

    private static function normCode(string $code): string
    {
        return strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', $code));
    }

    /** @return array{id: int, recovery: string}|string account + recovery code, or an error key */
    public static function register(string $username, string $password): array|string
    {
        if ($e = self::validateUsername($username)) return $e;
        if ($e = self::validatePassword($password, $username)) return $e;
        $norm = strtolower($username);
        if (Db::one('SELECT id FROM accounts WHERE username_norm = ?', [$norm]) !== null) return 'err.username_taken';
        $recovery = self::newRecoveryCode();
        $now = time();
        try {
            Db::run('INSERT INTO accounts (username, username_norm, password_hash, recovery_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?)',
                [$username, $norm, self::hash($password), self::hash(self::normCode($recovery)), $now, $now]);
        } catch (\PDOException) {
            return 'err.username_taken'; // unique index race
        }
        $id = Db::lastId();
        Security::audit('register', $id, $username);
        return ['id' => $id, 'recovery' => $recovery];
    }

    /** Sets a new password after an e-mail code was confirmed (see EmailCodes). */
    public static function setPassword(int $id, string $new): ?string
    {
        $acc = self::byId($id);
        if ($acc === null) return 'err.login_failed';
        if ($e = self::validatePassword($new, (string) $acc['username'])) return $e;
        Db::run('UPDATE accounts SET password_hash = ?, password_changed_at = ? WHERE id = ?', [self::hash($new), time(), $id]);
        self::revokeAllTokens($id);
        Security::audit('password_reset_email', $id);
        return null;
    }

    /**
     * Password check with brute-force protection (per IP and per account) and constant work
     * for unknown usernames.
     * @return array<string, mixed>|string account row or error key
     */
    public static function login(string $username, string $password): array|string
    {
        $norm = strtolower(trim($username));
        if (!Security::rateLimit('login-ip', 30, 900) || !Security::rateLimit('login-user', 10, 900, 'u:' . $norm)) return 'err.too_many';
        $acc = preg_match('/^[a-z0-9_-]{3,20}$/', $norm) ? Db::one('SELECT * FROM accounts WHERE username_norm = ?', [$norm]) : null;
        // unknown user: verify against a fresh hash anyway so the response time reveals nothing
        $ok = password_verify($password, (string) ($acc['password_hash'] ?? self::hash(bin2hex(random_bytes(8)))));
        if ($acc === null || !$ok) {
            Security::audit('login_failed', $acc !== null ? (int) $acc['id'] : null, substr($norm, 0, 20));
            return 'err.login_failed';
        }
        if ((int) $acc['disabled'] === 1) return 'err.account_disabled';
        if (self::needsRehash((string) $acc['password_hash'])) Db::run('UPDATE accounts SET password_hash = ? WHERE id = ?', [self::hash($password), $acc['id']]);
        Db::run('UPDATE accounts SET last_login_at = ? WHERE id = ?', [time(), $acc['id']]);
        return $acc;
    }

    /** @return string|null error key; on success the new recovery code is returned via $newRecovery */
    public static function recover(string $username, string $code, string $newPassword, ?string &$newRecovery): ?string
    {
        $norm = strtolower(trim($username));
        if (!Security::rateLimit('recover-ip', 10, 3600) || !Security::rateLimit('recover-user', 5, 3600, 'r:' . $norm)) return 'err.too_many';
        $acc = Db::one('SELECT * FROM accounts WHERE username_norm = ?', [$norm]);
        $ok = password_verify(self::normCode($code), (string) ($acc['recovery_hash'] ?? self::hash(bin2hex(random_bytes(8)))));
        if ($acc === null || !$ok) {
            Security::audit('recover_failed', $acc !== null ? (int) $acc['id'] : null);
            return 'err.recover_failed';
        }
        if ($e = self::validatePassword($newPassword, (string) $acc['username'])) return $e;
        $newRecovery = self::newRecoveryCode();
        Db::run('UPDATE accounts SET password_hash = ?, recovery_hash = ?, password_changed_at = ? WHERE id = ?',
            [self::hash($newPassword), self::hash(self::normCode($newRecovery)), time(), $acc['id']]);
        self::revokeAllTokens((int) $acc['id']);
        Security::audit('recovered', (int) $acc['id']);
        return null;
    }

    public static function changePassword(int $id, string $old, string $new): ?string
    {
        $acc = self::byId($id);
        if ($acc === null || !password_verify($old, (string) $acc['password_hash'])) return 'err.login_failed';
        if ($e = self::validatePassword($new, (string) $acc['username'])) return $e;
        Db::run('UPDATE accounts SET password_hash = ?, password_changed_at = ? WHERE id = ?', [self::hash($new), time(), $id]);
        self::revokeAllTokens($id);
        Security::audit('password_changed', $id);
        return null;
    }

    public static function newRecoveryFor(int $id): string
    {
        $code = self::newRecoveryCode();
        Db::run('UPDATE accounts SET recovery_hash = ? WHERE id = ?', [self::hash(self::normCode($code)), $id]);
        Security::audit('recovery_renewed', $id);
        return $code;
    }

    /** Deletes the account and everything linked to it (right to erasure). */
    public static function delete(int $id): void
    {
        Db::tx(function () use ($id): void {
            Db::run('DELETE FROM scores WHERE account_id = ?', [$id]);
            // scores on the player's own levels go with them (the levels themselves cascade)
            Db::run("DELETE FROM scores WHERE level_code IN (SELECT code FROM levels WHERE author_id = ? AND kind = 'community')", [$id]);
            Db::run('DELETE FROM auth_tokens WHERE account_id = ?', [$id]);
            Db::run('DELETE FROM accounts WHERE id = ?', [$id]);
        });
        Security::audit('account_deleted', $id);
    }

    /** @return array<string, mixed>|null */
    public static function byId(int $id): ?array
    {
        return Db::one('SELECT * FROM accounts WHERE id = ?', [$id]);
    }

    // ------------------------------------------------------------------ API tokens (game clients)
    public static function issueToken(int $accountId, string $client): string
    {
        $token = Security::token(32);
        $now = time();
        Db::run('INSERT INTO auth_tokens (account_id, token_hash, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
            [$accountId, hash('sha256', $token), substr(preg_replace('/[^a-z0-9-]/', '', strtolower($client)) ?: 'game', 0, 32), $now, $now + self::TOKEN_DAYS * 86400]);
        if (random_int(1, 50) === 1) Db::run('DELETE FROM auth_tokens WHERE expires_at < ?', [$now]);
        return $token;
    }

    /** @return array<string, mixed>|null the account for a valid bearer token */
    public static function byToken(string $token): ?array
    {
        if (strlen($token) < 20 || strlen($token) > 100) return null;
        $row = Db::one('SELECT a.*, t.id AS token_id FROM auth_tokens t JOIN accounts a ON a.id = t.account_id WHERE t.token_hash = ? AND t.expires_at > ? AND a.disabled = 0',
            [hash('sha256', $token), time()]);
        if ($row !== null) Db::run('UPDATE auth_tokens SET last_used_at = ? WHERE id = ?', [time(), $row['token_id']]);
        return $row;
    }

    public static function revokeToken(string $token): void
    {
        Db::run('DELETE FROM auth_tokens WHERE token_hash = ?', [hash('sha256', $token)]);
    }

    public static function revokeAllTokens(int $accountId): void
    {
        Db::run('DELETE FROM auth_tokens WHERE account_id = ?', [$accountId]);
    }
}
