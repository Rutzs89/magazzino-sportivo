@echo off
REM Lancia le verifiche automatiche e rigenera la versione di prova da browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Prima volta: installo quello che serve...
  call npm install
)
call python tools\controlla_privacy.py
if errorlevel 1 (
  echo.
  echo FERMO: ci sono nomi di atlete nei file destinati a GitHub.
  pause
  exit /b 1
)
echo.
call npm test
echo.
call npm run build:prova
echo.
echo Per provare a mano: doppio clic su dist\magazzino-sportivo-PROVA.html
pause
