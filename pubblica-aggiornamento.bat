@echo off
REM Mette online la versione nuova: prende i pacchetti firmati dalla release di
REM GitHub e pubblica la pagina da cui si scarica.
REM Prima serve: versione alzata, tag vX.Y.Z spinto, compilazione su GitHub finita.
cd /d "%~dp0"
python tools\pubblica_aggiornamento.py %*
pause
