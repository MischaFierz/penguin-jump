<?php
declare(strict_types=1);

namespace App;

/** Switches that admins can change in the panel (stored in the database). */
final class Settings
{
    public const DEFAULTS = [
        'registration_open' => '1',
        'community_open' => '1',     // publishing community levels
        'leaderboards_open' => '1',  // submitting scores
    ];

    /** @var array<string, string>|null */
    private static ?array $cache = null;

    public static function get(string $name): string
    {
        if (self::$cache === null) {
            self::$cache = self::DEFAULTS;
            try {
                foreach (Db::all('SELECT name, value FROM settings') as $r) self::$cache[(string) $r['name']] = (string) $r['value'];
            } catch (\PDOException) {
                // not installed yet
            }
        }
        return self::$cache[$name] ?? '';
    }

    public static function on(string $name): bool
    {
        return self::get($name) === '1';
    }

    public static function set(string $name, string $value): void
    {
        if (!array_key_exists($name, self::DEFAULTS)) throw new \InvalidArgumentException('unknown setting');
        Db::run('DELETE FROM settings WHERE name = ?', [$name]);
        Db::run('INSERT INTO settings (name, value) VALUES (?, ?)', [$name, $value]);
        self::$cache = null;
    }

    /** @return array<string, bool> */
    public static function all(): array
    {
        $out = [];
        foreach (array_keys(self::DEFAULTS) as $k) $out[$k] = self::on($k);
        return $out;
    }
}
