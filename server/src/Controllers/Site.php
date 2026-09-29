<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Accounts\Accounts;
use App\Accounts\Totp;
use App\Config;
use App\Db;
use App\Game\Levels;
use App\Game\Scores;
use App\Security;
use App\View;

/** Website pages (EN/FR/DE): home + downloads, leaderboards, accounts, admin area, one-time setup. */
final class Site
{
    public static function handle(string $path, string $method): never
    {
        Security::startSession();
        View::initLang();
        if ($method === 'POST') Security::checkCsrf();
        if ($path !== '/setup' && !Db::isInstalled()) View::redirect('/setup');

        match ($method . ' ' . $path) {
            'GET /' => self::home(),
            'GET /leaderboard' => self::leaderboard(),
            'GET /privacy' => View::render('privacy', ['title' => t('nav.privacy')]),
            'POST /lang' => self::setLang(),
            'GET /register' => View::render('register', ['title' => t('nav.register')]),
            'POST /register' => self::register(),
            'GET /login' => View::render('login', ['title' => t('nav.login')]),
            'POST /login' => self::login(),
            'GET /login/2fa' => self::twoFactorForm(),
            'POST /login/2fa' => self::twoFactor(),
            'POST /logout' => self::logout(),
            'GET /recover' => View::render('recover', ['title' => t('recover.title')]),
            'POST /recover' => self::recover(),
            'GET /account' => self::account(),
            'POST /account/password' => self::changePassword(),
            'POST /account/recovery' => self::renewRecovery(),
            'POST /account/delete' => self::deleteAccount(),
            'GET /admin' => Admin::dashboard(),
            'POST /admin/score' => Admin::scoreAction(),
            'POST /admin/account' => Admin::accountAction(),
            'GET /admin/2fa' => Admin::setupForm(),
            'POST /admin/2fa' => Admin::setup2fa(),
            'GET /setup', 'POST /setup' => self::setup($method),
            default => View::render('error', ['title' => '404', 'message' => t('err.not_found')], 404),
        };
    }

    /** @return array<string, mixed>|null the logged-in account (fully authenticated, incl. 2FA for admins) */
    public static function user(): ?array
    {
        $id = $_SESSION['uid'] ?? null;
        if (!is_int($id) || !empty($_SESSION['pending_2fa'])) return null;
        static $cache = null;
        $cache ??= Accounts::byId($id);
        // password change elsewhere or disabled account ends this session
        if ($cache === null || (int) $cache['disabled'] === 1 || (int) $cache['password_changed_at'] > (int) ($_SESSION['auth_at'] ?? 0)) {
            $_SESSION = [];
            return null;
        }
        return $cache;
    }

    private static function requireUser(): array
    {
        return self::user() ?? View::redirect('/login');
    }

