<?php
declare(strict_types=1);

namespace App\Accounts;

use App\Db;

/** Rules for names shown on the public leaderboard. */
final class Nickname
{
    // Short list of insults / slurs (EN, DE, FR, IT); matched after normalising leetspeak and separators.
    private const BAD = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore', 'slut', 'nigg', 'fag', 'retard', 'rape', 'nazi', 'hitler',
        'arsch', 'fotze', 'hure', 'wichs', 'schlampe', 'spast', 'missgeburt', 'hurensohn', 'schwuchtel', 'neger', 'kanake', 'votze',
        'merde', 'putain', 'salope', 'connard', 'encule', 'pute', 'batard', 'nique', 'cazzo', 'stronzo', 'puttana', 'vaffanculo', 'porn'];
    private const RESERVED = ['admin', 'administrator', 'root', 'system', 'moderator', 'mod', 'support', 'staff', 'official', 'deleted', 'anonymous', 'null'];

    private static function squash(string $s): string
    {
        $s = strtr(mb_strtolower($s), ['0' => 'o', '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's', '7' => 't', '8' => 'b', '@' => 'a', '$' => 's', '€' => 'e',
            'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'à' => 'a', 'ç' => 'c', 'î' => 'i', 'ô' => 'o', 'ß' => 'ss']);
        return (string) preg_replace('/[^a-z]/', '', $s);
    }

    public static function isOffensive(string $name): bool
    {
        $s = self::squash($name);
        foreach (self::BAD as $w) if (str_contains($s, $w)) return true;
        return false;
    }

    public static function isReserved(string $name): bool
    {
        $s = self::squash($name);
        foreach (self::RESERVED as $r) if ($s === $r || str_starts_with($s, 'admin')) return true;
        return false;
    }

    /** Normalised key used to group anonymous entries of the same player name. */
    public static function key(string $nick): string
    {
        return mb_strtolower((string) preg_replace('/\s+/u', ' ', trim($nick)));
    }

    /** @return string|null error key; $clean receives the trimmed nickname */
    public static function validate(string $nick, ?string &$clean): ?string
    {
        $clean = trim((string) preg_replace('/\s+/u', ' ', $nick));
        if (!preg_match('/^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,14}[\p{L}\p{N}]$/u', $clean)) return 'err.nick_format';
        if (preg_match('/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u', $clean)) return 'err.nick_format';
        if (self::isOffensive($clean) || self::isReserved($clean)) return 'err.nick_bad';
        // registered usernames are protected: nobody can post under someone else's account name
        if (Db::one('SELECT id FROM accounts WHERE username_norm = ?', [mb_strtolower($clean)]) !== null) return 'err.nick_taken';
        return null;
    }
}
