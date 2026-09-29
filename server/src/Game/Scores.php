<?php
declare(strict_types=1);

namespace App\Game;

use App\Accounts\Nickname;
use App\Config;
use App\Db;
use App\Replay\ReplayCodec;
use App\Replay\Runner;
use App\Security;

/**
 * Highscores. A score is only stored after the server has replayed the recorded inputs with its
 * own copy of the game physics: time, points and coins come from that replay, never from the client.
 * A run id must be requested when the level starts, is valid once, and the real time between start
 * and submission must be at least the in-game time (no fast-forwarded or pre-recorded runs).
 */
final class Scores
{
    public const RUN_MAX_AGE = 3 * 3600;

    public static function startRun(string $levelId): string
    {
        $id = bin2hex(random_bytes(16));
        Db::run('INSERT INTO runs (id, game_id, level_id, issued_at, ip_hash) VALUES (?, ?, ?, ?, ?)',
            [$id, Config::gameId(), $levelId, time(), Security::ipHash()]);
        if (random_int(1, 100) === 1) Db::run('DELETE FROM runs WHERE issued_at < ?', [time() - self::RUN_MAX_AGE]);
        return $id;
    }

    /**
     * @param array<string, mixed>|null $account logged-in player or null for a nickname entry
     * @param array<string, mixed> $claimed what the client computed (only compared, never stored)
     * @return array<string, mixed> result for the client; ['error' => key] on rejection
     */
    public static function submit(string $runId, string $levelId, string $replay, ?array $account, string $nickname, array $claimed, string $client): array
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $runId)) return ['error' => 'bad_run'];
        $run = Db::one('SELECT * FROM runs WHERE id = ? AND game_id = ?', [$runId, Config::gameId()]);
        if ($run === null || (int) $run['used'] === 1 || $run['level_id'] !== $levelId) return ['error' => 'bad_run'];
        $age = time() - (int) $run['issued_at'];
        if ($age > self::RUN_MAX_AGE) return ['error' => 'run_expired'];
        // single use, even if the verification below fails
        if (Db::run('UPDATE runs SET used = 1 WHERE id = ? AND used = 0', [$runId])->rowCount() !== 1) return ['error' => 'bad_run'];

        try {
            $ticks = ReplayCodec::decode($replay);
        } catch (\InvalidArgumentException) {
            return ['error' => 'bad_replay'];
        }
        $accId = $account ? (int) $account['id'] : null;
        // the run cannot have taken less real time than game time (2 s tolerance for network/clock)
        if ($age + 2 < intdiv(count($ticks), 120)) {
            Security::audit('score_too_fast', $accId, "$levelId ticks=" . count($ticks) . " age=$age");
            return ['error' => 'rejected'];
        }

        set_time_limit(30);
        $result = Runner::run(Levels::load($levelId), $ticks);
        // the recording must end exactly at the tick the goal was reached
        if (!$result->completed || $result->ticks !== count($ticks)) {
            Security::audit('score_invalid', $accId, "$levelId completed=" . (int) $result->completed . " ticks={$result->ticks}/" . count($ticks));
            return ['error' => 'rejected'];
        }
        $final = $result->finalScore();
        if ((int) ($claimed['timeTicks'] ?? -1) !== $result->timeTicks || (int) ($claimed['score'] ?? -1) !== $final) {
            // honest clients always match; a mismatch means a modified client or a bug -> keep a trace
            Security::audit('score_mismatch', $accId,
                "$levelId server={$result->timeTicks}/$final client=" . (int) ($claimed['timeTicks'] ?? -1) . '/' . (int) ($claimed['score'] ?? -1));
            return ['error' => 'rejected'];
        }

        $name = $account ? (string) $account['username'] : $nickname;
        $key = $account ? 'a:' . $account['id'] : 'n:' . Nickname::key($nickname);
        Db::run('INSERT INTO scores (game_id, level_id, account_id, player_key, nickname, time_ticks, score, coins, replay, client, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [Config::gameId(), $levelId, $accId, $key, $name, $result->timeTicks, $final, $result->coins, $replay,
                substr((string) preg_replace('/[^a-z0-9-]/', '', strtolower($client)), 0, 16), time(), Security::ipHash()]);

        return [
            'accepted' => true,
            'level' => $levelId,
            'timeTicks' => $result->timeTicks,
            'score' => $final,
            'coins' => $result->coins,
            'rankTime' => self::rank($levelId, 'time', $key),
            'rankScore' => self::rank($levelId, 'score', $key),
            'top' => self::top($levelId, 'time', 5),
        ];
    }

    private static function order(string $by): string
    {
        return $by === 'score' ? 'score DESC, time_ticks ASC, id ASC' : 'time_ticks ASC, score DESC, id ASC';
    }

    /**
     * Best entry per player, ordered by time (fastest) or score (highest).
     * @return list<array{rank: int, name: string, registered: bool, timeTicks: int, score: int, coins: int, at: int}>
     */
    public static function top(string $levelId, string $by, int $limit, int $offset = 0): array
    {
        $order = self::order($by);
        $rows = Db::all("SELECT nickname, account_id, time_ticks, score, coins, created_at FROM (
                SELECT s.*, ROW_NUMBER() OVER (PARTITION BY player_key ORDER BY $order) AS rn
                FROM scores s WHERE game_id = ? AND level_id = ? AND hidden = 0
            ) best WHERE rn = 1 ORDER BY $order LIMIT ? OFFSET ?", [Config::gameId(), $levelId, $limit, $offset]);
        $out = [];
        foreach ($rows as $i => $r) {
            $out[] = ['rank' => $offset + $i + 1, 'name' => (string) $r['nickname'], 'registered' => $r['account_id'] !== null,
                'timeTicks' => (int) $r['time_ticks'], 'score' => (int) $r['score'], 'coins' => (int) $r['coins'], 'at' => (int) $r['created_at']];
        }
        return $out;
    }

    private static function rank(string $levelId, string $by, string $playerKey): int
    {
        $order = self::order($by);
        $row = Db::one("SELECT pos FROM (
                SELECT player_key, ROW_NUMBER() OVER (ORDER BY $order) AS pos FROM (
                    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY player_key ORDER BY $order) AS rn
                    FROM scores s WHERE game_id = ? AND level_id = ? AND hidden = 0
                ) best WHERE rn = 1
            ) ranked WHERE player_key = ?", [Config::gameId(), $levelId, $playerKey]);
        return $row ? (int) $row['pos'] : 0;
    }
}
