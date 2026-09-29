<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Accounts\Accounts;
use App\Accounts\EmailCodes;
use App\Config;
use App\Db;
use App\Game\Levels;
use App\Http;
use App\Mailer;
use App\Security;
use App\Settings;

/**
 * API of the player account panel /konto/ (session cookie + CSRF header).
 * Players register, log in, add an optional e-mail address, reset passwords and manage their levels.
 */
final class KontoApi
{
    public static function handle(string $path, string $method): never
    {
        Http::jsonHeaders();
        Security::startSession('konto');
        if ($method === 'POST') Http::checkCsrfHeader();
        $p = substr($path, strlen('/konto/api'));
        try {
            if ($method === 'POST' && preg_match('#^/levels/(c\d{1,9})/(delete|unpublish)$#', $p, $m)) self::levelAction($m[1], $m[2]);
            match ($method . ' ' . $p) {
                'GET /state' => self::state(),
                'POST /login' => self::login(),
                'POST /register' => self::register(),
                'POST /logout' => self::logout(),
                'POST /email' => self::email(),
                'POST /email/confirm' => self::emailConfirm(),
                'POST /email/remove' => self::emailRemove(),
                'POST /password' => self::password(),
                'POST /recovery' => self::recovery(),
                'POST /delete' => self::delete(),
                'POST /forgot' => self::forgot(),
                'POST /forgot/confirm' => self::forgotConfirm(),
                'POST /recover' => self::recover(),
                'GET /levels' => self::levels(),
                'GET /scores' => self::scores(),
                default => Http::fail(404, 'not_found'),
            };
        } catch (\Throwable $e) {
            error_log('konto: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            Http::fail(500, 'server_error');
        }
    }

    private static function lang(): string
    {
        $l = Http::str('lang', 5);
        return in_array($l, ['de', 'fr'], true) ? $l : 'en';
    }

    /** @return array<string, mixed>|null */
    private static function user(): ?array
    {
        $id = $_SESSION['uid'] ?? null;
        if (!is_int($id)) return null;
        $u = Accounts::byId($id);
        if ($u === null || (int) $u['disabled'] === 1 || (int) $u['password_changed_at'] > (int) ($_SESSION['auth_at'] ?? 0)) {
            unset($_SESSION['uid']);
            return null;
        }
        return $u;
    }

    /** @return array<string, mixed> */
    private static function requireUser(): array
    {
        return self::user() ?? Http::fail(401, 'login_required');
    }

    private static function signIn(int $id): void
    {
        Security::renewSession();
        $_SESSION['uid'] = $id;
        $_SESSION['auth_at'] = time();
    }

    private static function err(string $key, int $status = 400): never
    {
        Http::fail($key === 'err.too_many' ? 429 : $status, substr($key, 4));
    }

    // ------------------------------------------------------------------
    private static function state(): never
    {
        $u = self::user();
        Http::ok([
            'csrf' => Security::csrfToken(), 'game' => Config::gameName(), 'mail' => Mailer::enabled(),
            'registration' => Settings::on('registration_open'),
            'user' => $u ? ['username' => $u['username'], 'email' => $u['email_verified'] ? $u['email'] : null, 'createdAt' => (int) $u['created_at']] : null,
        ]);
    }

    private static function login(): never
    {
        $acc = Accounts::login(Http::str('username', 40), Http::str('password', 300));
        if (is_string($acc)) self::err($acc, 401);
        self::signIn((int) $acc['id']);
        Security::audit('login', (int) $acc['id']);
        Http::ok(['csrf' => Security::csrfToken()]);
    }

    private static function register(): never
    {
        if (!Settings::on('registration_open')) Http::fail(403, 'registration_closed');
        if (!Security::rateLimit('register', 5, 3600)) Http::fail(429, 'too_many');
        $r = Accounts::register(Http::str('username', 40), Http::str('password', 300));
        if (is_string($r)) self::err($r);
        self::signIn($r['id']);
        $email = trim(Http::str('email', 200));
        $mailError = null;
        if ($email !== '') {
            $e = EmailCodes::requestVerify($r['id'], $email, self::lang());
            $mailError = $e !== null ? substr($e, 4) : null;
        }
        Http::ok(['csrf' => Security::csrfToken(), 'recoveryCode' => $r['recovery'], 'emailPending' => $email !== '' && $mailError === null, 'emailError' => $mailError]);
    }

    private static function logout(): never
    {
        $_SESSION = [];
        Security::renewSession();
        Http::ok(['csrf' => Security::csrfToken()]);
    }

    private static function email(): never
    {
        $u = self::requireUser();
        $e = EmailCodes::requestVerify((int) $u['id'], Http::str('email', 200), self::lang());
        if ($e !== null) self::err($e);
        Http::ok();
    }

    private static function emailConfirm(): never
    {
        $u = self::requireUser();
        $e = EmailCodes::confirmVerify((int) $u['id'], Http::str('code', 20));
        if ($e !== null) self::err($e);
        Http::ok();
    }

    private static function emailRemove(): never
    {
        $u = self::requireUser();
        if (!password_verify(Http::str('password', 300), (string) $u['password_hash'])) Http::fail(400, 'login_failed');
        EmailCodes::remove((int) $u['id']);
        Http::ok();
    }

    private static function password(): never
    {
        $u = self::requireUser();
        $e = Accounts::changePassword((int) $u['id'], Http::str('old', 300), Http::str('new', 300));
        if ($e !== null) self::err($e);
        self::signIn((int) $u['id']);
        $_SESSION['auth_at'] = time() + 1;
        Http::ok(['csrf' => Security::csrfToken()]);
    }

    private static function recovery(): never
    {
        $u = self::requireUser();
        if (!password_verify(Http::str('password', 300), (string) $u['password_hash'])) Http::fail(400, 'login_failed');
        Http::ok(['recoveryCode' => Accounts::newRecoveryFor((int) $u['id'])]);
    }

    private static function delete(): never
    {
        $u = self::requireUser();
        if (!password_verify(Http::str('password', 300), (string) $u['password_hash']) || !Http::bool('confirm')) Http::fail(400, 'login_failed');
        Accounts::delete((int) $u['id']);
        $_SESSION = [];
        Security::renewSession();
        Http::ok(['csrf' => Security::csrfToken()]);
    }

    private static function forgot(): never
    {
        $e = EmailCodes::requestReset(Http::str('who', 200), self::lang());
        if ($e !== null) self::err($e);
        Http::ok();
    }

    private static function forgotConfirm(): never
    {
        $e = EmailCodes::confirmReset(Http::str('who', 200), Http::str('code', 20), Http::str('password', 300));
        if ($e !== null) self::err($e);
        Http::ok();
    }

    private static function recover(): never
    {
        $new = null;
        $e = Accounts::recover(Http::str('username', 40), Http::str('code', 60), Http::str('password', 300), $new);
        if ($e !== null) self::err($e);
        Http::ok(['recoveryCode' => $new]);
    }

    private static function levels(): never
    {
        $u = self::requireUser();
        Http::ok(['levels' => array_map(static function ($l) { unset($l['rows']); return $l; }, Levels::mine((int) $u['id']))]);
    }

    private static function levelAction(string $code, string $action): never
    {
        $u = self::requireUser();
        $l = Levels::byCode($code);
        if ($l === null || (int) $l['author_id'] !== (int) $u['id']) Http::fail(404, 'not_found');
        if ($action === 'delete') Levels::delete($l); else Levels::unpublish($l);
        Http::ok();
    }

    private static function scores(): never
    {
        $u = self::requireUser();
        Http::ok(['scores' => array_map(static fn($r) => ['level' => (string) $r['level_code'], 'timeTicks' => (int) $r['time_ticks'],
            'score' => (int) $r['score'], 'at' => (int) $r['created_at']],
            Db::all('SELECT level_code, time_ticks, score, created_at FROM scores WHERE account_id = ? AND hidden = 0 ORDER BY created_at DESC LIMIT 50', [$u['id']]))]);
    }
}
