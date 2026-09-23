@echo off
REM Apre il programma per provarlo. I dati sono quelli veri del computer,
REM non quelli della versione di prova nel browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Prima volta: installo quello che serve...
  call npm install
)
call npm run app
pause
