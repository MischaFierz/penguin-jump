<?php
declare(strict_types=1);

// Common setup for web requests, the API and CLI tools.

const APP_ROOT = __DIR__ . '/..';

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'App\\')) return;
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($file)) require $file;
});
// Sim.php contains helper classes next to the main class
spl_autoload_register(static function (string $class): void {
    if (in_array($class, ['App\\Replay\\SimPlayer', 'App\\Replay\\SimEnemy', 'App\\Replay\\SimPlatform'], true)) require_once __DIR__ . '/Replay/Sim.php';
    if ($class === 'App\\Replay\\RunResult') require_once __DIR__ . '/Replay/Runner.php';
});

require __DIR__ . '/helpers.php';

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('expose_php', '0');

set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
    throw new ErrorException($msg, 0, $no, $file, $line);
});

// APP_CONFIG may point to another config file, but only for the local test server / CLI
$cfg = in_array(PHP_SAPI, ['cli', 'cli-server'], true) && getenv('APP_CONFIG') ? (string) getenv('APP_CONFIG') : APP_ROOT . '/config/config.php';
App\Config::load($cfg);
date_default_timezone_set('UTC');
