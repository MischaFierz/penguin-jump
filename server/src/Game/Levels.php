<?php
declare(strict_types=1);

namespace App\Game;

use App\Accounts\Nickname;
use App\Config;
use App\Db;
use App\Replay\Level;
use App\Security;

/**
 * All levels live in the database:
 *  - main levels ("1-1" ...): edited and published by admins, delivered to the games as a level pack
 *  - community levels ("c12"): built by players, published after the author proved they can be finished
 * The editable state is the draft; publishing freezes it into an immutable version (content hash).
 */
final class Levels
{
    public const MAX_PER_ACCOUNT = 50;

    // ------------------------------------------------------------------ reading
    /** @return array<string, mixed>|null */
    public static function byCode(string $code): ?array
    {
        if (!preg_match('/^(\d{1,2}-\d{1,2}|c\d{1,9})$/', $code)) return null;
        return Db::one('SELECT * FROM levels WHERE game_id = ? AND code = ?', [Config::gameId(), $code]);
    }

    /** @return array<string, mixed>|null the published version of a playable level */
    public static function published(string $code): ?array
    {
        $l = self::byCode($code);
        if ($l === null || $l['status'] !== 'published' || $l['current_version_id'] === null) return null;
        return Db::one('SELECT * FROM level_versions WHERE id = ?', [(int) $l['current_version_id']]) + ['level' => $l];
    }

    public static function exists(string $code): bool
    {
        return self::published($code) !== null;
    }

    public static function loadVersion(int $versionId): Level
    {
        $v = Db::one('SELECT data FROM level_versions WHERE id = ?', [$versionId]) ?? throw new \InvalidArgumentException('unknown version');
        return Level::parse((string) $v['data'], 'v' . $versionId);
    }

