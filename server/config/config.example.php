<?php
// Copy to config.php and fill in. config.php is NOT in git and must never be in the web root.
return [
    // Database (MySQL / MariaDB from your hosting control panel). Use a dedicated DB user with
    // rights only on this database.
    'db_dsn' => 'mysql:host=localhost;dbname=GAME_DB;charset=utf8mb4',
    'db_user' => 'GAME_DB_USER',
    'db_password' => 'CHANGE_ME',

    // Random secret, at least 64 characters, e.g. from: php -r "echo bin2hex(random_bytes(48));"
    // Used for IP pseudonyms and to encrypt 2FA keys. Changing it disables existing 2FA setups.
    'app_secret' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',

    // One-time token for https://your-domain/setup (creates tables + first admin). Remove or
    // change it after the setup; the page also locks itself once an admin exists.
    'setup_token' => 'CHANGE_ME_TO_ANOTHER_LONG_RANDOM_STRING',

    // Set if the site lives in a sub folder, e.g. '/game'. Empty for a (sub)domain of its own.
    'base_path' => '',

    // Redirect http -> https (keep true in production).
    'force_https' => true,
    // true if a proxy/CDN terminates HTTPS and sends X-Forwarded-Proto
    'behind_https_proxy' => false,

    // Origins that may call the API from a browser: the Android app's WebView.
    'api_cors_origins' => ['https://appassets.androidplatform.net'],

    'registration_open' => true,

    // Optional: shown on the privacy page (operator / contact).
    'operator' => '',
];
