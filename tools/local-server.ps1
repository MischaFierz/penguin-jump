# Local test server for the website (admin panel, account panel, web game, community) on this PC.
# - downloads a portable PHP once (checksum verified) into %LOCALAPPDATA%\PenguinJump-Testserver
# - builds the website from the project and runs it with a local SQLite database
# - e-mails (confirmation codes) are written to postausgang.txt instead of being sent
# Nothing is installed; delete the folder to remove everything.
param([switch]$Check)  # -Check: start, test that the setup page answers, stop (no browser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $env:LOCALAPPDATA 'PenguinJump-Testserver'
$port = 8080
New-Item -ItemType Directory -Force $dir | Out-Null

# ---------------------------------------------------------------- PHP (portable)
$php = Join-Path $dir 'php\php.exe'
if (-not (Test-Path $php)) {
    Write-Host 'PHP wird einmalig heruntergeladen ...'
    $rel = Invoke-RestMethod 'https://downloads.php.net/~windows/releases/releases.json'
    $v = $rel.'8.3'
    $build = $v.PSObject.Properties | Where-Object { $_.Name -like 'nts-vs*-x64' } | Select-Object -First 1
    $zipUrl = 'https://downloads.php.net/~windows/releases/' + $build.Value.zip.path
    $zip = Join-Path $dir 'php.zip'
    Invoke-WebRequest $zipUrl -OutFile $zip
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $build.Value.zip.sha256.ToLower()) { Remove-Item $zip; throw 'PHP-Download: Pruefsumme stimmt nicht - abgebrochen.' }
    Expand-Archive $zip (Join-Path $dir 'php') -Force
    Remove-Item $zip
    $ini = Get-Content (Join-Path $dir 'php\php.ini-development')
    $ini = $ini -replace '^;extension_dir = "ext"', 'extension_dir = "ext"'
    foreach ($e in 'pdo_sqlite', 'sqlite3', 'sodium', 'openssl', 'mbstring') { $ini = $ini -replace "^;extension=$e", "extension=$e" }
    Set-Content (Join-Path $dir 'php\php.ini') $ini -Encoding ascii
}

# ---------------------------------------------------------------- website + config
Write-Host 'Website wird gebaut ...'
& node (Join-Path $root 'tools\build-server.mjs') (Join-Path $dir 'website') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Website konnte nicht gebaut werden (ist Node.js installiert?)' }

$tokenFile = Join-Path $dir 'setup-token.txt'
if (-not (Test-Path $tokenFile)) { Set-Content $tokenFile ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N').Substring(0, 8)) -NoNewline }
$token = (Get-Content $tokenFile -Raw).Trim()
$secretFile = Join-Path $dir 'app-secret.txt'
if (-not (Test-Path $secretFile)) { Set-Content $secretFile ((1..3 | ForEach-Object { [guid]::NewGuid().ToString('N') }) -join '') -NoNewline }
$secret = (Get-Content $secretFile -Raw).Trim()
$db = (Join-Path $dir 'testdaten.sqlite') -replace '\\', '/'
$outbox = (Join-Path $dir 'postausgang.txt') -replace '\\', '/'
$config = Join-Path $dir 'config.php'
Set-Content $config @"
<?php return [
    'db_dsn' => 'sqlite:$db',
    'app_secret' => '$secret',
    'setup_token' => '$token',
    'force_https' => false,
    'api_cors_origins' => ['https://appassets.androidplatform.net'],
    'mail' => ['outbox' => '$outbox'],
];
"@ -Encoding utf8

# ---------------------------------------------------------------- start (hidden) and wait
$env:APP_CONFIG = $config
$public = Join-Path $dir 'website\public'
$proc = Start-Process -FilePath $php -ArgumentList '-S', "127.0.0.1:$port", '-t', "`"$public`"", "`"$public\index.php`"" -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 800

Write-Host ''
Write-Host '============================================================'
Write-Host "  Testserver laeuft:   http://127.0.0.1:$port/"
Write-Host ''
Write-Host "  Erster Start:        http://127.0.0.1:$port/setup"
Write-Host "  Setup-Token:         $token"
Write-Host "  Admin-Panel:         http://127.0.0.1:$port/admin/"
Write-Host "  Spieler-Konto:       http://127.0.0.1:$port/konto/"
Write-Host "  Spiel im Browser:    http://127.0.0.1:$port/play/?localserver"
Write-Host "  E-Mails landen in:   $($outbox -replace '/', '\')"
Write-Host ''
Write-Host '  Desktop-Spiel (Entwicklerversion) mit diesem Server verbinden:'
Write-Host "    set GAME_BASE_URL=http://127.0.0.1:$port   und dann das Spiel starten"
Write-Host '============================================================'
Write-Host ''
if ($Check) {
    $code = (Invoke-WebRequest "http://127.0.0.1:$port/setup" -UseBasicParsing).StatusCode
    Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
    Write-Host "CHECK setup page: $code"
    exit 0
}
Start-Process "http://127.0.0.1:$port/setup"
Read-Host 'Enter druecken, um den Testserver zu beenden'
Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
Write-Host 'Testserver beendet. Die Testdaten bleiben erhalten (Ordner loeschen = alles weg):'
Write-Host "  $dir"
