@echo off
rem Erstellt config\config.php fuer die Website (fragt nach Datenbank und E-Mail, erzeugt die Geheimnisse selbst).
rem Standard-Ordner: dist\website  -  anderer Ordner:  Konfiguration-Erstellen.cmd "C:\Pfad\zum\entpackten\website"
cd /d "%~dp0"
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-config.ps1"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-config.ps1" -Target "%~1"
)
pause