    // ------------------------------------------------------------------ public pages
    /** @return array<string, mixed>|null */
    public static function versionInfo(): ?array
    {
        $file = APP_ROOT . '/public/version.json';
        return is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: null) : null;
    }

    private static function home(): never
    {
        View::render('home', ['title' => Config::gameName(), 'version' => self::versionInfo()]);
    }

    private static function leaderboard(): never
    {
        $levels = array_keys(Levels::all());
        $level = is_string($_GET['level'] ?? null) && Levels::exists($_GET['level']) ? $_GET['level'] : ($levels[0] ?? '');
        $by = ($_GET['by'] ?? '') === 'score' ? 'score' : 'time';
        $entries = $level !== '' ? Scores::top($level, $by, 50) : [];
        View::render('leaderboard', ['title' => t('nav.leaderboard'), 'levels' => $levels, 'level' => $level, 'by' => $by, 'entries' => $entries]);
    }

    private static function setLang(): never
    {
        $lang = (string) ($_POST['lang'] ?? '');
        if (isset(View::LANGS[$lang])) {
            setcookie('lang', $lang, ['expires' => time() + 365 * 86400, 'path' => '/', 'secure' => Config::isHttps(), 'httponly' => true, 'samesite' => 'Lax']);
        }
        $back = (string) ($_POST['back'] ?? '/');
        View::redirect(preg_match('#^/[A-Za-z0-9/_?=&.-]*$#', $back) ? $back : '/');
    }

    // ------------------------------------------------------------------ accounts
    private static function register(): never
    {
        if (!Config::get('registration_open', true)) View::render('error', ['title' => t('nav.register'), 'message' => t('err.registration_closed')], 403);
        if (!Security::rateLimit('register', 5, 3600)) View::render('register', ['title' => t('nav.register'), 'error' => t('err.too_many')], 429);
        $username = (string) ($_POST['username'] ?? '');
        $pw = (string) ($_POST['password'] ?? '');
        if (!hash_equals($pw, (string) ($_POST['password2'] ?? ''))) View::render('register', ['title' => t('nav.register'), 'error' => t('err.password_mismatch'), 'username' => $username], 400);
        $r = Accounts::register($username, $pw);
        if (is_string($r)) View::render('register', ['title' => t('nav.register'), 'error' => t($r), 'username' => $username], 400);
        Security::renewSession();
        $_SESSION['uid'] = $r['id'];
        $_SESSION['auth_at'] = time();
        View::render('recovery-code', ['title' => t('recover.code_title'), 'code' => $r['recovery']]);
    }

    private static function login(): never
    {
        $acc = Accounts::login((string) ($_POST['username'] ?? ''), (string) ($_POST['password'] ?? ''));
        if (is_string($acc)) View::render('login', ['title' => t('nav.login'), 'error' => t($acc), 'username' => (string) ($_POST['username'] ?? '')], 400);
        Security::renewSession();
        $_SESSION['uid'] = (int) $acc['id'];
        $_SESSION['auth_at'] = time();
        if ((int) $acc['is_admin'] === 1) {
            // admins need a second factor; until then the session is not logged in
            $_SESSION['pending_2fa'] = true;
            View::redirect($acc['totp_secret'] ? '/login/2fa' : '/admin/2fa');
        }
        Security::audit('login', (int) $acc['id']);
        View::redirect('/account');
    }

    private static function twoFactorForm(): never
    {
        if (empty($_SESSION['pending_2fa'])) View::redirect('/login');
        View::render('login-2fa', ['title' => t('twofa.title')]);
    }

    private static function twoFactor(): never
    {
        if (empty($_SESSION['pending_2fa']) || !is_int($_SESSION['uid'] ?? null)) View::redirect('/login');
        $acc = Accounts::byId($_SESSION['uid']);
        if ($acc === null || !Security::rateLimit('2fa', 5, 900, 't:' . $acc['id'])) View::render('login-2fa', ['title' => t('twofa.title'), 'error' => t('err.too_many')], 429);
        if (!Accounts::verifyTotp($acc, (string) ($_POST['code'] ?? ''))) {
            Security::audit('2fa_failed', (int) $acc['id']);
            View::render('login-2fa', ['title' => t('twofa.title'), 'error' => t('err.code_wrong')], 400);
        }
        Security::renewSession();
        unset($_SESSION['pending_2fa']);
        $_SESSION['admin_at'] = time();
        Security::audit('admin_login', (int) $acc['id']);
        View::redirect('/admin');
    }

    private static function logout(): never
    {
        $_SESSION = [];
        Security::renewSession();
        View::redirect('/');
    }

    private static function recover(): never
    {
        $new = null;
        $pw = (string) ($_POST['password'] ?? '');
        if (!hash_equals($pw, (string) ($_POST['password2'] ?? ''))) View::render('recover', ['title' => t('recover.title'), 'error' => t('err.password_mismatch')], 400);
        $err = Accounts::recover((string) ($_POST['username'] ?? ''), (string) ($_POST['code'] ?? ''), $pw, $new);
        if ($err !== null) View::render('recover', ['title' => t('recover.title'), 'error' => t($err)], 400);
        View::render('recovery-code', ['title' => t('recover.code_title'), 'code' => $new, 'afterRecover' => true]);
    }

    private static function account(): never
    {
        $u = self::requireUser();
        View::render('account', ['title' => t('nav.account'), 'user' => $u,
            'scores' => Db::all('SELECT level_id, time_ticks, score, created_at FROM scores WHERE account_id = ? AND hidden = 0 ORDER BY created_at DESC LIMIT 30', [$u['id']])]);
    }

    private static function changePassword(): never
    {
        $u = self::requireUser();
        $new = (string) ($_POST['new'] ?? '');
        $err = !hash_equals($new, (string) ($_POST['new2'] ?? '')) ? 'err.password_mismatch' : Accounts::changePassword((int) $u['id'], (string) ($_POST['old'] ?? ''), $new);
        if ($err !== null) { View::flash(t($err), 'error'); View::redirect('/account'); }
        Security::renewSession();
        $_SESSION['uid'] = (int) $u['id'];
        $_SESSION['auth_at'] = time() + 1;
        View::flash(t('account.password_changed'));
        View::redirect('/account');
    }

    private static function renewRecovery(): never
    {
        $u = self::requireUser();
        if (!password_verify((string) ($_POST['password'] ?? ''), (string) $u['password_hash'])) { View::flash(t('err.login_failed'), 'error'); View::redirect('/account'); }
        View::render('recovery-code', ['title' => t('recover.code_title'), 'code' => Accounts::newRecoveryFor((int) $u['id'])]);
    }

    private static function deleteAccount(): never
    {
        $u = self::requireUser();
        if (!password_verify((string) ($_POST['password'] ?? ''), (string) $u['password_hash']) || ($_POST['confirm'] ?? '') !== 'yes') {
            View::flash(t('err.login_failed'), 'error');
            View::redirect('/account');
        }
        Accounts::delete((int) $u['id']);
        $_SESSION = [];
        Security::renewSession();
        View::flash(t('account.deleted'));
        View::redirect('/');
    }

    // ------------------------------------------------------------------ first-time setup
    /**
     * Creates the tables and the first admin. Requires the setup token from config.php and
     * locks itself once an admin exists.
     */
    private static function setup(string $method): never
    {
        $token = (string) Config::get('setup_token', '');
        if (strlen($token) < 24) View::render('error', ['title' => 'Setup', 'message' => "Set 'setup_token' (at least 24 characters) in config/config.php first."], 403);
        if (Db::isInstalled() && Db::one('SELECT id FROM accounts WHERE is_admin = 1 LIMIT 1') !== null) View::redirect('/');
        if ($method === 'GET') View::render('setup', ['title' => 'Setup']);
        if (!Security::rateLimitSafe('setup', 10, 3600)) View::render('setup', ['title' => 'Setup', 'error' => t('err.too_many')], 429);
        if (!hash_equals($token, (string) ($_POST['token'] ?? ''))) View::render('setup', ['title' => 'Setup', 'error' => 'Wrong setup token.'], 403);
        Db::migrate();
        $pw = (string) ($_POST['password'] ?? '');
        if (!hash_equals($pw, (string) ($_POST['password2'] ?? ''))) View::render('setup', ['title' => 'Setup', 'error' => t('err.password_mismatch')], 400);
        $r = Accounts::register((string) ($_POST['username'] ?? ''), $pw, true);
        if (is_string($r)) View::render('setup', ['title' => 'Setup', 'error' => t($r)], 400);
        View::flash(t('setup.done'));
        View::redirect('/login');
    }
}
