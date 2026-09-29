# Creates config/config.php for the website: asks for the database (and optional mailbox) and
# generates the secret keys itself. Run via Konfiguration-Erstellen.cmd.
param(
    [string]$Target = '',           # folder of the website (contains config\), default: dist\website
    [string]$DbName, [string]$DbUser, [string]$DbPassword,
    [string]$MailHost, [string]$MailUser, [string]$MailPassword, [string]$MailFrom,
    [switch]$Quiet                  # no questions (all values as parameters)
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Target) { $Target = Join-Path $root 'dist\website' }
$cfgDir = Join-Path $Target 'config'
if (-not (Test-Path $cfgDir)) { throw "Ordner $cfgDir fehlt. Zuerst Website-Paket-Bauen.cmd ausfuehren oder das Website-ZIP entpacken." }

function Ask($text, $default = '') {
    if ($Quiet) { return $default }
    $v = Read-Host ($(if ($default) { "$text [$default]" } else { $text }))
    if ([string]::IsNullOrWhiteSpace($v)) { return $default } else { return $v.Trim() }
}
function Secret([int]$bytes) { $b = New-Object byte[] $bytes; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' }
function Q($s) { "'" + ($s -replace '\\', '\\' -replace "'", "\'") + "'" }

if (-not $Quiet) {
    Write-Host ''
    Write-Host 'Konfiguration fuer die Website'
    Write-Host '-------------------------------'
    Write-Host 'Die Datenbank-Angaben findest du in HestiaCP unter DB (siehe Anleitung, Schritt 4).'
    Write-Host ''
}
$DbName = Ask 'Datenbank-Name (z.B. web_spiel)' $DbName
$DbUser = Ask 'Datenbank-Benutzer (z.B. web_spiel)' $(if ($DbUser) { $DbUser } else { $DbName })
if (-not $DbPassword -and -not $Quiet) {
    $sec = Read-Host 'Datenbank-Passwort' -AsSecureString
    $DbPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not $Quiet) {
    Write-Host ''
    Write-Host 'E-Mail (freiwillig, fuer Bestaetigungs- und Passwort-Codes). Leer lassen = ohne E-Mail.'
}
$MailHost = Ask 'Mailserver (z.B. mail.domain-a.ch)' $MailHost
if ($MailHost) {
    $MailUser = Ask 'Mail-Benutzer (z.B. spiel@domain-a.ch)' $MailUser
    if (-not $MailPassword -and -not $Quiet) {
        $sec = Read-Host 'Mail-Passwort' -AsSecureString
        $MailPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    }
    $MailFrom = Ask 'Absender-Adresse' $(if ($MailFrom) { $MailFrom } else { $MailUser })
}

$appSecret = Secret 48
$setupToken = Secret 16
$mail = if ($MailHost) { "    'mail' => ['host' => $(Q $MailHost), 'port' => 587, 'security' => 'starttls', 'user' => $(Q $MailUser), 'password' => $(Q $MailPassword), 'from' => $(Q $MailFrom)]," } else { "    // 'mail' => ['host' => 'mail.domain-a.ch', 'port' => 587, 'security' => 'starttls', 'user' => '...', 'password' => '...', 'from' => '...']," }
$php = @"
<?php
// Created by Konfiguration-Erstellen.cmd. Keep this file secret (it is never in git).
return [
    'db_dsn' => $(Q "mysql:host=localhost;dbname=$DbName;charset=utf8mb4"),
    'db_user' => $(Q $DbUser),
    'db_password' => $(Q $DbPassword),
    'app_secret' => '$appSecret',
    'setup_token' => '$setupToken',
    'base_path' => '',
    'force_https' => true,
    'behind_https_proxy' => false,
    'api_cors_origins' => ['https://appassets.androidplatform.net'],
$mail
    'operator' => '',
];
"@
$file = Join-Path $cfgDir 'config.php'
[IO.File]::WriteAllText($file, $php, (New-Object Text.UTF8Encoding $false))
Write-Host ''
Write-Host "Gespeichert: $file"
Write-Host ''
Write-Host "SETUP-TOKEN (fuer https://DEINE-SPIEL-DOMAIN/setup):  $setupToken"
Write-Host 'Notiere ihn - er steht auch in config.php.'
