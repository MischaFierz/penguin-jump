<?php
declare(strict_types=1);

namespace App\Replay;

/** Level file parser (same rules as LevelData.Parse in C# and parseLevel in JS). */
final class Level
{
    /** @param array<int, array<int, string>> $tiles tiles[y][x] */
    private function __construct(public readonly string $id, public readonly array $tiles, public readonly int $w, public readonly int $h)
    {
    }

    public static function parse(string $text, string $file): self
    {
        $lines = explode("\n", str_replace("\r", '', $text));
        $id = $file;
        $i = 0;
        for (; $i < count($lines) && $lines[$i] !== '---'; $i++) {
            $kv = explode('=', $lines[$i], 2);
            if (count($kv) === 2 && trim($kv[0]) === 'id') $id = trim($kv[1]);
        }
        $rows = array_slice($lines, $i + 1);
        while (count($rows) > 15 && end($rows) === '') array_pop($rows);
        while (count($rows) < 15) $rows[] = '';
        $w = max(array_map('strlen', $rows));
        $tiles = [];
        foreach ($rows as $r) $tiles[] = str_split(str_pad($r, $w, ' '));
        return new self($id, $tiles, $w, count($rows));
    }
}
