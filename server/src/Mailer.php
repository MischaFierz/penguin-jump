<?php
declare(strict_types=1);

namespace App;

/**
 * Minimal SMTP client (no external library): implicit TLS (port 465) or STARTTLS (587), AUTH LOGIN,
 * certificate verification always on. Configured in config.php ('mail' => [...]).
 * Without configuration the e-mail features are simply switched off.
 */
final class Mailer
{
    public static function enabled(): bool
    {
        $m = (array) Config::get('mail', []);
        return (!empty($m['host']) && !empty($m['from'])) || self::outbox() !== null;
    }

    /** Local test server only: mails are written to a file instead of being sent. */
    private static function outbox(): ?string
    {
        $f = ((array) Config::get('mail', []))['outbox'] ?? null;
        return is_string($f) && $f !== '' && PHP_SAPI === 'cli-server' ? $f : null;
    }

    public static function send(string $to, string $subject, string $text): void
    {
        if (!self::enabled()) throw new \RuntimeException('mail not configured');
        if (!filter_var($to, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $to . $subject)) throw new \InvalidArgumentException('bad address');
        if (($outbox = self::outbox()) !== null) {
            file_put_contents($outbox, '--- ' . date('c') . "\nTo: $to\nSubject: $subject\n\n$text\n\n", FILE_APPEND | LOCK_EX);
            return;
        }
        $m = (array) Config::get('mail');
        $host = (string) $m['host'];
        $port = (int) ($m['port'] ?? 587);
        $security = (string) ($m['security'] ?? ($port === 465 ? 'ssl' : 'starttls'));
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $host, 'SNI_enabled' => true]]);
        $errno = 0;
        $errstr = '';
        $s = @stream_socket_client(($security === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port, $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
        if ($s === false) throw new \RuntimeException("SMTP connect failed: $errstr");
        stream_set_timeout($s, 20);
        try {
            self::expect($s, 220);
            $ehlo = 'EHLO ' . (preg_replace('/[^A-Za-z0-9.-]/', '', (string) ($_SERVER['SERVER_NAME'] ?? 'localhost')) ?: 'localhost');
            self::cmd($s, $ehlo, 250);
            if ($security === 'starttls') {
                self::cmd($s, 'STARTTLS', 220);
                if (!stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) throw new \RuntimeException('STARTTLS failed');
                self::cmd($s, $ehlo, 250);
            }
            if (!empty($m['user'])) {
                self::cmd($s, 'AUTH LOGIN', 334);
                self::cmd($s, base64_encode((string) $m['user']), 334);
                self::cmd($s, base64_encode((string) ($m['password'] ?? '')), 235);
            }
            $from = (string) $m['from'];
            self::cmd($s, "MAIL FROM:<$from>", 250);
            self::cmd($s, "RCPT TO:<$to>", [250, 251]);
            self::cmd($s, 'DATA', 354);
            $name = (string) ($m['from_name'] ?? Config::gameName());
            $headers = [
                'From: =?UTF-8?B?' . base64_encode($name) . "?= <$from>",
                "To: <$to>",
                'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
                'Date: ' . date(DATE_RFC2822),
                'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . substr(strrchr($from, '@') ?: '@localhost', 1) . '>',
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                'Content-Transfer-Encoding: base64',
                'Auto-Submitted: auto-generated',
            ];
            $body = implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($text), 76, "\r\n") . '.';
            self::cmd($s, $body, 250);
            self::cmd($s, 'QUIT', 221);
        } finally {
            fclose($s);
        }
    }

    /** @param resource $s  @param int|list<int> $code */
    private static function cmd($s, string $line, int|array $code): void
    {
        fwrite($s, $line . "\r\n");
        self::expect($s, $code);
    }

    /** @param resource $s  @param int|list<int> $code */
    private static function expect($s, int|array $code): void
    {
        $reply = '';
        while (($line = fgets($s, 1024)) !== false) {
            $reply .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') break;
        }
        if (!in_array((int) substr($reply, 0, 3), (array) $code, true)) throw new \RuntimeException('SMTP: ' . trim(substr($reply, 0, 200)));
    }
}
