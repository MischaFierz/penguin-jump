<?php
declare(strict_types=1);

namespace App\Game;

use App\Replay\Level;

/** The game's levels (copied from shared/levels into server/data/levels at build time). */
final class Levels
{
    /** @var array<string, string>|null level id => file */
    private static ?array $ids = null;

    /** @return array<string, string> level id ("1-1") => file name, in game order */
    public static function all(): array
    {
        if (self::$ids === null) {
            self::$ids = [];
            $dir = APP_ROOT . '/data/levels';
            $index = is_file($dir . '/index.json') ? json_decode((string) file_get_contents($dir . '/index.json'), true) : [];
            foreach (is_array($index) ? $index : [] as $file) {
                if (!is_string($file) || !preg_match('/^[a-z0-9_]+\.txt$/', $file)) continue;
                $text = (string) file_get_contents($dir . '/' . $file);
                if (preg_match('/^id=(.+)$/m', $text, $m)) self::$ids[trim($m[1])] = $file;
            }
        }
        return self::$ids;
    }

    public static function exists(string $id): bool
    {
        return isset(self::all()[$id]);
    }

    public static function load(string $id): Level
    {
        $file = self::all()[$id] ?? throw new \InvalidArgumentException('unknown level');
        return Level::parse((string) file_get_contents(APP_ROOT . '/data/levels/' . $file), $file);
    }

    /** "1-1" -> world number, used for the translated world name */
    public static function world(string $id): int
    {
        return (int) explode('-', $id)[0];
    }
}
