<?php
declare(strict_types=1);

namespace App\Game;

use App\Accounts\Nickname;
use App\Config;
use App\Db;
use App\Replay\ReplayCodec;
use App\Replay\RunResult;
use App\Replay\Runner;
use App\Security;

/**
 * Runs and highscores. A result is only accepted after the server has replayed the recorded inputs
 * with its own copy of the game physics on the exact level version that was played; time, points
 * and coins come from that replay, never from the client. Run ids are single-use, bound to one
 * level version, and the real time between start and submission must be at least the game time.
 *
 * The same check proves that a community level can be finished before it may be published.
 */
final class Scores
{
    public const RUN_MAX_AGE = 3 * 3600;

    /**
     * @param string $purpose 'score' (published level) or 'verify' (author tests own draft before publishing)
     * @return string|array{error: string}
     */
    public static function startRun(string $code, string $purpose = 'score', ?int $accountId = null): string|array
    {
        $level = Levels::byCode($code);
        if ($level === null) return ['error' => 'bad_level'];
        if ($purpose === 'verify') {
            if ($accountId === null || (int) $level['author_id'] !== $accountId) return ['error' => 'not_found'];
            $versionId = Levels::draftVersion($level);
        } else {
            if ($level['status'] !== 'published' || $level['current_version_id'] === null) return ['error' => 'bad_level'];
            $versionId = (int) $level['current_version_id'];
            if ($level['kind'] === 'community') Levels::countPlay((int) $level['id']);
        }
        $id = bin2hex(random_bytes(16));
        Db::run('INSERT INTO runs (id, game_id, level_code, level_version_id, purpose, account_id, issued_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, Config::gameId(), $code, $versionId, $purpose, $accountId, time(), Security::ipHash()]);
        if (random_int(1, 100) === 1) Db::run('DELETE FROM runs WHERE issued_at < ?', [time() - self::RUN_MAX_AGE]);
        return $id;
    }

    /**
     * Checks a recorded run. @param array<string, mixed> $claimed what the client computed (only compared)
     * @return array{run: array<string, mixed>, result: RunResult, replay: string}|array{error: string}
     */
    private static function check(string $runId, string $code, string $replay, array $claimed, string $purpose, ?int $accountId): array
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $runId)) return ['error' => 'bad_run'];
        $run = Db::one('SELECT * FROM runs WHERE id = ? AND game_id = ?', [$runId, Config::gameId()]);
        if ($run === null || (int) $run['used'] === 1 || $run['level_code'] !== $code || $run['purpose'] !== $purpose) return ['error' => 'bad_run'];
        if ($purpose === 'verify' && (int) $run['account_id'] !== $accountId) return ['error' => 'bad_run'];
        $age = time() - (int) $run['issued_at'];
        if ($age > self::RUN_MAX_AGE) return ['error' => 'run_expired'];
        // single use, even if the verification below fails
        if (Db::run('UPDATE runs SET used = 1 WHERE id = ? AND used = 0', [$runId])->rowCount() !== 1) return ['error' => 'bad_run'];
        try {
            $ticks = ReplayCodec::decode($replay);
        } catch (\InvalidArgumentException) {
            return ['error' => 'bad_replay'];
        }
        // the run cannot have taken less real time than game time (2 s tolerance for network/clock)
        if ($age + 2 < intdiv(count($ticks), 120)) {
            Security::audit('score_too_fast', $accountId, "$code ticks=" . count($ticks) . " age=$age");
            return ['error' => 'rejected'];
        }
        set_time_limit(30);
        $result = Runner::run(Levels::loadVersion((int) $run['level_version_id']), $ticks);
        // the recording must end exactly at the tick the goal was reached
        if (!$result->completed || $result->ticks !== count($ticks)) {
            Security::audit('score_invalid', $accountId, "$code completed=" . (int) $result->completed . " ticks={$result->ticks}/" . count($ticks));
            return ['error' => 'rejected'];
        }
        if ((int) ($claimed['timeTicks'] ?? -1) !== $result->timeTicks || (int) ($claimed['score'] ?? -1) !== $result->finalScore()) {
            // honest clients always match; a mismatch means a modified client or a bug -> keep a trace
            Security::audit('score_mismatch', $accountId,
                "$code server={$result->timeTicks}/{$result->finalScore()} client=" . (int) ($claimed['timeTicks'] ?? -1) . '/' . (int) ($claimed['score'] ?? -1));
            return ['error' => 'rejected'];
        }
        return ['run' => $run, 'result' => $result, 'replay' => $replay];
    }

    /**
     * @param array<string, mixed>|null $account logged-in player or null for a nickname entry
     * @return array<string, mixed> result for the client; ['error' => key] on rejection
     */
    public static function submit(string $runId, string $code, string $replay, ?array $account, string $nickname, array $claimed, string $client): array
    {
        $accId = $account ? (int) $account['id'] : null;
        $c = self::check($runId, $code, $replay, $claimed, 'score', $accId);
        if (isset($c['error'])) return $c;
        $result = $c['result'];
        $versionId = (int) $c['run']['level_version_id'];
        $name = $account ? (string) $account['username'] : $nickname;
        $key = $account ? 'a:' . $account['id'] : 'n:' . Nickname::key($nickname);
        Db::run('INSERT INTO scores (game_id, level_code, level_version_id, account_id, player_key, nickname, time_ticks, score, coins, replay, client, created_at, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [Config::gameId(), $code, $versionId, $accId, $key, $name, $result->timeTicks, $result->finalScore(), $result->coins, $replay,
                substr((string) preg_replace('/[^a-z0-9-]/', '', strtolower($client)), 0, 16), time(), Security::ipHash()]);
        return [
            'accepted' => true, 'level' => $code, 'timeTicks' => $result->timeTicks, 'score' => $result->finalScore(), 'coins' => $result->coins,
            'rankTime' => self::rank($versionId, 'time', $key), 'rankScore' => self::rank($versionId, 'score', $key),
            'top' => self::top($code, 'time', 5),
        ];
    }

    /**
     * The author's proof that a community level can be finished: on success the tested draft version is published.
     * @return array<string, mixed>
     */
    public static function verifyAndPublish(string $runId, string $code, string $replay, array $account, array $claimed): array
    {
        $level = Levels::byCode($code);
        if ($level === null || (int) $level['author_id'] !== (int) $account['id']) return ['error' => 'not_found'];
        $c = self::check($runId, $code, $replay, $claimed, 'verify', (int) $account['id']);
        if (isset($c['error'])) return $c;
        $versionId = (int) $c['run']['level_version_id'];
        // the draft must still be what was tested
        if (Levels::draftVersion($level) !== $versionId) return ['error' => 'draft_changed'];
        Levels::publishVerified($level, $versionId, $c['result']->timeTicks);
        return ['published' => true, 'level' => $code, 'timeTicks' => $c['result']->timeTicks];
    }

    private static function order(string $by): string
    {
        return $by === 'score' ? 'score DESC, time_ticks ASC, id ASC' : 'time_ticks ASC, score DESC, id ASC';
    }

    /**
     * Best entry per player on the currently published version of a level.
     * @return list<array{rank: int, name: string, registered: bool, timeTicks: int, score: int, coins: int, at: int}>
     */
    public static function top(string $code, string $by, int $limit, int $offset = 0): array
    {
        $level = Levels::byCode($code);
        if ($level === null || $level['current_version_id'] === null) return [];
        $order = self::order($by);
        $rows = Db::all("SELECT nickname, account_id, time_ticks, score, coins, created_at FROM (
                SELECT s.*, ROW_NUMBER() OVER (PARTITION BY player_key ORDER BY $order) AS rn
                FROM scores s WHERE level_version_id = ? AND hidden = 0
            ) best WHERE rn = 1 ORDER BY $order LIMIT ? OFFSET ?", [(int) $level['current_version_id'], $limit, $offset]);
        $out = [];
        foreach ($rows as $i => $r) {
            $out[] = ['rank' => $offset + $i + 1, 'name' => (string) $r['nickname'], 'registered' => $r['account_id'] !== null,
                'timeTicks' => (int) $r['time_ticks'], 'score' => (int) $r['score'], 'coins' => (int) $r['coins'], 'at' => (int) $r['created_at']];
        }
        return $out;
    }

    private static function rank(int $versionId, string $by, string $playerKey): int
    {
        $order = self::order($by);
        $row = Db::one("SELECT pos FROM (
                SELECT player_key, ROW_NUMBER() OVER (ORDER BY $order) AS pos FROM (
                    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY player_key ORDER BY $order) AS rn
                    FROM scores s WHERE level_version_id = ? AND hidden = 0
                ) best WHERE rn = 1
            ) ranked WHERE player_key = ?", [$versionId, $playerKey]);
        return $row ? (int) $row['pos'] : 0;
    }

    /** Admin: replay a stored score again (e.g. after a physics change). */
    public static function reverify(array $score): RunResult
    {
        return Runner::run(Levels::loadVersion((int) $score['level_version_id']), ReplayCodec::decode((string) $score['replay']));
    }
}
