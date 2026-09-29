<?php
declare(strict_types=1);

namespace App;

/**
 * Security building blocks: response headers, session hardening, CSRF protection,
 * rate limiting, audit log, secret encryption and privacy-friendly IP pseudonyms.
 */
final class Security
{
    /** Strict headers for every HTML page: no inline scripts/styles, no framing, no third parties. */
    public static function pageHeaders(): void
    {
        header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            . "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
            . (Config::isHttps() ? '; upgrade-insecure-requests' : ''));
        header('X-Frame-Options: DENY');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        self::commonHeaders();
    }

    public static function commonHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: same-origin');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
        if (Config::isHttps()) header('Strict-Transport-Security: max-age=63072000; includeSubDomains');
        header_remove('X-Powered-By');
    }

    // ------------------------------------------------------------------ session (website only; the API uses tokens)
    /** @param string $area 'konto' (players) or 'admin' (panel): separate cookies, so the two logins never mix */
    public static function startSession(string $area = 'konto'): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) return;
        $https = Config::isHttps();
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.use_trans_sid', '0');
        ini_set('session.sid_length', '48');
        ini_set('session.sid_bits_per_character', '6');
        ini_set('session.gc_maxlifetime', '7200');
        session_name(($https ? '__Host-' : '') . ($area === 'admin' ? 'psid' : 'sid'));
        session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
        session_start();
        $now = time();
        // idle timeout + absolute lifetime
        if (isset($_SESSION['_seen']) && ($now - (int) $_SESSION['_seen'] > 7200 || $now - (int) ($_SESSION['_born'] ?? $now) > 86400)) {
            $_SESSION = [];
            session_regenerate_id(true);
        }
        $_SESSION['_born'] ??= $now;
        $_SESSION['_seen'] = $now;
    }

    /** New session id after login/logout/privilege change (prevents session fixation). */
    public static function renewSession(): void
    {
        session_regenerate_id(true);
        $_SESSION['_born'] = time();
        unset($_SESSION['_csrf']);
    }

    // ------------------------------------------------------------------ CSRF
    public static function csrfToken(): string
    {
        if (empty($_SESSION['_csrf'])) $_SESSION['_csrf'] = bin2hex(random_bytes(32));
        return (string) $_SESSION['_csrf'];
    }

    /** Every state-changing form POST must carry the token and come from our own origin. */
    public static function checkCsrf(): void
    {
        $sent = (string) ($_POST['_csrf'] ?? '');
        $ok = $sent !== '' && isset($_SESSION['_csrf']) && hash_equals((string) $_SESSION['_csrf'], $sent);
        $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
        if ($origin !== null && $origin !== self::ownOrigin()) $ok = false;
        if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? 'same-origin') === 'cross-site') $ok = false;
        if (!$ok) {
            http_response_code(400);
            exit('Invalid or expired form. Please go back, reload the page and try again.');
        }
    }

    public static function ownOrigin(): string
    {
        return (Config::isHttps() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    }

    // ------------------------------------------------------------------ helpers
    public static function token(int $bytes = 32): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    /** Pseudonymised client IP (keyed hash, rotates daily): enough for abuse limits, useless for tracking. */
    public static function ipHash(bool $daily = true): string
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if (str_contains($ip, ':')) $ip = implode(':', array_slice(explode(':', $ip), 0, 4)); // IPv6: /64 prefix
        return substr(hash_hmac('sha256', $ip . ($daily ? gmdate('Y-m-d') : ''), Config::key('ip')), 0, 16);
    }

    /** @return bool true if allowed; counts one hit in the bucket (fixed window). */
    public static function rateLimit(string $name, int $max, int $windowSeconds, ?string $subject = null): bool
    {
        $bucket = hash('sha256', $name . '|' . ($subject ?? self::ipHash(false)));
        $now = time();
        if (random_int(1, 200) === 1) Db::run('DELETE FROM rate_limits WHERE reset_at < ?', [$now]);
        $row = Db::one('SELECT hits, reset_at FROM rate_limits WHERE bucket = ?', [$bucket]);
        if ($row === null || (int) $row['reset_at'] < $now) {
            Db::run('DELETE FROM rate_limits WHERE bucket = ?', [$bucket]);
            Db::run('INSERT INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)', [$bucket, $now + $windowSeconds]);
            return true;
        }
        if ((int) $row['hits'] >= $max) return false;
        Db::run('UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?', [$bucket]);
        return true;
    }

    /** Rate limit that also works before the tables exist (first-time setup). */
    public static function rateLimitSafe(string $name, int $max, int $windowSeconds): bool
    {
        try {
            return self::rateLimit($name, $max, $windowSeconds);
        } catch (\PDOException) {
            return true;
        }
    }

    public static function audit(string $action, ?int $accountId = null, string $detail = ''): void
    {
        Db::run('INSERT INTO audit_log (at, account_id, action, detail, ip_hash) VALUES (?, ?, ?, ?, ?)',
            [time(), $accountId, substr($action, 0, 40), mb_substr($detail, 0, 500), self::ipHash()]);
    }

    /** History entry for an action of an admin panel user. */
    public static function panelAudit(string $action, ?int $panelUserId, string $detail = ''): void
    {
        Db::run('INSERT INTO audit_log (at, panel_user_id, action, detail, ip_hash) VALUES (?, ?, ?, ?, ?)',
            [time(), $panelUserId, substr($action, 0, 40), mb_substr($detail, 0, 500), self::ipHash()]);
    }

    // ------------------------------------------------------------------ encryption of stored secrets (TOTP keys)
    public static function encrypt(string $plain): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        return base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, Config::key('secretbox')));
    }

    public static function decrypt(string $stored): ?string
    {
        $raw = base64_decode($stored, true);
        if ($raw === false || strlen($raw) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + 16) return null;
        $plain = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), Config::key('secretbox'));
        return $plain === false ? null : $plain;
    }
}
