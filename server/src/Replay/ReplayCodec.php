<?php
declare(strict_types=1);

namespace App\Replay;

/** Run-length encoded tick inputs, base64url (same format as Game/Replay.cs and web/js/replay.js). */
final class ReplayCodec
{
    public const MAX_TICKS = 20 * 60 * Sim::TPS; // 20 minutes

    /** @return list<int> one input byte per tick */
    public static function decode(string $s, int $maxTicks = self::MAX_TICKS): array
    {
        if ($s === '' || strlen($s) > 200_000 || !preg_match('/^[A-Za-z0-9_-]+$/', $s)) throw new \InvalidArgumentException('bad replay');
        $bin = base64_decode(strtr($s, '-_', '+/'), true);
        if ($bin === false) throw new \InvalidArgumentException('bad replay');
        $out = [];
        $n = strlen($bin);
        $i = 0;
        while ($i < $n) {
            $v = ord($bin[$i++]);
            if ($v > 63) throw new \InvalidArgumentException('bad input byte');
            $c = 0;
            $shift = 0;
            while (true) {
                if ($i >= $n || $shift > 28) throw new \InvalidArgumentException('bad count');
                $b = ord($bin[$i++]);
                $c |= ($b & 0x7f) << $shift;
                if (($b & 0x80) === 0) break;
                $shift += 7;
            }
            if ($c === 0 || count($out) + $c > $maxTicks) throw new \InvalidArgumentException('bad length');
            for ($k = 0; $k < $c; $k++) $out[] = $v;
        }
        return $out;
    }

    /** @param list<int> $ticks */
    public static function encode(array $ticks): string
    {
        $bytes = '';
        $n = count($ticks);
        for ($i = 0; $i < $n;) {
            $v = $ticks[$i];
            $c = 1;
            while ($i + $c < $n && $ticks[$i + $c] === $v) $c++;
            $bytes .= chr($v);
            $k = $c;
            while ($k >= 0x80) { $bytes .= chr(($k & 0x7f) | 0x80); $k >>= 7; }
            $bytes .= chr($k);
            $i += $c;
        }
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
