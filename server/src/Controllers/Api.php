<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Accounts\Accounts;
use App\Accounts\Nickname;
use App\Config;
use App\Game\Levels;
use App\Game\Scores;
use App\Http;
use App\Mailer;
use App\Security;
use App\Settings;

/**
 * JSON API used by the games (desktop, web, Android): /api/v1/...
 * Authentication with bearer tokens (no cookies -> no CSRF), JSON bodies only,
 * rate limits on every write, CORS only for configured origins.
 */
final class Api
{
    public static function handle(string $path, string $method): never
    {
        Http::jsonHeaders();
        self::cors();
        if ($method === 'OPTIONS') { http_response_code(204); exit; }
        $p = substr($path, strlen('/api/v1'));
        try {
            if (preg_match('#^/community/(c\d{1,9})(/like|/report)?$#', $p, $m)) {
                match ($method . ($m[2] ?? '')) {
                    'GET' => self::communityLevel($m[1]),
                    'POST/like' => self::like($m[1]),
                    'POST/report' => self::report($m[1]),
                    default => Http::fail(404, 'not_found'),
                };
            }
            if (preg_match('#^/my/levels/(c\d{1,9})(/delete|/unpublish|/publish)?$#', $p, $m)) {
                match ($method . ($m[2] ?? '')) {
                    'POST' => self::saveLevel($m[1]),
                    'POST/delete' => self::deleteLevel($m[1]),
                    'POST/unpublish' => self::unpublishLevel($m[1]),
                    'POST/publish' => self::publishLevel($m[1]),
                    default => Http::fail(404, 'not_found'),
                };
            }
            match ($method . ' ' . $p) {
                'GET /info' => self::info(),
                'GET /levels/main' => self::mainLevels(),
                'GET /community' => self::community(),
                'GET /my/levels' => self::myLevels(),
                'POST /my/levels' => self::saveLevel(null),
                'POST /runs' => self::startRun(),
                'POST /scores' => self::submit(),
                'GET /scores' => self::scores(),
                'POST /auth/register' => self::register(),
                'POST /auth/login' => self::login(),
                'POST /auth/logout' => self::logout(),
                'GET /auth/me' => self::me(),
                'POST /auth/email' => self::emailRequest(),
                'POST /auth/email/confirm' => self::emailConfirm(),
                default => Http::fail(404, 'not_found'),
            };
        } catch (\Throwable $e) {
            error_log('API error: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            Http::fail(500, 'server_error');
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
        return Accounts::byToken($t) ?? Http::fail(401, 'bad_token');
    }

    /** @return array<string, mixed> */
    private static function requireAccount(): array
    {
        return self::account() ?? Http::fail(401, 'login_required');
    }

    // ------------------------------------------------------------------ general
    private static function info(): never
    {
        Http::ok(['name' => Config::gameName(), 'game' => Config::gameId(), 'mail' => Mailer::enabled(),
            'registration' => Settings::on('registration_open'), 'community' => Settings::on('community_open')]);
    }

    /** The published main levels; the games cache them and use them instead of the built-in ones. */
    private static function mainLevels(): never
    {
        $pack = Levels::mainPack();
        $etag = '"' . $pack['version'] . '"';
        header('ETag: ' . $etag);
        header('Cache-Control: no-cache');
        if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $etag) { http_response_code(304); exit; }
        Http::ok($pack);
    }

    // ------------------------------------------------------------------ community
    private static function community(): never
    {
        $acc = self::account();
        $sort = in_array(Http::query('sort'), ['new', 'top', 'plays'], true) ? Http::query('sort') : 'new';
        $page = max(1, min(500, (int) Http::query('page')));
        Http::ok(Levels::communityList($sort, mb_substr(trim(Http::query('q', 60)), 0, 40), $page, $acc ? (int) $acc['id'] : null));
    }

    private static function communityLevel(string $code): never
    {
        $acc = self::account();
        $l = Levels::playable($code, $acc ? (int) $acc['id'] : null);
        if ($l === null) Http::fail(404, 'not_found');
        Http::ok($l);
    }

    private static function like(string $code): never
    {
        $acc = self::requireAccount();
        if (!Security::rateLimit('like', 120, 3600, 'l:' . $acc['id'])) Http::fail(429, 'too_many');
        $l = Levels::byCode($code);
        if ($l === null || $l['status'] !== 'published' || $l['kind'] !== 'community') Http::fail(404, 'not_found');
        Http::ok(Levels::toggleLike($l, (int) $acc['id']));
    }

    private static function report(string $code): never
    {
        Http::body();
        $acc = self::account();
        if (!Security::rateLimit('report', 20, 3600)) Http::fail(429, 'too_many');
        $l = Levels::byCode($code);
        if ($l === null || $l['kind'] !== 'community') Http::fail(404, 'not_found');
        Levels::report($l, $acc ? (int) $acc['id'] : null, Http::str('reason', 600));
        Http::ok();
    }

    // ------------------------------------------------------------------ own levels (editor)
    private static function myLevels(): never
    {
        $acc = self::requireAccount();
        Http::ok(['levels' => Levels::mine((int) $acc['id'])]);
    }

    private static function saveLevel(?string $code): never
    {
        $acc = self::requireAccount();
        if (!Security::rateLimit('save-level', 240, 3600, 's:' . $acc['id'])) Http::fail(429, 'too_many');
        $tiles = Http::body()['rows'] ?? null;
        if (!is_array($tiles)) Http::fail(400, 'level_format');
        $r = Levels::saveDraft((int) $acc['id'], $code, Http::str('title', 200), Http::int('world', 1), $tiles);
        if (is_string($r)) Http::fail($r === 'not_found' ? 404 : 400, $r);
        Http::ok(['id' => (string) $r['code'], 'status' => (string) $r['status']]);
    }

    /** @return array<string, mixed> */
    private static function ownLevel(string $code, array $acc): array
    {
        $l = Levels::byCode($code);
        if ($l === null || (int) $l['author_id'] !== (int) $acc['id']) Http::fail(404, 'not_found');
        return $l;
    }

    private static function deleteLevel(string $code): never
    {
        $acc = self::requireAccount();
        Levels::delete(self::ownLevel($code, $acc));
        Http::ok();
    }

    private static function unpublishLevel(string $code): never
    {
        $acc = self::requireAccount();
        Levels::unpublish(self::ownLevel($code, $acc));
        Http::ok();
    }

    /** The author sends a run of the current draft; if the server can replay it to the goal, the level goes public. */
    private static function publishLevel(string $code): never
    {
        $acc = self::requireAccount();
        if (!Settings::on('community_open')) Http::fail(403, 'community_closed');
        $claimed = is_array(Http::body()['result'] ?? null) ? Http::body()['result'] : [];
        $r = Scores::verifyAndPublish(Http::str('run', 40), $code, Http::str('replay', 400000), $acc, $claimed);
        if (isset($r['error'])) Http::fail(422, (string) $r['error']);
        Http::ok($r);
    }

    // ------------------------------------------------------------------ runs and scores
    private static function startRun(): never
    {
        $purpose = Http::str('purpose', 10) === 'verify' ? 'verify' : 'score';
        $acc = $purpose === 'verify' ? self::requireAccount() : null;
        if (!Security::rateLimit('run', 300, 3600)) Http::fail(429, 'too_many');
        $r = Scores::startRun(Http::str('level', 16), $purpose, $acc ? (int) $acc['id'] : null);
        if (is_array($r)) Http::fail($r['error'] === 'not_found' ? 404 : 400, $r['error']);
        Http::ok(['run' => $r]);
    }

    private static function submit(): never
    {
        Http::body();
        if (!Settings::on('leaderboards_open')) Http::fail(403, 'leaderboards_closed');
        if (!Security::rateLimit('submit', 60, 3600)) Http::fail(429, 'too_many');
        $level = Http::str('level', 16);
        if (!Levels::exists($level)) Http::fail(400, 'bad_level');
        $account = self::account();
        $nick = '';
        if ($account === null) {
            $err = Nickname::validate(Http::str('nickname', 64), $nick);
            if ($err !== null) Http::fail(400, substr($err, 4)); // nick_format / nick_bad / nick_taken
        }
        $claimed = is_array(Http::body()['result'] ?? null) ? Http::body()['result'] : [];
        $r = Scores::submit(Http::str('run', 40), $level, Http::str('replay', 400000), $account, $nick, $claimed, Http::str('client', 16));
        if (isset($r['error'])) Http::fail(422, (string) $r['error']);
        Http::ok($r);
    }

    private static function scores(): never
    {
        $level = Http::query('level', 16);
        if (!Levels::exists($level)) Http::fail(400, 'bad_level');
        $by = Http::query('by') === 'score' ? 'score' : 'time';
        $limit = max(1, min(50, (int) (Http::query('limit') ?: 10)));
        header('Cache-Control: public, max-age=15');
        Http::ok(['level' => $level, 'by' => $by, 'entries' => Scores::top($level, $by, $limit)]);
    }

    // ------------------------------------------------------------------ accounts (games)
    private static function register(): never
    {
        Http::body();
        if (!Settings::on('registration_open')) Http::fail(403, 'registration_closed');
        if (!Security::rateLimit('register', 5, 3600)) Http::fail(429, 'too_many');
        $r = Accounts::register(Http::str('username', 40), Http::str('password', 300));
        if (is_string($r)) Http::fail(400, substr($r, 4));
        $email = trim(Http::str('email', 200));
        $mailError = null;
        if ($email !== '') {
            $e = \App\Accounts\EmailCodes::requestVerify($r['id'], $email, in_array(Http::str('lang', 5), ['de', 'fr'], true) ? Http::str('lang', 5) : 'en');
            $mailError = $e !== null ? substr($e, 4) : null;
        }
        $token = Accounts::issueToken($r['id'], Http::str('client', 32) ?: 'game');
        Http::ok(['token' => $token, 'username' => Http::str('username', 40), 'recoveryCode' => $r['recovery'],
            'emailPending' => $email !== '' && $mailError === null, 'emailError' => $mailError]);
    }

    private static function login(): never
    {
        Http::body();
        $acc = Accounts::login(Http::str('username', 40), Http::str('password', 300));
        if (is_string($acc)) Http::fail($acc === 'err.too_many' ? 429 : 401, substr($acc, 4));
        $token = Accounts::issueToken((int) $acc['id'], Http::str('client', 32) ?: 'game');
        Security::audit('api_login', (int) $acc['id']);
        Http::ok(['token' => $token, 'username' => $acc['username']]);
    }

    private static function logout(): never
    {
        $t = self::bearer();
        if ($t !== null) Accounts::revokeToken($t);
        Http::ok();
    }

    private static function emailRequest(): never
    {
        $acc = self::requireAccount();
        $lang = in_array(Http::str('lang', 5), ['de', 'fr'], true) ? Http::str('lang', 5) : 'en';
        $e = AppAccountsEmailCodes::requestVerify((int) $acc['id'], Http::str('email', 200), $lang);
        if ($e !== null) Http::fail($e === 'err.too_many' ? 429 : 400, substr($e, 4));
        Http::ok();
    }

    private static function emailConfirm(): never
    {
        $acc = self::requireAccount();
        $e = AppAccountsEmailCodes::confirmVerify((int) $acc['id'], Http::str('code', 20));
        if ($e !== null) Http::fail($e === 'err.too_many' ? 429 : 400, substr($e, 4));
        Http::ok();
    }

    private static function me(): never
    {
        $acc = self::account() ?? Http::fail(401, 'no_token');
        Http::ok(['username' => $acc['username'], 'email' => $acc['email_verified'] ? $acc['email'] : null]);
    }
}
