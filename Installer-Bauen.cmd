@echo off
rem Baut das Spiel und daraus das Windows-Installationspaket.
rem Ergebnis: dist\PenguinJump-Setup.msi  (Doppelklick installiert ohne Administratorrechte)
rem Voraussetzung (einmalig):  dotnet tool install --global wix
setlocal
cd /d "%~dp0"
node tools\build-installer.mjs %*
if errorlevel 1 (
  echo.
  echo Das Installationspaket konnte nicht gebaut werden.
  pause
  exit /b 1
)
echo.
explorer dist
pause
