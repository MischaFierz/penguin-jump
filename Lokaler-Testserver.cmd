@echo off
rem Startet die Website (Admin-Panel, Konto, Spiel im Browser, Community) lokal auf diesem PC.
rem Beim ersten Mal wird PHP heruntergeladen (ohne Installation). Beenden: Enter im Fenster.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\local-server.ps1"
if errorlevel 1 pause
