<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Accounts\Accounts;
use App\Accounts\Totp;
use App\Config;
use App\Db;
use App\Game\LevelFormat;
use App\Game\Levels;
use App\Game\Scores;
use App\Http;
use App\Mailer;
use App\Panel\PanelUsers as P;
use App\Security;
use App\Settings;

/**
 * API of the admin panel /admin/ (session cookie "psid" + CSRF header).
 * Sign-in: password -> (forced new password) -> second factor (set up on first login) -> panel.
 * Every endpoint checks the permission it needs; every change is written to the history.
 */
final class AdminApi
{
    private const IDLE = 1800;
    private static array $me = [];

    public static function handle(string $path, string $method): never
    {
        Http::jsonHeaders();
        Security::startSession('admin');
        if ($method === 'POST') Http::checkCsrfHeader();
        $p = substr($path, strlen('/admin/api'));
        try {
            match ($method . ' ' . $p) {
                'GET /state' => self::state(),
                'POST /login' => self::login(),
                'POST /logout' => self::logout(),
                'POST /2fa' => self::twoFactor(),
                'GET /2fa/setup' => self::twoFactorSetupInfo(),
                'POST /2fa/setup' => self::twoFactorSetup(),
                'POST /password' => self::password(),
                default => self::panel($method, $p),
            };
        } catch (\Throwable $e) {
            error_log('admin: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
            Http::fail(500, 'server_error');
        }
    }

    // ------------------------------------------------------------------ sign-in
    /** @return array<string, mixed>|null */
    private static function sessionUser(): ?array
    {
        $id = $_SESSION['pid'] ?? null;
        if (!is_int($id)) return null;
        $u = P::byId($id);
        if ($u === null || (int) $u['disabled'] === 1 || (int) $u['password_changed_at'] > (int) ($_SESSION['p_auth'] ?? 0)
            || time() - (int) ($_SESSION['p_seen'] ?? 0) > self::IDLE) {
            $_SESSION = [];
            return null;
        }
        $_SESSION['p_seen'] = time();
        return $u;
    }

    private static function stage(?array $u): string
    {
        if ($u === null) return 'login';
        if ((int) $u['must_change_password'] === 1) return 'password';
        if ($u['totp_secret'] === null) return '2fa-setup';
        return empty($_SESSION['p_2fa']) ? '2fa' : 'ready';
    }

    private static function state(): never
    {
        $u = self::sessionUser();
        $stage = self::stage($u);
        Http::ok(['csrf' => Security::csrfToken(), 'stage' => $stage, 'game' => Config::gameName(),
            'user' => $u && $stage === 'ready' ? P::describe($u) : ($u ? ['username' => $u['username']] : null),
            'permissions' => P::PERMISSIONS, 'roles' => array_map(static fn($r) => ['name' => $r[0], 'permissions' => $r[1]], P::ROLES)]);
    }

    private static function login(): never
    {
        $u = P::login(Http::str('username', 40), Http::str('password', 300));
        if (is_string($u)) Http::fail(401, 'login_failed', ['message' => $u]);
        Security::renewSession();
        $_SESSION['pid'] = (int) $u['id'];
        $_SESSION['p_auth'] = time();
        $_SESSION['p_seen'] = time();
        Http::ok(['csrf' => Security::csrfToken(), 'stage' => self::stage($u)]);
    }

    private static function logout(): never
    {
        $_SESSION = [];
        Security::renewSession();
        Http::ok(['csrf' => Security::csrfToken()]);
    }

    private static function twoFactor(): never
    {
        $u = self::sessionUser() ?? Http::fail(401, 'login_required');
        if (self::stage($u) !== '2fa') Http::fail(400, 'wrong_stage');
        if (!Security::rateLimit('panel-2fa', 5, 900, 't:' . $u['id'])) Http::fail(429, 'too_many', ['message' => 'Zu viele Versuche.']);
        if (!P::verifyTotp($u, Http::str('code', 10))) {
            Security::panelAudit('panel_2fa_failed', (int) $u['id']);
            Http::fail(400, 'code_wrong', ['message' => 'Code falsch oder schon benutzt.']);
        }
        Security::renewSession();
        $_SESSION['p_2fa'] = true;
        Security::panelAudit('panel_login', (int) $u['id']);
        Http::ok(['csrf' => Security::csrfToken(), 'stage' => 'ready']);
    }

    private static function twoFactorSetupInfo(): never
    {
        $u = self::sessionUser() ?? Http::fail(401, 'login_required');
        if (self::stage($u) !== '2fa-setup') Http::fail(400, 'wrong_stage');
        $_SESSION['totp_new'] ??= Totp::newSecret();
        Http::ok(['secret' => $_SESSION['totp_new'], 'uri' => Totp::uri((string) $_SESSION['totp_new'], (string) $u['username'], Config::gameName() . ' Admin')]);
    }

    private static function twoFactorSetup(): never
    {
        $u = self::sessionUser() ?? Http::fail(401, 'login_required');
        if (self::stage($u) !== '2fa-setup' || empty($_SESSION['totp_new'])) Http::fail(400, 'wrong_stage');
        $step = Totp::verify((string) $_SESSION['totp_new'], Http::str('code', 10), null);
        if ($step === null) Http::fail(400, 'code_wrong', ['message' => 'Code falsch. Uhrzeit des Handys prüfen.']);
        Db::run('UPDATE panel_users SET totp_secret = ?, totp_last_step = ?, last_login_at = ? WHERE id = ?',
            [Security::encrypt((string) $_SESSION['totp_new']), $step, time(), $u['id']]);
        unset($_SESSION['totp_new']);
        Security::renewSession();
        $_SESSION['p_2fa'] = true;
        Security::panelAudit('panel_2fa_enabled', (int) $u['id']);
        Http::ok(['csrf' => Security::csrfToken(), 'stage' => 'ready']);
    }

    /** Forced change after an admin set the password, or voluntary change (needs the old one). */
    private static function password(): never
    {
        $u = self::sessionUser() ?? Http::fail(401, 'login_required');
        $stage = self::stage($u);
        if ($stage !== 'password' && ($stage !== 'ready' || !password_verify(Http::str('old', 300), (string) $u['password_hash']))) {
            Http::fail(400, 'login_failed', ['message' => 'Aktuelles Passwort falsch.']);
        }
        $e = P::setPassword((int) $u['id'], Http::str('new', 300), false);
        if ($e !== null) Http::fail(400, 'weak', ['message' => $e]);
        $_SESSION['p_auth'] = time() + 1;
        Security::panelAudit('panel_password', (int) $u['id']);
        Http::ok(['stage' => self::stage(P::byId((int) $u['id']))]);
    }

    // ------------------------------------------------------------------ panel
    private static function need(int $perm): void
    {
        if ((P::effective(self::$me) & $perm) !== $perm) Http::fail(403, 'forbidden', ['message' => 'Dafür fehlt dir das Recht.']);
    }

    private static function log(string $action, string $detail = ''): void
    {
        Security::panelAudit($action, (int) self::$me['id'], $detail);
    }

    private static function panel(string $method, string $p): never
    {
        $u = self::sessionUser();
        if ($u === null || self::stage($u) !== 'ready') Http::fail(401, 'login_required');
        self::$me = $u;
        if ($method === 'GET' && $p === '/overview') self::overview();
        // main levels
        if (str_starts_with($p, '/levels/main')) self::mainLevels($method, substr($p, strlen('/levels/main')));
        if (str_starts_with($p, '/levels/community')) self::community($method, substr($p, strlen('/levels/community')));
        if (str_starts_with($p, '/scores')) self::scores($method, substr($p, strlen('/scores')));
        if (str_starts_with($p, '/accounts')) self::accounts($method, substr($p, strlen('/accounts')));
        if (str_starts_with($p, '/users')) self::users($method, substr($p, strlen('/users')));
        if (str_starts_with($p, '/groups')) self::groups($method, substr($p, strlen('/groups')));
        if ($method === 'GET' && $p === '/audit') self::audit();
        if (str_starts_with($p, '/settings')) self::settings($method, substr($p, strlen('/settings')));
        Http::fail(404, 'not_found');
    }

    private static function overview(): never
    {
        $g = Config::gameId();
        $n = static fn(string $sql, array $a = []) => (int) (Db::one($sql, $a)['n'] ?? 0);
        Http::ok([
            'accounts' => $n('SELECT COUNT(*) AS n FROM accounts'),
            'mainLevels' => $n("SELECT COUNT(*) AS n FROM levels WHERE game_id = ? AND kind = 'main' AND status = 'published'", [$g]),
            'communityLevels' => $n("SELECT COUNT(*) AS n FROM levels WHERE game_id = ? AND kind = 'community' AND status = 'published'", [$g]),
            'openReports' => $n('SELECT COUNT(*) AS n FROM level_reports r JOIN levels l ON l.id = r.level_id WHERE r.handled = 0 AND l.game_id = ?', [$g]),
            'scores24h' => $n('SELECT COUNT(*) AS n FROM scores WHERE game_id = ? AND created_at > ?', [$g, time() - 86400]),
            'rejected24h' => $n("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('score_invalid','score_mismatch','score_too_fast') AND at > ?", [time() - 86400]),
            'mail' => Mailer::enabled(),
        ]);
    }

    // ------------------------------------------------------------------ main levels
    private static function mainLevels(string $method, string $rest): never
    {
        self::need(P::MAIN_LEVELS);
        $g = Config::gameId();
        if ($method === 'GET' && $rest === '') {
            $rows = Db::all("SELECT l.*, v.hash FROM levels l LEFT JOIN level_versions v ON v.id = l.current_version_id WHERE l.game_id = ? AND l.kind = 'main' ORDER BY l.sort, l.code", [$g]);
            Http::ok(['levels' => array_map(static function ($r) {
                $p = LevelFormat::split((string) $r['draft']);
                return ['id' => (string) $r['code'], 'title' => (string) $r['title'], 'world' => (int) $r['world'], 'status' => (string) $r['status'],
                    'changed' => $r['hash'] !== LevelFormat::hash($p['world'], $p['rows'], $p['signs']), 'updatedAt' => (int) $r['draft_updated_at'],
                    'publishedAt' => $r['published_at'] !== null ? (int) $r['published_at'] : null];
            }, $rows)]);
        }
        if ($method === 'POST' && $rest === '') {
            $code = Http::str('id', 8);
            if (!preg_match('/^\d{1,2}-\d{1,2}$/', $code)) Http::fail(400, 'bad_code', ['message' => 'Level-Nummer im Format Welt-Nummer, z. B. 5-1']);
            if (Levels::byCode($code) !== null) Http::fail(400, 'exists', ['message' => 'Diese Nummer gibt es schon.']);
            $world = max(1, min(4, Http::int('world', 1)));
            $rows = array_fill(0, LevelFormat::ROWS, '');
            $rows[12] = str_pad('', 3) . '@';
            $rows[12] .= str_repeat(' ', 30) . 'G';
            $rows[13] = str_repeat('#', 40);
            $rows[14] = str_repeat('#', 40);
            $max = (int) (Db::one("SELECT MAX(sort) AS m FROM levels WHERE game_id = ? AND kind = 'main'", [$g])['m'] ?? 0);
            Db::run("INSERT INTO levels (game_id, kind, code, title, world, sort, status, draft, draft_updated_at, created_at) VALUES (?, 'main', ?, ?, ?, ?, 'draft', ?, ?, ?)",
                [$g, $code, mb_substr(Http::str('title', 120), 0, 40), $world, $max + 10, LevelFormat::text($code, $world, $rows), time(), time()]);
            self::log('main_level_created', $code);
            Http::ok(['id' => $code]);
        }
        if ($method === 'POST' && $rest === '/order') {
            $codes = Http::body()['ids'] ?? [];
            if (!is_array($codes)) Http::fail(400, 'bad');
            foreach (array_values($codes) as $i => $c) {
                if (is_string($c)) Db::run("UPDATE levels SET sort = ? WHERE game_id = ? AND kind = 'main' AND code = ?", [($i + 1) * 10, $g, $c]);
            }
            self::log('main_levels_ordered', implode(',', array_filter($codes, 'is_string')));
            Http::ok();
        }
        if (!preg_match('#^/(\d{1,2}-\d{1,2})(/publish|/unpublish|/delete|/revert)?$#', $rest, $m)) Http::fail(404, 'not_found');
        $l = Levels::byCode($m[1]);
        if ($l === null || $l['kind'] !== 'main') Http::fail(404, 'not_found');
        $action = $m[2] ?? '';
        if ($method === 'GET' && $action === '') {
            $p = LevelFormat::split((string) $l['draft']);
            $versions = Db::all('SELECT id, hash, created_at FROM level_versions WHERE level_id = ? ORDER BY id DESC LIMIT 30', [$l['id']]);
            Http::ok(['id' => $l['code'], 'title' => $l['title'], 'world' => $p['world'], 'signs' => $p['signs'], 'rows' => $p['rows'],
                'status' => $l['status'], 'currentVersion' => $l['current_version_id'] !== null ? (int) $l['current_version_id'] : null,
                'versions' => array_map(static fn($v) => ['id' => (int) $v['id'], 'hash' => substr((string) $v['hash'], 0, 10), 'at' => (int) $v['created_at']], $versions)]);
        }
        if ($method !== 'POST') Http::fail(405, 'method');
        switch ($action) {
            case '':
                $rows = LevelFormat::rows(is_array(Http::body()['rows'] ?? null) ? Http::body()['rows'] : [], true);
                if (is_string($rows)) Http::fail(400, $rows, ['message' => self::levelError($rows)]);
                $world = max(1, min(4, Http::int('world', (int) $l['world'])));
                $signs = array_values(array_filter(is_array(Http::body()['signs'] ?? null) ? Http::body()['signs'] : [], static fn($s) => is_string($s) && preg_match('/^[a-z0-9._-]{1,40}$/', $s)));
                Db::run('UPDATE levels SET title = ?, world = ?, draft = ?, draft_updated_at = ? WHERE id = ?',
                    [mb_substr(trim(Http::str('title', 120)), 0, 40), $world, LevelFormat::text((string) $l['code'], $world, $rows, $signs), time(), $l['id']]);
                self::log('main_level_saved', (string) $l['code']);
                Http::ok();
            case '/publish':
                $v = Levels::draftVersion($l);
                Db::run("UPDATE levels SET status = 'published', current_version_id = ?, published_at = ? WHERE id = ?", [$v, time(), $l['id']]);
                self::log('main_level_published', $l['code'] . ' v' . $v);
                Http::ok(['version' => $v]);
            case '/unpublish':
                Db::run("UPDATE levels SET status = 'draft' WHERE id = ?", [$l['id']]);
                self::log('main_level_unpublished', (string) $l['code']);
                Http::ok();
            case '/delete':
                Levels::delete($l);
                self::log('main_level_deleted', (string) $l['code']);
                Http::ok();
            case '/revert':
                $v = Db::one('SELECT data FROM level_versions WHERE id = ? AND level_id = ?', [Http::int('version'), $l['id']]) ?? Http::fail(404, 'not_found');
                Db::run('UPDATE levels SET draft = ?, draft_updated_at = ? WHERE id = ?', [$v['data'], time(), $l['id']]);
                self::log('main_level_reverted', $l['code'] . ' v' . Http::int('version'));
                Http::ok();
        }
        Http::fail(404, 'not_found');
    }

    private static function levelError(string $key): string
    {
        return match ($key) {
            'level_height' => 'Ein Level ist genau 15 Reihen hoch.',
            'level_width' => 'Ein Level ist 20 bis 300 Felder breit.',
            'level_tiles' => 'Unbekanntes Zeichen im Level.',
            'level_start' => 'Es braucht genau einen Startpunkt (Pinguin).',
            'level_goal' => 'Es braucht genau ein Ziel (Iglu).',
            default => 'Ungültiges Level.',
        };
    }

    // ------------------------------------------------------------------ community
    private static function community(string $method, string $rest): never
    {
        self::need(P::COMMUNITY);
        $g = Config::gameId();
        if ($method === 'GET' && $rest === '') {
            $filter = Http::query('filter');
            $where = "l.game_id = ? AND l.kind = 'community'" . match ($filter) {
                'reported' => ' AND EXISTS (SELECT 1 FROM level_reports r WHERE r.level_id = l.id AND r.handled = 0)',
                'hidden' => " AND l.status = 'hidden'",
                'published' => " AND l.status = 'published'",
                default => '',
            };
            $params = [$g];
            $q = trim(Http::query('q', 60));
            if ($q !== '') {
                $where .= " AND (l.title LIKE ? ESCAPE '!' OR a.username LIKE ? ESCAPE '!' OR l.code = ?)";
                $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
                array_push($params, $like, $like, $q);
            }
            $rows = Db::all("SELECT l.*, a.username AS author, (SELECT COUNT(*) FROM level_reports r WHERE r.level_id = l.id AND r.handled = 0) AS open_reports
                FROM levels l JOIN accounts a ON a.id = l.author_id WHERE $where ORDER BY open_reports DESC, l.draft_updated_at DESC LIMIT 100", $params);
            Http::ok(['levels' => array_map(static fn($r) => ['id' => (string) $r['code'], 'title' => (string) $r['title'], 'author' => (string) $r['author'],
                'status' => (string) $r['status'], 'likes' => (int) $r['likes'], 'plays' => (int) $r['plays'], 'reports' => (int) $r['open_reports'],
                'publishedAt' => $r['published_at'] !== null ? (int) $r['published_at'] : null], $rows)]);
        }
        if (!preg_match('#^/(c\d{1,9})(/hide|/show|/delete|/reports-done)?$#', $rest, $m)) Http::fail(404, 'not_found');
        $l = Levels::byCode($m[1]);
        if ($l === null || $l['kind'] !== 'community') Http::fail(404, 'not_found');
        $action = $m[2] ?? '';
        if ($method === 'GET' && $action === '') {
            $p = LevelFormat::split((string) $l['draft']);
            $pub = $l['current_version_id'] !== null ? LevelFormat::split((string) Db::one('SELECT data FROM level_versions WHERE id = ?', [$l['current_version_id']])['data']) : null;
            Http::ok(['id' => $l['code'], 'title' => $l['title'], 'status' => $l['status'], 'world' => $p['world'], 'rows' => ($pub ?? $p)['rows'],
                'reports' => array_map(static fn($r) => ['id' => (int) $r['id'], 'reason' => (string) $r['reason'], 'at' => (int) $r['created_at'], 'handled' => (int) $r['handled'] === 1],
                    Db::all('SELECT * FROM level_reports WHERE level_id = ? ORDER BY id DESC LIMIT 50', [$l['id']]))]);
        }
        if ($method !== 'POST') Http::fail(405, 'method');
        match ($action) {
            '/hide' => Db::run("UPDATE levels SET status = 'hidden' WHERE id = ?", [$l['id']]),
            '/show' => Db::run("UPDATE levels SET status = CASE WHEN current_version_id IS NULL THEN 'draft' ELSE 'published' END WHERE id = ?", [$l['id']]),
            '/delete' => Levels::delete($l),
            '/reports-done' => Db::run('UPDATE level_reports SET handled = 1 WHERE level_id = ?', [$l['id']]),
            default => Http::fail(404, 'not_found'),
        };
        self::log('community_' . trim($action, '/'), $l['code'] . ' ' . $l['title']);
        Http::ok();
    }

    // ------------------------------------------------------------------ scores
    private static function scores(string $method, string $rest): never
    {
        self::need(P::SCORES);
        if ($method === 'GET' && $rest === '') {
            $q = trim(Http::query('q', 40));
            $level = Http::query('level', 16);
            $where = 's.game_id = ?';
            $params = [Config::gameId()];
            if ($q !== '') { $where .= " AND s.nickname LIKE ? ESCAPE '!'"; $params[] = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%'; }
            if ($level !== '') { $where .= ' AND s.level_code = ?'; $params[] = $level; }
            $rows = Db::all("SELECT s.id, s.level_code, s.nickname, s.account_id, s.time_ticks, s.score, s.client, s.created_at, s.hidden FROM scores s WHERE $where ORDER BY s.id DESC LIMIT 150", $params);
            Http::ok(['scores' => array_map(static fn($r) => ['id' => (int) $r['id'], 'level' => (string) $r['level_code'], 'name' => (string) $r['nickname'],
                'registered' => $r['account_id'] !== null, 'timeTicks' => (int) $r['time_ticks'], 'score' => (int) $r['score'], 'client' => (string) $r['client'],
                'at' => (int) $r['created_at'], 'hidden' => (int) $r['hidden'] === 1], $rows)]);
        }
        if ($method !== 'POST' || !preg_match('#^/(\d{1,10})/(hide|show|delete|verify)$#', $rest, $m)) Http::fail(404, 'not_found');
        $s = Db::one('SELECT * FROM scores WHERE id = ? AND game_id = ?', [(int) $m[1], Config::gameId()]) ?? Http::fail(404, 'not_found');
        if ($m[2] === 'verify') {
            $r = Scores::reverify($s);
            $ok = $r->completed && $r->timeTicks === (int) $s['time_ticks'] && $r->finalScore() === (int) $s['score'];
            Http::ok(['ok' => $ok, 'message' => $ok ? 'Lauf erneut geprüft: stimmt.' : "Lauf stimmt nicht mehr (Ziel erreicht: " . ($r->completed ? 'ja' : 'nein') . ", Zeit {$r->timeTicks}, Punkte {$r->finalScore()})."]);
        }
        match ($m[2]) {
            'hide', 'show' => Db::run('UPDATE scores SET hidden = ? WHERE id = ?', [$m[2] === 'hide' ? 1 : 0, $s['id']]),
            'delete' => Db::run('DELETE FROM scores WHERE id = ?', [$s['id']]),
        };
        self::log('score_' . $m[2], "#{$s['id']} {$s['nickname']} {$s['level_code']}");
        Http::ok();
    }

    // ------------------------------------------------------------------ player accounts
    private static function accounts(string $method, string $rest): never
    {
        self::need(P::ACCOUNTS);
        if ($method === 'GET' && $rest === '') {
            $q = strtolower(trim(Http::query('q', 40)));
            $rows = Db::all("SELECT a.*, (SELECT COUNT(*) FROM levels l WHERE l.author_id = a.id) AS levels, (SELECT COUNT(*) FROM scores s WHERE s.account_id = a.id) AS scores
                FROM accounts a WHERE a.username_norm LIKE ? ESCAPE '!' OR a.email LIKE ? ESCAPE '!' ORDER BY a.id DESC LIMIT 150",
                ['%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%', '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%']);
            Http::ok(['accounts' => array_map(static fn($r) => ['id' => (int) $r['id'], 'username' => (string) $r['username'],
                'email' => $r['email'] !== null ? (string) $r['email'] : null, 'emailVerified' => (int) $r['email_verified'] === 1,
                'disabled' => (int) $r['disabled'] === 1, 'createdAt' => (int) $r['created_at'],
                'lastLoginAt' => $r['last_login_at'] !== null ? (int) $r['last_login_at'] : null, 'levels' => (int) $r['levels'], 'scores' => (int) $r['scores']], $rows)]);
        }
        if ($method !== 'POST' || !preg_match('#^/(\d{1,10})/(disable|enable|reset|delete|hide-scores)$#', $rest, $m)) Http::fail(404, 'not_found');
        $a = Accounts::byId((int) $m[1]) ?? Http::fail(404, 'not_found');
        $extra = [];
        switch ($m[2]) {
            case 'disable':
            case 'enable':
                Db::run('UPDATE accounts SET disabled = ? WHERE id = ?', [$m[2] === 'disable' ? 1 : 0, $a['id']]);
                if ($m[2] === 'disable') Accounts::revokeAllTokens((int) $a['id']);
                break;
            case 'reset':
                // the player gets a new recovery code from the admin (out of band) and sets a new password with it
                $extra = ['recoveryCode' => Accounts::newRecoveryFor((int) $a['id'])];
                Accounts::revokeAllTokens((int) $a['id']);
                break;
            case 'delete':
                Accounts::delete((int) $a['id']);
                break;
            case 'hide-scores':
                Db::run('UPDATE scores SET hidden = 1 WHERE account_id = ?', [$a['id']]);
                break;
        }
        self::log('account_' . $m[2], "#{$a['id']} {$a['username']}");
        Http::ok(['ok' => true] + $extra);
    }

    // ------------------------------------------------------------------ panel users and groups
    private static function users(string $method, string $rest): never
    {
        self::need(P::USERS);
        if ($method === 'GET' && $rest === '') {
            Http::ok(['users' => array_map([P::class, 'describe'], Db::all('SELECT * FROM panel_users ORDER BY username_norm'))]);
        }
        if ($method === 'POST' && $rest === '') {
            $pw = Http::str('password', 300);
            $id = P::create(Http::str('username', 40), $pw, Http::str('role', 12), true, Http::str('displayName', 120));
            if (is_string($id)) Http::fail(400, 'bad', ['message' => $id]);
            self::log('panel_user_created', Http::str('username', 40) . ' (' . Http::str('role', 12) . ')');
            Http::ok(['id' => $id]);
        }
        if ($method !== 'POST' || !preg_match('#^/(\d{1,10})(/password|/reset-2fa|/delete)?$#', $rest, $m)) Http::fail(404, 'not_found');
        $u = P::byId((int) $m[1]) ?? Http::fail(404, 'not_found');
        $self = (int) $u['id'] === (int) self::$me['id'];
        // nobody but an owner changes an owner, and the last owner cannot lock himself out
        if ($u['role'] === 'owner' && self::$me['role'] !== 'owner') Http::fail(403, 'forbidden', ['message' => 'Nur ein Besitzer kann einen Besitzer ändern.']);
        switch ($m[2] ?? '') {
            case '':
                $role = Http::str('role', 12);
                if (!isset(P::ROLES[$role])) Http::fail(400, 'bad', ['message' => 'Unbekannte Stufe']);
                if ($role === 'owner' && self::$me['role'] !== 'owner') Http::fail(403, 'forbidden', ['message' => 'Nur ein Besitzer kann Besitzer ernennen.']);
                if ($self && ($role !== $u['role'] || Http::bool('disabled'))) Http::fail(400, 'bad', ['message' => 'Die eigene Stufe oder Sperre kannst du nicht ändern.']);
                Db::run('UPDATE panel_users SET role = ?, permissions = ?, display_name = ?, disabled = ? WHERE id = ?',
                    [$role, Http::int('permissions') & P::ALL, mb_substr(trim(Http::str('displayName', 120)), 0, 60), Http::bool('disabled') ? 1 : 0, $u['id']]);
                Db::run('DELETE FROM panel_user_groups WHERE user_id = ?', [$u['id']]);
                foreach ((array) (Http::body()['groups'] ?? []) as $gid) {
                    if (is_int($gid) && Db::one('SELECT id FROM panel_groups WHERE id = ?', [$gid])) Db::run('INSERT INTO panel_user_groups (user_id, group_id) VALUES (?, ?)', [$u['id'], $gid]);
                }
                self::log('panel_user_changed', "{$u['username']} → $role");
                Http::ok();
            case '/password':
                $e = P::setPassword((int) $u['id'], Http::str('password', 300), !$self);
                if ($e !== null) Http::fail(400, 'weak', ['message' => $e]);
                self::log('panel_user_password', (string) $u['username']);
                Http::ok();
            case '/reset-2fa':
                Db::run('UPDATE panel_users SET totp_secret = NULL, totp_last_step = NULL, password_changed_at = ? WHERE id = ?', [time(), $u['id']]);
                self::log('panel_user_2fa_reset', (string) $u['username']);
                Http::ok();
            case '/delete':
                if ($self) Http::fail(400, 'bad', ['message' => 'Du kannst dich nicht selbst löschen.']);
                Db::run('DELETE FROM panel_users WHERE id = ?', [$u['id']]);
                self::log('panel_user_deleted', (string) $u['username']);
                Http::ok();
        }
        Http::fail(404, 'not_found');
    }

    private static function groups(string $method, string $rest): never
    {
        self::need(P::GROUPS);
        if ($method === 'GET' && $rest === '') {
            Http::ok(['groups' => array_map(static fn($g) => ['id' => (int) $g['id'], 'name' => (string) $g['name'], 'permissions' => (int) $g['permissions'],
                'members' => array_column(Db::all('SELECT u.username FROM panel_user_groups ug JOIN panel_users u ON u.id = ug.user_id WHERE ug.group_id = ?', [$g['id']]), 'username')],
                Db::all('SELECT * FROM panel_groups ORDER BY name'))]);
        }
        $name = mb_substr(trim(Http::str('name', 120)), 0, 40);
        if ($method === 'POST' && $rest === '') {
            if ($name === '') Http::fail(400, 'bad', ['message' => 'Name fehlt']);
            try {
                Db::run('INSERT INTO panel_groups (name, permissions) VALUES (?, ?)', [$name, Http::int('permissions') & P::ALL]);
            } catch (\PDOException) {
                Http::fail(400, 'bad', ['message' => 'Diese Gruppe gibt es schon.']);
            }
            self::log('group_created', $name);
            Http::ok(['id' => Db::lastId()]);
        }
        if ($method !== 'POST' || !preg_match('#^/(\d{1,10})(/delete)?$#', $rest, $m)) Http::fail(404, 'not_found');
        $gr = Db::one('SELECT * FROM panel_groups WHERE id = ?', [(int) $m[1]]) ?? Http::fail(404, 'not_found');
        if (($m[2] ?? '') === '/delete') {
            Db::run('DELETE FROM panel_groups WHERE id = ?', [$gr['id']]);
            self::log('group_deleted', (string) $gr['name']);
        } else {
            Db::run('UPDATE panel_groups SET name = ?, permissions = ? WHERE id = ?', [$name ?: $gr['name'], Http::int('permissions') & P::ALL, $gr['id']]);
            self::log('group_changed', (string) ($name ?: $gr['name']));
        }
        Http::ok();
    }

    private static function audit(): never
    {
        self::need(P::AUDIT);
        $q = trim(Http::query('q', 60));
        $page = max(1, (int) Http::query('page'));
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
        $rows = Db::all("SELECT l.*, a.username AS account, p.username AS panel_user FROM audit_log l
            LEFT JOIN accounts a ON a.id = l.account_id LEFT JOIN panel_users p ON p.id = l.panel_user_id
            WHERE l.action LIKE ? ESCAPE '!' OR l.detail LIKE ? ESCAPE '!' OR a.username LIKE ? ESCAPE '!' OR p.username LIKE ? ESCAPE '!'
            ORDER BY l.id DESC LIMIT 100 OFFSET ?", [$like, $like, $like, $like, ($page - 1) * 100]);
        Http::ok(['entries' => array_map(static fn($r) => ['at' => (int) $r['at'], 'action' => (string) $r['action'], 'detail' => (string) $r['detail'],
            'account' => $r['account'], 'panelUser' => $r['panel_user'], 'ip' => (string) $r['ip_hash']], $rows)]);
    }

    private static function settings(string $method, string $rest): never
    {
        self::need(P::SETTINGS);
        if ($method === 'GET' && $rest === '') Http::ok(['settings' => Settings::all(), 'mail' => Mailer::enabled()]);
        if ($method === 'POST' && $rest === '') {
            $name = Http::str('name', 40);
            if (!array_key_exists($name, Settings::DEFAULTS)) Http::fail(400, 'bad');
            Settings::set($name, Http::bool('value') ? '1' : '0');
            self::log('setting_changed', $name . '=' . (Http::bool('value') ? 'an' : 'aus'));
            Http::ok();
        }
        if ($method === 'POST' && $rest === '/testmail') {
            try {
                Mailer::send(Http::str('to', 190), Config::gameName() . ': Test', "Diese Test-E-Mail kommt aus dem Admin-Panel. Der Versand funktioniert.");
            } catch (\Throwable $e) {
                Http::fail(400, 'mail', ['message' => 'Versand fehlgeschlagen: ' . $e->getMessage()]);
            }
            self::log('test_mail', Http::str('to', 190));
            Http::ok();
        }
        Http::fail(404, 'not_found');
    }
}
