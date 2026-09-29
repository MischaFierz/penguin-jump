<?php
declare(strict_types=1);

namespace App;

/** Helpers for the JSON APIs (game API, account panel, admin panel). */
final class Http
{
    public static function jsonHeaders(): void
    {
        Security::commonHeaders();
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    }

    /** @param array<string, mixed> $data */
    public static function ok(array $data = ['ok' => true]): never
    {
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        exit;
    }

    public static function fail(int $status, string $error, array $extra = []): never
    {
        http_response_code($status);
        echo json_encode(['error' => $error] + $extra);
        exit;
    }

    /** JSON body (max 512 KB); rejects everything that is not application/json. @return array<string, mixed> */
    public static function body(): array
    {
        static $cache = null;
        if ($cache !== null) return $cache;
        if (!str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) self::fail(415, 'json_required');
        $raw = file_get_contents('php://input', false, null, 0, 524289);
        if ($raw === false || strlen($raw) > 524288) self::fail(413, 'too_large');
        if ($raw === '') return $cache = [];
        try {
            $data = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            self::fail(400, 'bad_json');
        }
        return $cache = is_array($data) ? $data : self::fail(400, 'bad_json');
    }

    public static function str(string $key, int $max = 200): string
    {
        $v = self::body()[$key] ?? '';
        return is_string($v) && strlen($v) <= $max ? $v : '';
    }

    public static function int(string $key, int $default = 0): int
    {
        $v = self::body()[$key] ?? $default;
        return is_int($v) ? $v : (is_string($v) && preg_match('/^-?\d{1,9}$/', $v) ? (int) $v : $default);
    }

    public static function bool(string $key): bool
    {
        return (self::body()[$key] ?? false) === true;
    }

    public static function query(string $key, int $max = 100): string
    {
        $v = $_GET[$key] ?? '';
        return is_string($v) && strlen($v) <= $max ? $v : '';
    }

    /**
     * Session-based APIs (account and admin panel): state-changing requests must send the session's
     * CSRF token in a header and come from our own origin.
     */
    public static function checkCsrfHeader(): void
    {
        $sent = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
        $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
        if ($sent === '' || !isset($_SESSION['_csrf']) || !hash_equals((string) $_SESSION['_csrf'], $sent)
            || ($origin !== null && $origin !== Security::ownOrigin())
            || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? 'same-origin') === 'cross-site') {
            self::fail(403, 'csrf');
        }
    }
}
