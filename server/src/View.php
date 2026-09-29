<?php
declare(strict_types=1);

namespace App;

/** Language selection (EN/FR/DE) and template rendering with mandatory output escaping. */
final class View
{
    public const LANGS = ['en' => 'English', 'fr' => 'Français', 'de' => 'Deutsch'];
    private static string $lang = 'en';
    /** @var array<string, string> */
    private static array $strings = [];

    public static function initLang(): void
    {
        $lang = $_COOKIE['lang'] ?? null;
        if (!is_string($lang) || !isset(self::LANGS[$lang])) {
            $lang = 'en';
            foreach (explode(',', (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')) as $part) {
                $code = strtolower(substr(trim($part), 0, 2));
                if (isset(self::LANGS[$code])) { $lang = $code; break; }
            }
        }
        self::$lang = $lang;
        $game = APP_ROOT . "/data/lang/$lang.json";
        $gameStrings = is_file($game) ? (json_decode((string) file_get_contents($game), true) ?: []) : [];
        self::$strings = array_merge(require APP_ROOT . '/src/lang/en.php', $lang !== 'en' ? require APP_ROOT . "/src/lang/$lang.php" : [], array_filter($gameStrings, 'is_string'));
    }

    public static function lang(): string
    {
        return self::$lang;
    }

    public static function t(string $key, string ...$args): string
    {
        $s = self::$strings[$key] ?? $key;
        foreach ($args as $i => $a) $s = str_replace('{' . $i . '}', $a, $s);
        return $s;
    }

    /** @param array<string, mixed> $vars */
    public static function render(string $template, array $vars = [], int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-store');
        Security::pageHeaders();
        $vars['content'] = self::capture($template, $vars);
        echo self::capture('layout', $vars);
        exit;
    }

    /** @param array<string, mixed> $vars */
    private static function capture(string $template, array $vars): string
    {
        extract($vars, EXTR_SKIP);
        ob_start();
        require APP_ROOT . "/templates/$template.php";
        return (string) ob_get_clean();
    }

    public static function redirect(string $path): never
    {
        // only local paths: no open redirects
        if (!str_starts_with($path, '/') || str_starts_with($path, '//') || str_contains($path, '\\')) $path = '/';
        header('Location: ' . url($path), true, 303);
        exit;
    }

    public static function flash(string $msg, string $kind = 'ok'): void
    {
        $_SESSION['_flash'] = ['msg' => $msg, 'kind' => $kind];
    }

    /** @return array{msg: string, kind: string}|null */
    public static function takeFlash(): ?array
    {
        $f = $_SESSION['_flash'] ?? null;
        unset($_SESSION['_flash']);
        return is_array($f) ? $f : null;
    }
}
