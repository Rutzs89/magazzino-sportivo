@echo off
REM Costruisce il programma da installare per questo computer (Windows).
REM Per la versione Mac serve un Mac, oppure la compilazione su GitHub.
REM Il risultato finisce in src-tauri\target\release\bundle\
cd /d "%~dp0"
if not exist node_modules (
  echo Prima volta: installo quello che serve...
  call npm install
)
call npm run app:build
echo.
echo Se e' andata bene, il file da installare e' in:
echo   src-tauri\target\release\bundle\nsis\
pause
