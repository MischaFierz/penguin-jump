<?php
declare(strict_types=1);

// Global template helpers (used in templates/*.php).

use App\Config;
use App\Security;
use App\View;

function h(mixed $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

function t(string $key, string ...$args): string
{
    return View::t($key, ...$args);
}

function url(string $path): string
{
    return rtrim((string) Config::get('base_path', ''), '/') . $path;
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . h(Security::csrfToken()) . '">';
}

function fmt_time(int $ticks): string
{
    $cs = intdiv($ticks * 100, 120);
    return sprintf('%d:%02d.%02d', intdiv($cs, 6000), intdiv($cs, 100) % 60, $cs % 100);
}
