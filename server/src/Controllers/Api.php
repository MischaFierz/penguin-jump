<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Accounts\Accounts;
use App\Accounts\Nickname;
use App\Config;
use App\Game\Levels;
use App\Game\Scores;
use App\Security;

/**
 * JSON API used by the game (desktop, web, Android): /api/v1/...
 * Authentication with bearer tokens (no cookies -> no CSRF), JSON bodies only,
 * small body limit, rate limits on every write, CORS only for configured origins.
 */
final class Api
{
    public static function handle(string $path, string $method): never
    {
        Security::commonHeaders();
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
        self::cors();
        if ($method === 'OPTIONS') { http_response_code(204); exit; }

        try {
            $route = $method . ' ' . substr($path, strlen('/api/v1'));
            match ($route) {
                'GET /info' => self::info(),
                'POST /runs' => self::startRun(),
                'POST /scores' => self::submit(),
                'GET /scores' => self::scores(),
                'POST /auth/register' => self::register(),
                'POST /auth/login' => self::login(),
                'POST /auth/logout' => self::logout(),
                'GET /auth/me' => self::me(),
                default => self::fail(404, 'not_found'),
            };
        } catch (\Throwable $e) {
            error_log('API error: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            self::fail(500, 'server_error');
        }
    }

    private static function cors(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowed = (array) Config::get('api_cors_origins', ['https://appassets.androidplatform.net']);
        if ($origin !== '' && in_array($origin, $allowed, true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type, Authorization');
            header('Access-Control-Max-Age: 600');
        }
    }

    /** @param array<string, mixed> $data */
    private static function ok(array $data): never
    {
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        exit;
    }

    private static function fail(int $status, string $error): never
    {
        http_response_code($status);
        echo json_encode(['error' => $error]);
        exit;
    }

    /** @return array<string, mixed> */
    private static function body(): array
    {
        if (!str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'application/json')) self::fail(415, 'json_required');
        $raw = file_get_contents('php://input', false, null, 0, 262145);
        if ($raw === false || strlen($raw) > 262144) self::fail(413, 'too_large');
        try {
            $data = json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            self::fail(400, 'bad_json');
        }
        return is_array($data) ? $data : self::fail(400, 'bad_json');
    }

    private static function str(array $body, string $key, int $max = 200): string
    {
        $v = $body[$key] ?? '';
        return is_string($v) && strlen($v) <= $max ? $v : '';
    }

    private static function bearer(): ?string
    {
        $h = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        return preg_match('/^Bearer\s+([A-Za-z0-9_-]{20,100})$/', $h, $m) ? $m[1] : null;
    }

    /** @return array<string, mixed>|null */
    private static function account(): ?array
    {
        $t = self::bearer();
        if ($t === null) return null;
        return Accounts::byToken($t) ?? self::fail(401, 'bad_token');
    }

    // ------------------------------------------------------------------ endpoints
    private static function info(): never
    {
        self::ok(['name' => Config::gameName(), 'game' => Config::gameId(), 'levels' => array_keys(Levels::all())]);
    }

    private static function startRun(): never
    {
        $b = self::body();
        $level = self::str($b, 'level', 16);
        if (!Levels::exists($level)) self::fail(400, 'bad_level');
        if (!Security::rateLimit('run', 240, 3600)) self::fail(429, 'too_many');
        self::ok(['run' => Scores::startRun($level)]);
    }

    private static function submit(): never
    {
        $b = self::body();
        if (!Security::rateLimit('submit', 60, 3600)) self::fail(429, 'too_many');
        $level = self::str($b, 'level', 16);
        if (!Levels::exists($level)) self::fail(400, 'bad_level');
        $account = self::account();
        $nick = '';
        if ($account === null) {
            $err = Nickname::validate(self::str($b, 'nickname', 64), $nick);
            if ($err !== null) self::fail(400, substr($err, 4)); // nick_format / nick_bad / nick_taken
        }
        $claimed = is_array($b['result'] ?? null) ? $b['result'] : [];
        $r = Scores::submit(self::str($b, 'run', 40), $level, self::str($b, 'replay', 200000), $account, $nick, $claimed, self::str($b, 'client', 16));
        if (isset($r['error'])) self::fail(422, (string) $r['error']);
        self::ok($r);
    }

    private static function scores(): never
    {
        $level = is_string($_GET['level'] ?? null) ? $_GET['level'] : '';
        if (!Levels::exists($level)) self::fail(400, 'bad_level');
        $by = ($_GET['by'] ?? '') === 'score' ? 'score' : 'time';
        $limit = max(1, min(50, (int) ($_GET['limit'] ?? 10)));
        header('Cache-Control: public, max-age=15');
        self::ok(['level' => $level, 'by' => $by, 'entries' => Scores::top($level, $by, $limit)]);
    }

    private static function register(): never
    {
        $b = self::body();
        if (!Config::get('registration_open', true)) self::fail(403, 'registration_closed');
        if (!Security::rateLimit('register', 5, 3600)) self::fail(429, 'too_many');
        $r = Accounts::register(self::str($b, 'username', 40), self::str($b, 'password', 300));
        if (is_string($r)) self::fail(400, substr($r, 4));
        $token = Accounts::issueToken($r['id'], self::str($b, 'client', 32) ?: 'game');
        self::ok(['token' => $token, 'username' => self::str($b, 'username', 40), 'recoveryCode' => $r['recovery']]);
    }

    private static function login(): never
    {
        $b = self::body();
        $acc = Accounts::login(self::str($b, 'username', 40), self::str($b, 'password', 300));
        if (is_string($acc)) self::fail($acc === 'err.too_many' ? 429 : 401, substr($acc, 4));
        $token = Accounts::issueToken((int) $acc['id'], self::str($b, 'client', 32) ?: 'game');
        Security::audit('api_login', (int) $acc['id']);
        self::ok(['token' => $token, 'username' => $acc['username']]);
    }

    private static function logout(): never
    {
        $t = self::bearer();
        if ($t !== null) Accounts::revokeToken($t);
        self::ok(['ok' => true]);
    }

    private static function me(): never
    {
        $acc = self::account() ?? self::fail(401, 'no_token');
        self::ok(['username' => $acc['username']]);
    }
}
