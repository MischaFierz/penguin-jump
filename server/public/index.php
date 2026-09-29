<?php
declare(strict_types=1);

// Single entry point for the website and the API. Everything except this file and static
// assets lives outside the web root (../src, ../config, ../data).

// PHP's built-in test server: let it serve existing static files itself
if (PHP_SAPI === 'cli-server') {
    $static = __DIR__ . parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if ((is_file($static) && !str_ends_with($static, '.php')) || is_file(rtrim($static, '/') . '/index.html')) return false;
}

require __DIR__ . '/../src/bootstrap.php';

use App\Config;
use App\Controllers\AdminApi;
use App\Controllers\Api;
use App\Controllers\KontoApi;
use App\Controllers\Site;

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$base = rtrim((string) Config::get('base_path', ''), '/');
if ($base !== '' && str_starts_with($path, $base)) $path = substr($path, strlen($base));
$path = '/' . trim(preg_replace('#/+#', '/', $path) ?? '/', '/');
if (!in_array($method, ['GET', 'POST', 'OPTIONS', 'HEAD'], true)) { http_response_code(405); exit; }
if ($method === 'HEAD') $method = 'GET';

// HTTPS only (except local development)
if (!Config::isHttps() && Config::get('force_https', true)) {
    header('Location: https://' . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '/'), true, 308);
    exit;
}

try {
    if ($path === '/api' || str_starts_with($path, '/api/v1/')) Api::handle($path, $method);
    if (str_starts_with($path, '/konto/api/')) KontoApi::handle($path, $method);
    if (str_starts_with($path, '/admin/api/')) AdminApi::handle($path, $method);
    if (in_array($path, ['/konto', '/admin', '/play'], true)) { header('Location: ' . url($path . '/'), true, 301); exit; }
    Site::handle($path, $method);
} catch (Throwable $e) {
    error_log('Unhandled: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) http_response_code(500);
    echo 'Internal error';
}
