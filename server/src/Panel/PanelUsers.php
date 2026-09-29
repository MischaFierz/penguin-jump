<?php
declare(strict_types=1);

namespace App\Panel;

use App\Accounts\Accounts;
use App\Accounts\Totp;
use App\Db;
use App\Security;

/**
 * Users of the admin panel (separate from player accounts), like in School Manager:
 * a role brings basic permissions; single permissions and groups add more.
 * Every panel user needs a password (forced change after an admin set it) and a second factor (TOTP).
 */
final class PanelUsers
{
    // permissions (bit flags)
    public const MAIN_LEVELS = 1;   // edit and publish the main levels
    public const COMMUNITY = 2;     // moderate community levels and reports
    public const SCORES = 4;        // hide/delete/verify leaderboard entries
    public const ACCOUNTS = 8;      // manage player accounts
    public const USERS = 16;        // manage panel users
    public const GROUPS = 32;       // manage groups
    public const AUDIT = 64;        // read the history
    public const SETTINGS = 128;    // server switches, test mail
    public const ALL = 255;

    public const PERMISSIONS = [
        self::MAIN_LEVELS => 'Hauptlevel bearbeiten und veröffentlichen',
        self::COMMUNITY => 'Community-Level und Meldungen moderieren',
        self::SCORES => 'Bestenlisten bearbeiten',
        self::ACCOUNTS => 'Spielerkonten verwalten',
        self::USERS => 'Panel-Benutzer verwalten',
        self::GROUPS => 'Gruppen verwalten',
        self::AUDIT => 'Verlauf ansehen',
        self::SETTINGS => 'Einstellungen ändern',
    ];

    /** Roles ("Stufen") and the permissions they bring. */
    public const ROLES = [
        'editor' => ['Level-Editor', self::MAIN_LEVELS],
        'moderator' => ['Moderator', self::COMMUNITY | self::SCORES | self::ACCOUNTS],
        'admin' => ['Administrator', self::ALL & ~self::USERS & ~self::GROUPS],
        'owner' => ['Besitzer', self::ALL],
    ];

    public static function effective(array $u): int
    {
        $p = (self::ROLES[$u['role']][1] ?? 0) | (int) $u['permissions'];
        foreach (Db::all('SELECT g.permissions FROM panel_groups g JOIN panel_user_groups ug ON ug.group_id = g.id WHERE ug.user_id = ?', [$u['id']]) as $g) {
            $p |= (int) $g['permissions'];
        }
        return $p;
    }

    /** @return array<string, mixed>|null */
    public static function byId(int $id): ?array
    {
        return Db::one('SELECT * FROM panel_users WHERE id = ?', [$id]);
    }

    public static function validUsername(string $name): ?string
    {
        return preg_match('/^[A-Za-z0-9_.-]{3,20}$/', $name) ? null : 'Benutzername: 3–20 Zeichen, Buchstaben, Ziffern, _ . -';
    }

    /** @return int|string new id or error message */
    public static function create(string $username, string $password, string $role, bool $mustChange, string $displayName = ''): int|string
    {
        if ($e = self::validUsername($username)) return $e;
        if (!isset(self::ROLES[$role])) return 'Unbekannte Stufe';
        if ($e = Accounts::validatePassword($password, $username)) return 'Passwort zu schwach (mindestens 10 Zeichen, nicht zu einfach)';
        if (Db::one('SELECT id FROM panel_users WHERE username_norm = ?', [strtolower($username)]) !== null) return 'Benutzername schon vergeben';
        $now = time();
        Db::run('INSERT INTO panel_users (username, username_norm, display_name, password_hash, must_change_password, role, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$username, strtolower($username), mb_substr(trim($displayName), 0, 60), Accounts::hash($password), $mustChange ? 1 : 0, $role, $now, $now]);
        return Db::lastId();
    }

    /** @return array<string, mixed>|string user row or error message */
    public static function login(string $username, string $password): array|string
    {
        $norm = strtolower(trim($username));
        if (!Security::rateLimit('panel-ip', 20, 900) || !Security::rateLimit('panel-user', 8, 900, 'p:' . $norm)) return 'Zu viele Versuche. Bitte ein paar Minuten warten.';
        $u = preg_match('/^[a-z0-9_.-]{3,20}$/', $norm) ? Db::one('SELECT * FROM panel_users WHERE username_norm = ?', [$norm]) : null;
        $ok = password_verify($password, (string) ($u['password_hash'] ?? Accounts::hash(bin2hex(random_bytes(8)))));
        if ($u === null || !$ok) {
            Security::panelAudit('panel_login_failed', $u !== null ? (int) $u['id'] : null, substr($norm, 0, 20));
            return 'Benutzername oder Passwort falsch.';
        }
        if ((int) $u['disabled'] === 1) return 'Dieser Zugang ist gesperrt.';
        return $u;
    }

    public static function verifyTotp(array $u, string $code): bool
    {
        $secret = $u['totp_secret'] ? Security::decrypt((string) $u['totp_secret']) : null;
        if ($secret === null) return false;
        $step = Totp::verify($secret, $code, isset($u['totp_last_step']) ? (int) $u['totp_last_step'] : null);
        if ($step === null) return false;
        Db::run('UPDATE panel_users SET totp_last_step = ?, last_login_at = ? WHERE id = ?', [$step, time(), $u['id']]);
        return true;
    }

    public static function setPassword(int $id, string $password, bool $mustChange): ?string
    {
        $u = self::byId($id);
        if ($u === null) return 'Unbekannter Benutzer';
        if (Accounts::validatePassword($password, (string) $u['username'])) return 'Passwort zu schwach (mindestens 10 Zeichen, nicht zu einfach)';
        Db::run('UPDATE panel_users SET password_hash = ?, must_change_password = ?, password_changed_at = ? WHERE id = ?',
            [Accounts::hash($password), $mustChange ? 1 : 0, time(), $id]);
        return null;
    }

    /** @return array<string, mixed> for the panel */
    public static function describe(array $u): array
    {
        $groups = array_map('intval', array_column(Db::all('SELECT group_id FROM panel_user_groups WHERE user_id = ?', [$u['id']]), 'group_id'));
        return ['id' => (int) $u['id'], 'username' => (string) $u['username'], 'displayName' => (string) $u['display_name'],
            'role' => (string) $u['role'], 'permissions' => (int) $u['permissions'], 'effective' => self::effective($u),
            'groups' => $groups, 'disabled' => (int) $u['disabled'] === 1, 'has2fa' => $u['totp_secret'] !== null,
            'mustChangePassword' => (int) $u['must_change_password'] === 1,
            'createdAt' => (int) $u['created_at'], 'lastLoginAt' => $u['last_login_at'] !== null ? (int) $u['last_login_at'] : null];
    }
}
