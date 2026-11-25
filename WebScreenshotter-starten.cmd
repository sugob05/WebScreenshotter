@echo off
setlocal EnableExtensions DisableDelayedExpansion
title WebScreenshotter

pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo Der WebScreenshotter-Ordner konnte nicht geoeffnet werden.
  pause
  exit /b 1
)

rem Prefer the bundled runtime; source checkouts can still use installed Node.js.
set "webScreenshotterNode=%~dp0runtime\node\node.exe"
if exist "%webScreenshotterNode%" goto node_ready
where node.exe >nul 2>&1
if errorlevel 1 goto missing_node
set "webScreenshotterNode=node.exe"
:node_ready
"%webScreenshotterNode%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto old_node
if not exist "server.js" goto missing_files

"%webScreenshotterNode%" -e "try { for (const name of ['playwright-core', 'saxes', 'pdf-lib', '@pdf-lib/upng']) require.resolve(name); } catch { process.exit(1); }" >nul 2>&1
if errorlevel 1 goto missing_packages

echo WebScreenshotter wird gestartet. Die Oberflaeche oeffnet sich im Standardbrowser.
echo Dieses Fenster waehrend der Nutzung geoeffnet lassen. Beenden mit Strg+C.
echo.
"%webScreenshotterNode%" server.js --open %*
set "webScreenshotterExit=%errorlevel%"
if not "%webScreenshotterExit%"=="0" (
  echo.
  echo WebScreenshotter wurde mit einem Fehler beendet. Siehe Meldung oben.
  pause
)
popd
exit /b %webScreenshotterExit%

:missing_node
echo Die mitgelieferte Node.js-Laufzeit fehlt oder ist nicht startbar.
echo Bitte das gesamte Windows-Portable-Paket entpacken.
echo Fuer den Quellcode wird alternativ Node.js ab Version 22 benoetigt.
echo.
echo Installationsanleitung: README.md, Abschnitt "Portables Node.js einrichten".
echo Dort steht Schritt fuer Schritt, wo Sie Node.js herunterladen und ablegen.
echo Die README.md liegt direkt neben dieser CMD-Datei.
echo Fuer die bebilderte Ansicht ANLEITUNG.html im Browser oeffnen.
goto failed

:old_node
echo WebScreenshotter benoetigt Node.js ab Version 22.
echo Bitte Node.js aktualisieren: https://nodejs.org/
echo Anleitung: README.md, Abschnitt "Portables Node.js einrichten".
goto failed

:missing_files
echo server.js fehlt. Bitte das gesamte WebScreenshotter-Paket entpacken.
echo Diese CMD-Datei muss direkt neben server.js liegen.
goto failed

:missing_packages
echo JavaScript-Pakete fehlen. Bitte alle Dateien einschliesslich
echo runtime und node_modules entpacken. Das portable Paket benoetigt
echo keine Installation und keinen Download beim Start.
echo Bei einem Quellcode-Checkout bitte zuvor npm ci ausfuehren.
echo Anleitung: README.md, Abschnitt "Start aus dem Git-Quellcode".

:failed
echo.
pause
popd
exit /b 1