    /**
     * The published main levels in game order, as delivered to the games.
     * @return array{version: string, levels: list<array{id: string, world: int, title: string, hash: string, data: string}>}
     */
    public static function mainPack(): array
    {
        $rows = Db::all("SELECT l.code, l.world, l.title, v.hash, v.data FROM levels l JOIN level_versions v ON v.id = l.current_version_id
            WHERE l.game_id = ? AND l.kind = 'main' AND l.status = 'published' ORDER BY l.sort, l.code", [Config::gameId()]);
        $levels = array_map(static fn($r) => ['id' => (string) $r['code'], 'world' => (int) $r['world'], 'title' => (string) $r['title'],
            'hash' => (string) $r['hash'], 'data' => (string) $r['data']], $rows);
        return ['version' => substr(hash('sha256', implode('|', array_column($levels, 'hash'))), 0, 16), 'levels' => $levels];
    }

    /** @return list<string> codes of the published main levels (game order) */
    public static function mainCodes(): array
    {
        return array_column(self::mainPack()['levels'], 'id');
    }

    // ------------------------------------------------------------------ versions
    /** Stores the current draft as an immutable version (or finds the identical one). */
    public static function draftVersion(array $level): int
    {
        $p = LevelFormat::split((string) $level['draft']);
        $hash = LevelFormat::hash($p['world'], $p['rows'], $p['signs']);
        $v = Db::one('SELECT id FROM level_versions WHERE level_id = ? AND hash = ?', [$level['id'], $hash]);
        if ($v !== null) return (int) $v['id'];
        Db::run('INSERT INTO level_versions (level_id, hash, data, created_at) VALUES (?, ?, ?, ?)',
            [$level['id'], $hash, LevelFormat::text((string) $level['code'], $p['world'], $p['rows'], $p['signs']), time()]);
        return Db::lastId();
    }

    /** First install: the 12 levels from the game become the published main levels. */
    public static function seedMain(): void
    {
        if (Db::one("SELECT id FROM levels WHERE game_id = ? AND kind = 'main' LIMIT 1", [Config::gameId()]) !== null) return;
        $dir = APP_ROOT . '/data/levels';
        $index = is_file("$dir/index.json") ? json_decode((string) file_get_contents("$dir/index.json"), true) : [];
        foreach (is_array($index) ? $index : [] as $i => $file) {
            if (!is_string($file) || !preg_match('/^[a-z0-9_]+\.txt$/', $file) || !is_file("$dir/$file")) continue;
            $text = (string) file_get_contents("$dir/$file");
            if (!preg_match('/^id=(\d{1,2}-\d{1,2})$/m', $text, $m)) continue;
            $p = LevelFormat::split($text);
            $now = time();
            Db::run("INSERT INTO levels (game_id, kind, code, title, world, sort, status, draft, draft_updated_at, created_at, published_at) VALUES (?, 'main', ?, '', ?, ?, 'published', ?, ?, ?, ?)",
                [Config::gameId(), $m[1], $p['world'], ($i + 1) * 10, LevelFormat::text($m[1], $p['world'], $p['rows'], $p['signs']), $now, $now, $now]);
            $level = self::byCode($m[1]);
            Db::run('UPDATE levels SET current_version_id = ? WHERE id = ?', [self::draftVersion($level), $level['id']]);
        }
    }

    // ------------------------------------------------------------------ community
    public static function validTitle(string $title, ?string &$clean): ?string
    {
        $clean = trim((string) preg_replace('/\s+/u', ' ', $title));
        if (mb_strlen($clean) < 3 || mb_strlen($clean) > 40 || preg_match('/[\p{Cc}\p{Cf}<>]/u', $clean)) return 'title_format';
        if (Nickname::isOffensive($clean)) return 'title_bad';
        return null;
    }

    /** @return array<string, mixed> public description of a level (no tile data) */
    public static function describe(array $l, ?int $viewer = null): array
    {
        return [
            'id' => (string) $l['code'], 'title' => (string) $l['title'], 'author' => (string) ($l['author'] ?? ''), 'world' => (int) $l['world'],
            'likes' => (int) $l['likes'], 'plays' => (int) $l['plays'], 'publishedAt' => (int) ($l['published_at'] ?? 0),
            'liked' => $viewer !== null && isset($l['liked']) && (int) $l['liked'] > 0,
        ];
    }

    /** @return array{levels: list<array<string, mixed>>, total: int} */
    public static function communityList(string $sort, string $q, int $page, ?int $viewer): array
    {
        $order = match ($sort) { 'top' => 'l.likes DESC, l.plays DESC', 'plays' => 'l.plays DESC, l.likes DESC', default => 'l.published_at DESC' };
        $where = "l.game_id = ? AND l.kind = 'community' AND l.status = 'published'";
        $params = [Config::gameId()];
        if ($q !== '') {
            $where .= " AND (l.title LIKE ? ESCAPE '!' OR a.username LIKE ? ESCAPE '!')";
            $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
            array_push($params, $like, $like);
        }
        $total = (int) (Db::one("SELECT COUNT(*) AS n FROM levels l JOIN accounts a ON a.id = l.author_id WHERE $where", $params)['n'] ?? 0);
        $rows = Db::all("SELECT l.*, a.username AS author, (SELECT COUNT(*) FROM level_likes k WHERE k.level_id = l.id AND k.account_id = ?) AS liked
            FROM levels l JOIN accounts a ON a.id = l.author_id WHERE $where ORDER BY $order, l.id DESC LIMIT 20 OFFSET ?",
            array_merge([$viewer ?? 0], $params, [max(0, $page - 1) * 20]));
        return ['levels' => array_map(static fn($r) => self::describe($r, $viewer), $rows), 'total' => $total];
    }

    /** @return array<string, mixed>|null published community or main level incl. data */
    public static function playable(string $code, ?int $viewer): ?array
    {
        $v = self::published($code);
        if ($v === null) return null;
        $l = Db::one('SELECT l.*, a.username AS author, (SELECT COUNT(*) FROM level_likes k WHERE k.level_id = l.id AND k.account_id = ?) AS liked
            FROM levels l LEFT JOIN accounts a ON a.id = l.author_id WHERE l.id = ?', [$viewer ?? 0, $v['level']['id']]);
        return self::describe($l, $viewer) + ['data' => (string) $v['data'], 'hash' => (string) $v['hash']];
    }

    /** @return list<array<string, mixed>> the player's own levels incl. drafts */
    public static function mine(int $accountId): array
    {
        $rows = Db::all("SELECT l.*, v.hash AS published_hash FROM levels l LEFT JOIN level_versions v ON v.id = l.current_version_id
            WHERE l.game_id = ? AND l.author_id = ? ORDER BY l.draft_updated_at DESC", [Config::gameId(), $accountId]);
        return array_map(static function ($r) {
            $p = LevelFormat::split((string) $r['draft']);
            return ['id' => (string) $r['code'], 'title' => (string) $r['title'], 'world' => (int) $r['world'], 'status' => (string) $r['status'],
                'likes' => (int) $r['likes'], 'plays' => (int) $r['plays'], 'updatedAt' => (int) $r['draft_updated_at'],
                'changed' => $r['published_hash'] !== LevelFormat::hash($p['world'], $p['rows'], $p['signs']),
                'rows' => $p['rows']];
        }, $rows);
    }

    /** Creates or updates a draft. @return array<string, mixed>|string the level or an error key */
    public static function saveDraft(int $accountId, ?string $code, string $title, int $world, array|string $tiles): array|string
    {
        if ($e = self::validTitle($title, $clean)) return $e;
        $rows = LevelFormat::rows($tiles, false);
        if (is_string($rows)) return $rows;
        $world = max(1, min(4, $world));
        $now = time();
        if ($code === null) {
            $n = (int) (Db::one('SELECT COUNT(*) AS n FROM levels WHERE author_id = ?', [$accountId])['n'] ?? 0);
            if ($n >= self::MAX_PER_ACCOUNT) return 'too_many_levels';
            Db::run("INSERT INTO levels (game_id, kind, code, title, author_id, world, status, draft, draft_updated_at, created_at) VALUES (?, 'community', ?, ?, ?, ?, 'draft', '', ?, ?)",
                [Config::gameId(), 'tmp' . bin2hex(random_bytes(5)), $clean, $accountId, $world, $now, $now]);
            $id = Db::lastId();
            $code = 'c' . $id;
            Db::run('UPDATE levels SET code = ? WHERE id = ?', [$code, $id]);
        }
        $l = self::byCode($code);
        if ($l === null || (int) $l['author_id'] !== $accountId) return 'not_found';
        Db::run('UPDATE levels SET title = ?, world = ?, draft = ?, draft_updated_at = ? WHERE id = ?',
            [$clean, $world, LevelFormat::text($code, $world, $rows), $now, $l['id']]);
        return self::byCode($code);
    }

    /** Publishing requires a server-verified run of exactly this draft by its author (see Scores::verify). */
    public static function publishVerified(array $level, int $versionId, int $ticks): void
    {
        Db::run('UPDATE level_versions SET verified_ticks = ? WHERE id = ?', [$ticks, $versionId]);
        Db::run("UPDATE levels SET status = 'published', current_version_id = ?, published_at = COALESCE(published_at, ?) WHERE id = ?",
            [$versionId, time(), $level['id']]);
        Security::audit('level_published', (int) $level['author_id'], (string) $level['code'] . ' ' . $level['title']);
    }

    public static function unpublish(array $level): void
    {
        Db::run("UPDATE levels SET status = 'draft' WHERE id = ?", [$level['id']]);
    }

    public static function delete(array $level): void
    {
        Db::run('DELETE FROM scores WHERE game_id = ? AND level_code = ?', [Config::gameId(), $level['code']]);
        Db::run('DELETE FROM levels WHERE id = ?', [$level['id']]);
    }

    /** @return array{liked: bool, likes: int} */
    public static function toggleLike(array $level, int $accountId): array
    {
        $had = Db::one('SELECT 1 AS x FROM level_likes WHERE level_id = ? AND account_id = ?', [$level['id'], $accountId]) !== null;
        if ($had) Db::run('DELETE FROM level_likes WHERE level_id = ? AND account_id = ?', [$level['id'], $accountId]);
        else Db::run('INSERT INTO level_likes (level_id, account_id, created_at) VALUES (?, ?, ?)', [$level['id'], $accountId, time()]);
        Db::run('UPDATE levels SET likes = (SELECT COUNT(*) FROM level_likes WHERE level_id = ?) WHERE id = ?', [$level['id'], $level['id']]);
        return ['liked' => !$had, 'likes' => (int) Db::one('SELECT likes FROM levels WHERE id = ?', [$level['id']])['likes']];
    }

    public static function report(array $level, ?int $accountId, string $reason): void
    {
        Db::run('INSERT INTO level_reports (level_id, account_id, reason, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)',
            [$level['id'], $accountId, mb_substr(trim($reason), 0, 200), Security::ipHash(), time()]);
        Db::run('UPDATE levels SET reports = reports + 1 WHERE id = ?', [$level['id']]);
    }

    /** Counts a play once per level and visitor (pseudonymised, rotates daily). */
    public static function countPlay(int $levelId): void
    {
        try {
            Db::run('INSERT INTO level_plays (level_id, ip_hash) VALUES (?, ?)', [$levelId, Security::ipHash()]);
            Db::run('UPDATE levels SET plays = plays + 1 WHERE id = ?', [$levelId]);
        } catch (\PDOException) {
            // already counted
        }
    }

    /** "1-1" -> world number (website grouping) */
    public static function world(string $code): int
    {
        return (int) explode('-', $code)[0];
    }
}
