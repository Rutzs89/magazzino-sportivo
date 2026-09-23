# Magazzino Sportivo

Programma per gestire il magazzino divise e materiale di una società sportiva:
chi ha cosa, cosa c'è in casa, cosa manca, stagione dopo stagione.

Si installa su Mac e Windows. **I dati restano sul computer**, in un file che
nessun altro vede: niente rete, niente account, nessun servizio esterno. Ogni
giorno in cui lo usi mette via una copia, e tiene le ultime trenta.

Non è legato a nessuna società: nome e stemma si caricano dalle Impostazioni, e
il programma nasce vuoto. Si riempie da quattro fogli Excel — articoli, squadre
e atlete, divise, richieste — che si scaricano dal programma stesso, si fanno
compilare e si ricaricano.

## Per usarlo

- **Provarlo dal browser**, senza installare niente: doppio clic su
  `dist/magazzino-sportivo-PROVA.html`. I dati restano in quel browser.
- **Il programma vero**: `avvia.bat` per aprirlo, `crea-programma.bat` per
  costruire il file da installare, `prove.bat` per le verifiche.

## Per lavorarci

Apri questa cartella in Claude Code. Il contesto completo, le scelte fatte e le
trappole già pagate stanno in `CLAUDE.md`.

La cartella `data/` non è versionata: contiene i dati veri di una società, e
sono spesso ragazze minorenni. `npm run privacy` controlla che nessun nome
finisca nei file destinati a GitHub, e parte da solo dentro `prove.bat`.
