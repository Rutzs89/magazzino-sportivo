# Perche' `vercel.json` spegne le pubblicazioni automatiche

Il progetto su Vercel era collegato a questo repository. A ogni push, Vercel
pubblicava **la radice del repository**, dove non c'e' nessuna pagina: il sito
rispondeva 404 a tutti i suoi indirizzi.

La pagina vera sta in `sito/`, e ci finiscono anche i pacchetti scaricati dalla
release (il `.dmg` e il `.app.tar.gz` non sono versionati: sono grossi e si
rifanno a ogni versione). Quindi una pubblicazione automatica dal repository
non puo' funzionare: mancherebbero proprio i file da scaricare.

Si pubblica solo con `tools/pubblica_aggiornamento.py`, che prende i pacchetti
firmati dalla release e carica `sito/`.

Sintomo gia' pagato, il 22/09/2026: la pagina era online e funzionante, poi un
push per tutt'altro l'ha sostituita con una cartella vuota. Cercando la causa
ho accusato prima l'indirizzo corto, poi il login di Vercel (quello c'era
davvero, ed e' stato spento): nessuno dei due era il motivo per cui il sito
spariva.
