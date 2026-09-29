@echo off
rem Baut den fertigen Website-Ordner zum Hochladen auf den Server:
rem   dist\website\        (diesen Inhalt per FileZilla hochladen, siehe Anleitung-Hosting.pdf)
rem   dist\PenguinJump-website.zip
rem Hinweis: Die offiziellen Versionen (mit signierter version.json) baut GitHub bei jedem Push -
rem das ZIP liegt dann beim Release. Dieses Skript ist fuer lokale Tests oder ohne GitHub.
setlocal
cd /d "%~dp0"
node tools\build-server.mjs dist\website || goto :error
if exist dist\PenguinJump-website.zip del dist\PenguinJump-website.zip
powershell -NoProfile -Command "Compress-Archive -Path 'dist\website\*' -DestinationPath 'dist\PenguinJump-website.zip'" || goto :error
echo.
echo Fertig: dist\website und dist\PenguinJump-website.zip
explorer dist
pause
exit /b 0
:error
echo Fehler beim Bauen.
pause
exit /b 1
