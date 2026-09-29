<?php
declare(strict_types=1);

namespace App;

use PDO;

/** Thin PDO wrapper: prepared statements only (no string-built SQL with user data anywhere). */
final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $dsn = (string) Config::get('db_dsn');
            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ];
            self::$pdo = new PDO($dsn, (string) Config::get('db_user', ''), (string) Config::get('db_password', ''), $options);
            if (self::isSqlite()) {
                self::$pdo->exec('PRAGMA foreign_keys = ON');
                self::$pdo->exec('PRAGMA busy_timeout = 5000');
            } else {
                self::$pdo->exec("SET NAMES utf8mb4, time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
            }
        }
        return self::$pdo;
    }

    public static function isSqlite(): bool
    {
        return str_starts_with((string) Config::get('db_dsn'), 'sqlite:');
    }

    /** @param array<string|int, mixed> $params */
    public static function run(string $sql, array $params = []): \PDOStatement
    {
        $st = self::pdo()->prepare($sql);
        foreach ($params as $k => $v) {
            $type = is_int($v) ? PDO::PARAM_INT : (is_bool($v) ? PDO::PARAM_BOOL : ($v === null ? PDO::PARAM_NULL : PDO::PARAM_STR));
            $st->bindValue(is_int($k) ? $k + 1 : ':' . ltrim($k, ':'), $v, $type);
        }
        $st->execute();
        return $st;
    }

    /** @param array<string|int, mixed> $params  @return array<string, mixed>|null */
    public static function one(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string|int, mixed> $params  @return list<array<string, mixed>> */
    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    public static function lastId(): int
    {
        return (int) self::pdo()->lastInsertId();
    }

    /** @template T  @param callable(): T $fn  @return T */
    public static function tx(callable $fn): mixed
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $r = $fn();
            $pdo->commit();
            return $r;
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Creates missing tables (idempotent). */
    public static function migrate(): void
    {
        $file = APP_ROOT . '/migrations/' . (self::isSqlite() ? 'sqlite.sql' : 'mysql.sql');
        $sql = (string) preg_replace('/^\s*--.*$/m', '', (string) file_get_contents($file));
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) self::pdo()->exec($stmt);
    }

    public static function isInstalled(): bool
    {
        try {
            self::run('SELECT 1 FROM accounts LIMIT 1');
            return true;
        } catch (\PDOException) {
            return false;
        }
    }
}
