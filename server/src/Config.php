<?php
declare(strict_types=1);

namespace App;

/** Server configuration from config/config.php (never in the web root, never in git). */
final class Config
{
    /** @var array<string, mixed> */
    private static array $c = [];
    /** @var array<string, mixed> */
    private static array $game = [];

    public static function load(string $file): void
    {
        if (!is_file($file)) {
            http_response_code(503);
            header('Content-Type: text/plain; charset=utf-8');
            exit("Server not configured yet: copy config/config.example.php to config/config.php and fill it in.\n");
        }
        self::$c = require $file;
        foreach (['db_dsn', 'app_secret'] as $k) {
            if (empty(self::$c[$k])) throw new \RuntimeException("config.php: '$k' is missing");
        }
        if (strlen((string) self::$c['app_secret']) < 64) throw new \RuntimeException("config.php: 'app_secret' must be at least 64 characters");
        $gameFile = APP_ROOT . '/data/game.json';
        self::$game = is_file($gameFile) ? json_decode((string) file_get_contents($gameFile), true, 16, JSON_THROW_ON_ERROR) : ['name' => 'Game'];
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::$c[$key] ?? $default;
    }

    public static function gameName(): string
    {
        return (string) (self::$game['name'] ?? 'Game');
    }

    /** Stable id of this game in the shared database (several games can share one account system). */
    public static function gameId(): string
    {
        return (string) (self::$c['game_id'] ?? preg_replace('/[^a-z0-9]/', '', strtolower(self::gameName())));
    }

    public static function repo(): string
    {
        return (string) (self::$game['repo'] ?? '');
    }

    public static function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443
            || (self::get('behind_https_proxy', false) && ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    }

    /** Derives an independent key for one purpose from the app secret. */
    public static function key(string $purpose): string
    {
        return hash_hmac('sha256', $purpose, (string) self::$c['app_secret'], true);
    }
}
