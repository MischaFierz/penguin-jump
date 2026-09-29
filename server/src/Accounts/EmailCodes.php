<?php
declare(strict_types=1);

namespace App\Accounts;

use App\Config;
use App\Db;
use App\Mailer;
use App\Security;

/**
 * Optional e-mail address for player accounts: confirmed with a 6-digit code, then usable to
 * reset a forgotten password (also with a code). Codes are stored hashed, expire after
 * 15 minutes and allow 5 attempts. Responses never reveal whether an address or name exists.
 */
final class EmailCodes
{
    private const TTL = 900;
    private const TEXTS = [
        'en' => ['verify' => ['Confirm your e-mail address', "Your confirmation code for {game}:\n\n    {code}\n\nThe code is valid for 15 minutes. If you did not request it, you can ignore this e-mail."],
                 'reset' => ['Reset your password', "Your code to reset the password of \"{user}\" in {game}:\n\n    {code}\n\nThe code is valid for 15 minutes. If you did not request it, you can ignore this e-mail - your password stays unchanged."]],
        'de' => ['verify' => ['E-Mail-Adresse bestätigen', "Dein Bestätigungs-Code für {game}:\n\n    {code}\n\nDer Code gilt 15 Minuten. Falls du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren."],
                 'reset' => ['Passwort zurücksetzen', "Dein Code zum Zurücksetzen des Passworts von \"{user}\" in {game}:\n\n    {code}\n\nDer Code gilt 15 Minuten. Falls du ihn nicht angefordert hast, ignoriere diese E-Mail – dein Passwort bleibt unverändert."]],
        'fr' => ['verify' => ['Confirme ton adresse e-mail', "Ton code de confirmation pour {game} :\n\n    {code}\n\nLe code est valable 15 minutes. Si tu ne l'as pas demandé, ignore cet e-mail."],
                 'reset' => ['Réinitialiser le mot de passe', "Ton code pour réinitialiser le mot de passe de « {user} » dans {game} :\n\n    {code}\n\nLe code est valable 15 minutes. Si tu ne l'as pas demandé, ignore cet e-mail – ton mot de passe reste inchangé."]],
    ];

    public static function validEmail(string $email): bool
    {
        return strlen($email) <= 190 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false && !preg_match('/[\r\n<>]/', $email);
    }

    private static function hashCode(string $code): string
    {
        return hash_hmac('sha256', $code, Config::key('email-code'));
    }

    /** Creates a code (replacing older ones of the same purpose) and mails it. */
    private static function send(array $acc, string $purpose, string $email, string $lang): void
    {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        Db::run('DELETE FROM email_codes WHERE account_id = ? AND purpose = ?', [$acc['id'], $purpose]);
        Db::run('INSERT INTO email_codes (account_id, purpose, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$acc['id'], $purpose, $email, self::hashCode($code), time() + self::TTL, time()]);
        [$subject, $text] = (self::TEXTS[$lang] ?? self::TEXTS['en'])[$purpose];
        $text = strtr($text, ['{game}' => Config::gameName(), '{code}' => $code, '{user}' => (string) $acc['username']]);
        Mailer::send($email, Config::gameName() . ': ' . $subject, $text);
    }

    /** @return array<string, mixed>|null the matching unexpired code row (counts a failed attempt otherwise) */
    private static function check(int $accountId, string $purpose, string $code): ?array
    {
        $row = Db::one('SELECT * FROM email_codes WHERE account_id = ? AND purpose = ? AND expires_at > ?', [$accountId, $purpose, time()]);
        if ($row === null || (int) $row['attempts'] >= 5) return null;
        if (!hash_equals((string) $row['code_hash'], self::hashCode(preg_replace('/\D/', '', $code) ?? ''))) {
            Db::run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', [$row['id']]);
            return null;
        }
        Db::run('DELETE FROM email_codes WHERE id = ?', [$row['id']]);
        return $row;
    }

    /** Starts adding/changing the address: it is only stored once the code is confirmed. */
    public static function requestVerify(int $accountId, string $email, string $lang): ?string
    {
        if (!Mailer::enabled()) return 'err.mail_off';
        $email = trim($email);
        if (!self::validEmail($email)) return 'err.email_format';
        if (!Security::rateLimit('mail-ip', 20, 3600) || !Security::rateLimit('mail-acc', 5, 3600, 'm:' . $accountId)) return 'err.too_many';
        $acc = Accounts::byId($accountId) ?? throw new \RuntimeException('no account');
        try {
            self::send($acc, 'verify', $email, $lang);
        } catch (\Throwable $e) {
            error_log('mail: ' . $e->getMessage());
            return 'err.mail_failed';
        }
        return null;
    }

    public static function confirmVerify(int $accountId, string $code): ?string
    {
        if (!Security::rateLimit('code-acc', 10, 900, 'v:' . $accountId)) return 'err.too_many';
        $row = self::check($accountId, 'verify', $code);
        if ($row === null) return 'err.code_wrong';
        $email = (string) $row['email'];
        if (Db::one('SELECT id FROM accounts WHERE email = ? AND email_verified = 1 AND id <> ?', [$email, $accountId]) !== null) return 'err.email_taken';
        Db::run('UPDATE accounts SET email = ?, email_verified = 1 WHERE id = ?', [$email, $accountId]);
        Security::audit('email_verified', $accountId);
        return null;
    }

    public static function remove(int $accountId): void
    {
        Db::run('UPDATE accounts SET email = NULL, email_verified = 0 WHERE id = ?', [$accountId]);
        Db::run('DELETE FROM email_codes WHERE account_id = ?', [$accountId]);
        Security::audit('email_removed', $accountId);
    }

    /** Forgotten password: sends a code to the confirmed address of the account (by name or address). Always "ok". */
    public static function requestReset(string $nameOrEmail, string $lang): ?string
    {
        if (!Mailer::enabled()) return 'err.mail_off';
        $v = trim($nameOrEmail);
        if (!Security::rateLimit('reset-ip', 10, 3600) || !Security::rateLimit('reset-who', 3, 3600, 'rs:' . strtolower($v))) return 'err.too_many';
        $acc = str_contains($v, '@')
            ? Db::one('SELECT * FROM accounts WHERE email = ? AND email_verified = 1 AND disabled = 0', [$v])
            : Db::one('SELECT * FROM accounts WHERE username_norm = ? AND email_verified = 1 AND disabled = 0', [strtolower($v)]);
        if ($acc !== null) {
            try {
                self::send($acc, 'reset', (string) $acc['email'], $lang);
            } catch (\Throwable $e) {
                error_log('mail: ' . $e->getMessage());
            }
        }
        return null; // same answer whether or not the account exists
    }

    public static function confirmReset(string $nameOrEmail, string $code, string $newPassword): ?string
    {
        $v = trim($nameOrEmail);
        if (!Security::rateLimit('reset-code', 10, 900, 'rc:' . strtolower($v))) return 'err.too_many';
        $acc = str_contains($v, '@')
            ? Db::one('SELECT * FROM accounts WHERE email = ? AND email_verified = 1', [$v])
            : Db::one('SELECT * FROM accounts WHERE username_norm = ? AND email_verified = 1', [strtolower($v)]);
        if ($acc !== null && ($e = Accounts::validatePassword($newPassword, (string) $acc['username']))) return $e; // before using up the code
        if ($acc === null || self::check((int) $acc['id'], 'reset', $code) === null) return 'err.code_wrong';
        return Accounts::setPassword((int) $acc['id'], $newPassword);
    }
}
