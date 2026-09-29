<?php
declare(strict_types=1);

namespace App\Game;

/**
 * Validates and normalises level tile maps coming from the editors.
 * A level is 15 rows high; one character per 48 px tile (legend in Claude Game/Game/Level.cs).
 */
final class LevelFormat
{
    public const ROWS = 15;
    public const MIN_WIDTH = 20;
    public const MAX_WIDTH = 300;
    private const TILES = ' #B?FSWHEo-x^~MV*CG@esbhi';

    /**
     * @param list<string>|string $tiles rows (array or newline-separated text)
     * @return list<string>|string normalised rows (right-trimmed) or an error key
     */
    public static function rows(array|string $tiles, bool $allowSigns): array|string
    {
        $rows = is_array($tiles) ? $tiles : explode("\n", str_replace("\r", '', $tiles));
        if (count($rows) > self::ROWS) {
            // tolerate empty rows at the end
            while (count($rows) > self::ROWS && trim((string) end($rows)) === '') array_pop($rows);
            if (count($rows) > self::ROWS) return 'level_height';
        }
        $allowed = self::TILES . ($allowSigns ? '!' : '');
        $out = [];
        $width = 0;
        foreach ($rows as $r) {
            if (!is_string($r)) return 'level_format';
            $r = rtrim($r, ' ');
            if (strlen($r) > self::MAX_WIDTH) return 'level_width';
            if (strspn($r, $allowed) !== strlen($r)) return 'level_tiles';
            $width = max($width, strlen($r));
            $out[] = $r;
        }
        while (count($out) < self::ROWS) $out[] = '';
        if ($width < self::MIN_WIDTH) return 'level_width';
        $all = implode("\n", $out);
        if (substr_count($all, '@') !== 1) return 'level_start';
        if (substr_count($all, 'G') !== 1) return 'level_goal';
        return $out;
    }

    /** Text form used by the games and the replay check. @param list<string> $rows  @param list<string> $signs */
    public static function text(string $code, int $world, array $rows, array $signs = []): string
    {
        $head = "id=$code\nworld=$world\n" . ($signs ? 'signs=' . implode(',', $signs) . "\n" : '');
        return $head . "---\n" . implode("\n", $rows) . "\n";
    }

    /** @param list<string> $rows  @param list<string> $signs */
    public static function hash(int $world, array $rows, array $signs = []): string
    {
        return hash('sha256', "world=$world\nsigns=" . implode(',', $signs) . "\n" . implode("\n", $rows));
    }

    /** @return array{world: int, signs: list<string>, rows: list<string>} parts of a stored level text */
    public static function split(string $text): array
    {
        $lines = explode("\n", str_replace("\r", '', $text));
        $world = 1;
        $signs = [];
        $i = 0;
        for (; $i < count($lines) && $lines[$i] !== '---'; $i++) {
            $kv = explode('=', $lines[$i], 2);
            if (count($kv) !== 2) continue;
            if (trim($kv[0]) === 'world') $world = max(1, min(4, (int) $kv[1]));
            if (trim($kv[0]) === 'signs') $signs = array_values(array_filter(array_map('trim', explode(',', $kv[1]))));
        }
        $rows = array_slice($lines, $i + 1, self::ROWS);
        while (count($rows) < self::ROWS) $rows[] = '';
        return ['world' => $world, 'signs' => $signs, 'rows' => array_map(static fn($r) => rtrim($r, ' '), $rows)];
    }
}
