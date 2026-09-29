# Penguin Jump

A jump-and-run game with a penguin: 12 levels in 4 worlds, 17 languages, online leaderboards with
server-side verification. One code base per platform, shared levels and translations:

| Part | Folder | Technology |
|---|---|---|
| Desktop game (Windows, Linux, macOS) | `Claude Game/` | C# / .NET 10 / raylib |
| Web game (browser, installable PWA) | `web/` | JavaScript, canvas |
| Android app | `android/` | WebView around the web game + native updater |
| Website, leaderboards, accounts | `server/` | PHP 8.1+, MySQL/MariaDB, no external libraries |
| Levels, translations | `shared/` | text / JSON |

The game name, package id, server address and update key live in **`game.json`** - change them there.

## How cheating is prevented

* **Highscores are replayed on the server.** The game records the player's inputs (6 bits per 1/120 s tick).
  The server runs the same physics (`server/src/Replay/Sim.php`) and stores only the time and points *it*
  computed. C#, JavaScript and PHP produce bit-identical results (plain IEEE double math, own sine function);
  `tests/determinism.mjs` checks this for every level on every build.
* A run id must be fetched when the level starts; it is single-use, bound to the level, and the real time between
  start and submission must be at least the game time (no fast-forwarding, no pre-recorded runs).
* **Updates are signed.** `version.json` is signed with an ECDSA P-256 key (`tools/make-manifest.mjs`, key only in the
  GitHub secret). Desktop and Android verify the signature with the public key from `game.json` and check the
  SHA-256 of every download; Android additionally requires the same app signing certificate.
* Save files carry an HMAC checksum (key injected at build time); edited saves lose their progress.

## Website security

Strict Content-Security-Policy (no inline scripts, no third parties), HSTS, CSRF tokens + Origin checks,
`SameSite=Strict`/`__Host-` session cookies, prepared statements only, output escaping everywhere,
Argon2id password hashes, rate limits (login, registration, submissions), one-time recovery codes instead of
e-mail, TOTP two-factor authentication for admins, audit log, pseudonymised IP addresses (daily-rotating keyed hash),
code/config/data outside the web root, account deletion (all data) for players.

## Setting up the webspace (one time)

1. Hosting with PHP 8.1+ (extensions `pdo_mysql`, `sodium`, `mbstring`) and a MySQL/MariaDB database. Create the
   database and a user that only has rights on it. Enable HTTPS (Let's Encrypt) for the domain.
2. Put your domain into `game.json` → `"baseUrl": "https://your-domain.ch"` and push (the desktop and Android
   builds need it for updates and leaderboards; the web game finds its server automatically).
3. Download `PenguinJump-website.zip` from the latest [release](../../releases) and upload its content.
   Best: let the domain point to the **`public`** folder. If the hosting cannot do that, upload everything into the
   web root - the root `.htaccess` then routes all requests into `public/` and blocks the other folders.
4. Copy `config/config.example.php` to `config/config.php` and fill it in (database, `app_secret`, `setup_token`).
5. Open `https://your-domain.ch/setup`, enter the setup token and create the admin account.
   Log in, scan the 2FA key into an authenticator app. Done.

**New versions:** every push to `main` builds and tests everything and creates a GitHub release. To publish it,
upload the new `PenguinJump-website.zip` (keep your `config/config.php`). Players' games then offer the update.

## GitHub secrets

| Secret | Content |
|---|---|
| `UPDATE_SIGNING_KEY` | ECDSA P-256 private key (PEM) - signs `version.json` |
| `ANDROID_KEYSTORE_B64` | base64 of the PKCS#12 Android keystore (alias `release`) |
| `ANDROID_KEYSTORE_PASSWORD` | its password |
| `SAVE_HMAC_KEY` | random hex string for save-file checksums |

Keep an offline backup of these keys: without them existing installations cannot be updated.

## Development

```
dotnet run --project "Claude Game"                       # desktop game
node tools/build-web.mjs && npx http-server web          # web game (or open web/index.html)
node tests/determinism.mjs <game exe> <php>              # C# = JS = PHP physics check
node tests/server-test.mjs <php>                         # website + API end-to-end (SQLite)
node tools/build-server.mjs                              # website package in dist/website
```
