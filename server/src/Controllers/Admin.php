<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Accounts\Accounts;
use App\Accounts\Totp;
use App\Config;
use App\Db;
use App\Replay\ReplayCodec;
use App\Replay\Runner;
use App\Game\Levels;
use App\Security;
use App\View;

/**
 * Admin area: only for admin accounts with a second factor (TOTP), with a short idle timeout.
 * Every action is written to the audit log.
 */
final class Admin
{
    private const IDLE = 1800;

    /** @return array<string, mixed> */
    private static function requireAdmin(): array
    {
        $u = Site::user();
        if ($u === null || (int) $u['is_admin'] !== 1 || !isset($_SESSION['admin_at']) || time() - (int) $_SESSION['admin_at'] > self::IDLE) {
            if ($u !== null && (int) $u['is_admin'] === 1) {
                // ask for the second factor again
                $_SESSION['pending_2fa'] = true;
                View::redirect('/login/2fa');
            }
            View::render('error', ['title' => '403', 'message' => t('err.forbidden')], 403);
        }
        $_SESSION['admin_at'] = time();
        return $u;
    }

    public static function dashboard(): never
    {
        self::requireAdmin();
        $q = is_string($_GET['q'] ?? null) ? mb_substr(trim($_GET['q']), 0, 20) : '';
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
        View::render('admin', [
            'title' => 'Admin',
            'q' => $q,
            'scores' => Db::all("SELECT id, level_id, nickname, account_id, time_ticks, score, created_at, hidden, client FROM scores WHERE game_id = ? AND nickname LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT 100", [Config::gameId(), $like]),
            'accounts' => Db::all("SELECT id, username, is_admin, disabled, created_at, last_login_at FROM accounts WHERE username_norm LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT 100", [strtolower($like)]),
            'audit' => Db::all('SELECT a.at, a.action, a.detail, a.ip_hash, c.username FROM audit_log a LEFT JOIN accounts c ON c.id = a.account_id ORDER BY a.id DESC LIMIT 100'),
        ]);
    }

    public static function scoreAction(): never
    {
        $admin = self::requireAdmin();
        $id = (int) ($_POST['id'] ?? 0);
        $action = (string) ($_POST['action'] ?? '');
        $row = Db::one('SELECT * FROM scores WHERE id = ? AND game_id = ?', [$id, Config::gameId()]);
        if ($row === null) View::redirect('/admin');
        switch ($action) {
            case 'hide':
            case 'show':
                Db::run('UPDATE scores SET hidden = ? WHERE id = ?', [$action === 'hide' ? 1 : 0, $id]);
                break;
            case 'delete':
                Db::run('DELETE FROM scores WHERE id = ?', [$id]);
                break;
            case 'verify':
                // re-run the stored replay (e.g. after a physics change) and report the outcome
                $r = Runner::run(Levels::load((string) $row['level_id']), ReplayCodec::decode((string) $row['replay']));
                $ok = $r->completed && $r->timeTicks === (int) $row['time_ticks'] && $r->finalScore() === (int) $row['score'];
                View::flash("#$id: " . ($ok ? 'replay OK' : "replay differs (completed=" . (int) $r->completed . ", ticks={$r->timeTicks}, score={$r->finalScore()})"), $ok ? 'ok' : 'error');
                View::redirect('/admin');
        }
        Security::audit('admin_score_' . $action, (int) $admin['id'], "score #$id {$row['nickname']} {$row['level_id']}");
        View::flash("#$id: $action");
        View::redirect('/admin');
    }

    public static function accountAction(): never
    {
        $admin = self::requireAdmin();
        $id = (int) ($_POST['id'] ?? 0);
        $action = (string) ($_POST['action'] ?? '');
        $acc = Accounts::byId($id);
        if ($acc === null || $id === (int) $admin['id']) { View::flash('Not possible for your own account.', 'error'); View::redirect('/admin'); }
        switch ($action) {
            case 'disable':
            case 'enable':
                Db::run('UPDATE accounts SET disabled = ? WHERE id = ?', [$action === 'disable' ? 1 : 0, $id]);
                if ($action === 'disable') Accounts::revokeAllTokens($id);
                break;
            case 'hide_scores':
                Db::run('UPDATE scores SET hidden = 1 WHERE account_id = ?', [$id]);
                break;
            case 'reset':
                // the player gets a new recovery code from the admin (out of band) and sets a new password with it
                $code = Accounts::newRecoveryFor($id);
                Accounts::revokeAllTokens($id);
                Security::audit('admin_account_reset', (int) $admin['id'], "account #$id {$acc['username']}");
                View::flash("New recovery code for {$acc['username']}: $code");
                View::redirect('/admin');
            case 'delete':
                Accounts::delete($id);
                break;
            default:
                View::redirect('/admin');
        }
        Security::audit('admin_account_' . $action, (int) $admin['id'], "account #$id {$acc['username']}");
        View::flash("{$acc['username']}: $action");
        View::redirect('/admin');
    }

    // ------------------------------------------------------------------ 2FA setup (first admin login)
    public static function setupForm(): never
    {
        $acc = self::pendingAdmin();
        if ($acc['totp_secret']) View::redirect('/login/2fa');
        $_SESSION['totp_new'] ??= Totp::newSecret();
        View::render('admin-2fa', ['title' => t('twofa.setup_title'), 'secret' => $_SESSION['totp_new'],
            'uri' => Totp::uri((string) $_SESSION['totp_new'], (string) $acc['username'], Config::gameName())]);
    }

    public static function setup2fa(): never
    {
        $acc = self::pendingAdmin();
        if ($acc['totp_secret'] || empty($_SESSION['totp_new'])) View::redirect('/login/2fa');
        $step = Totp::verify((string) $_SESSION['totp_new'], (string) ($_POST['code'] ?? ''), null);
        if ($step === null) {
            View::render('admin-2fa', ['title' => t('twofa.setup_title'), 'secret' => $_SESSION['totp_new'], 'error' => t('err.code_wrong'),
                'uri' => Totp::uri((string) $_SESSION['totp_new'], (string) $acc['username'], Config::gameName())], 400);
        }
        Db::run('UPDATE accounts SET totp_secret = ?, totp_last_step = ? WHERE id = ?', [Security::encrypt((string) $_SESSION['totp_new']), $step, $acc['id']]);
        unset($_SESSION['totp_new'], $_SESSION['pending_2fa']);
        Security::renewSession();
        $_SESSION['uid'] = (int) $acc['id'];
        $_SESSION['auth_at'] = time();
        $_SESSION['admin_at'] = time();
        Security::audit('2fa_enabled', (int) $acc['id']);
        View::redirect('/admin');
    }

    /** @return array<string, mixed> admin who passed the password step but not yet the 2FA step */
    private static function pendingAdmin(): array
    {
        $acc = is_int($_SESSION['uid'] ?? null) && !empty($_SESSION['pending_2fa']) ? Accounts::byId($_SESSION['uid']) : null;
        if ($acc === null || (int) $acc['is_admin'] !== 1) View::redirect('/login');
        return $acc;
    }
}
