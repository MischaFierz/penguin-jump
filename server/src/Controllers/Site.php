<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Config;
use App\Db;
use App\Game\Levels;
use App\Game\Scores;
use App\Panel\PanelUsers;
use App\Security;
use App\View;

/**
 * Public website pages (EN/FR/DE): home + downloads, leaderboards, community levels, privacy,
 * and the one-time setup. Player accounts live in /konto/, the admin panel in /admin/.
 */
final class Site
{
    public static function handle(string $path, string $method): never
    {
        Security::startSession('konto');
        View::initLang();
        if ($method === 'POST') Security::checkCsrf();
        if ($path !== '/setup' && !Db::isInstalled()) View::redirect('/setup');

        match ($method . ' ' . $path) {
            'GET /' => View::render('home', ['title' => Config::gameName(), 'version' => self::versionInfo()]),
            'GET /leaderboard' => self::leaderboard(),
            'GET /community' => self::community(),
            'GET /privacy' => View::render('privacy', ['title' => t('nav.privacy')]),
            'POST /lang' => self::setLang(),
            'GET /setup', 'POST /setup' => self::setup($method),
            default => View::render('error', ['title' => '404', 'message' => t('err.not_found')], 404),
        };
    }

    /** @return array<string, mixed>|null */
    public static function versionInfo(): ?array
    {
        $file = APP_ROOT . '/public/version.json';
        return is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: null) : null;
    }

    public static function loggedIn(): bool
    {
        return is_int($_SESSION['uid'] ?? null);
    }

    private static function leaderboard(): never
    {
        $levels = Levels::mainCodes();
        $want = is_string($_GET['level'] ?? null) ? $_GET['level'] : '';
        $level = Levels::exists($want) ? $want : ($levels[0] ?? '');
        $by = ($_GET['by'] ?? '') === 'score' ? 'score' : 'time';
        $entries = $level !== '' ? Scores::top($level, $by, 50) : [];
        $info = $level !== '' && str_starts_with($level, 'c') ? Levels::playable($level, null) : null;
        View::render('leaderboard', ['title' => t('nav.leaderboard'), 'levels' => $levels, 'level' => $level, 'by' => $by, 'entries' => $entries, 'community' => $info]);
    }

    private static function community(): never
    {
        $sort = in_array($_GET['sort'] ?? '', ['new', 'top', 'plays'], true) ? $_GET['sort'] : 'top';
        $q = is_string($_GET['q'] ?? null) ? mb_substr(trim($_GET['q']), 0, 40) : '';
        $page = max(1, min(500, (int) ($_GET['page'] ?? 1)));
        View::render('community', ['title' => t('nav.community'), 'sort' => $sort, 'q' => $q, 'page' => $page] + Levels::communityList($sort, $q, $page, null));
    }

    private static function setLang(): never
    {
        $lang = (string) ($_POST['lang'] ?? '');
        if (isset(View::LANGS[$lang])) {
            setcookie('lang', $lang, ['expires' => time() + 365 * 86400, 'path' => '/', 'secure' => Config::isHttps(), 'httponly' => false, 'samesite' => 'Lax']);
        }
        $back = (string) ($_POST['back'] ?? '/');
        View::redirect(preg_match('#^/[A-Za-z0-9/_?=&.%-]*$#', $back) ? $back : '/');
    }

    /**
     * Creates the tables, imports the 12 main levels and the first admin panel user (owner).
     * Requires the setup token from config.php and locks itself once a panel user exists.
     * Running it again later (with the token) only applies database updates.
     */
    private static function setup(string $method): never
    {
        $token = (string) Config::get('setup_token', '');
        if (strlen($token) < 24) View::render('error', ['title' => 'Setup', 'message' => "Set 'setup_token' (at least 24 characters) in config/config.php first."], 403);
        $installed = Db::isInstalled() && Db::one('SELECT id FROM panel_users LIMIT 1') !== null;
        if ($installed) {
            // updates after uploading a new version: /setup?update=<token> applies new tables/columns
            if (hash_equals($token, (string) ($_GET['update'] ?? ''))) { Db::migrate(); \App\Game\Levels::seedMain(); View::render('error', ['title' => 'Setup', 'message' => 'Datenbank ist auf dem neuesten Stand.']); }
            View::redirect('/admin/');
        }
        if ($method === 'GET') View::render('setup', ['title' => 'Setup']);
        if (!Security::rateLimitSafe('setup', 10, 3600)) View::render('setup', ['title' => 'Setup', 'error' => t('err.too_many')], 429);
        if (!hash_equals($token, (string) ($_POST['token'] ?? ''))) View::render('setup', ['title' => 'Setup', 'error' => 'Wrong setup token.'], 403);
        $pw = (string) ($_POST['password'] ?? '');
        if (!hash_equals($pw, (string) ($_POST['password2'] ?? ''))) View::render('setup', ['title' => 'Setup', 'error' => t('err.password_mismatch')], 400);
        Db::migrate();
        Levels::seedMain();
        $r = PanelUsers::create((string) ($_POST['username'] ?? ''), $pw, 'owner', false);
        if (is_string($r)) View::render('setup', ['title' => 'Setup', 'error' => $r], 400);
        Security::panelAudit('setup', $r, 'first owner created');
        View::redirect('/admin/');
    }
}
