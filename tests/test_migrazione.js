/* Prova del passaggio alla versione nuova con i dati di una societa' vera.
 *
 * Il cliente ha un archivio salvato dalla versione precedente: articoli senza
 * codice corto, movimenti senza il legame fra quelli della stessa operazione,
 * nessun "ordinati", nessun collegamento fra schede. Qui si apre il programma
 * nuovo su quell'archivio e si controlla che:
 *   - ogni articolo riceva un codice, unico, senza toccare nient'altro;
 *   - il codice gia' presente su un articolo resti quello;
 *   - atleti, divise, materiale, richieste e movimenti restino identici;
 *   - le proposte restino le stesse;
 *   - riaprendo il programma i codici non cambino;
 *   - un movimento registrato dalla versione vecchia si possa annullare;
 *   - riprendendo una copia vecchia, senza codici, i codici arrivino subito.
 *
 * Uso: node tests/test_migrazione.js (dopo npm run build:app).
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const datiProve = require("./dati_prove");

const PAGINA = "src-tauri/dist/index.html";
if (!fs.existsSync(PAGINA)) {
  console.error("Manca " + PAGINA + ": lancia prima npm run build:app");
  process.exit(1);
}
const html = fs.readFileSync(PAGINA, "utf8");

/* ---- l'archivio come l'ha salvato la versione precedente ---- */
const pronto = datiProve.archivioPronto();
const vecchio = pronto ? JSON.parse(fs.readFileSync(pronto)) : datiProve.seed();
for (const a of vecchio.settings.main.articoli) delete a.codice; // la versione vecchia non li aveva
// un articolo ha gia' un codice (scritto a mano): deve restare suo
const conCodice = vecchio.settings.main.articoli[3];
conCodice.codice = "A005";
// una consegna di divisa fatta con la versione vecchia: niente "gruppo"
const aid = Object.keys(vecchio.atlete)[0];
const libera = Object.keys(vecchio.divise).find((k) => !vecchio.divise[k].holder && !vecchio.divise[k].dismessa);
vecchio.divise[libera] = { ...vecchio.divise[libera], holder: aid, daRestituire: false };
vecchio.movimenti = {
  VECCHIO1: {
    ts: 1, data: "2026-09-20", stagione: vecchio.settings.main.stagione, tipo: "CONSEGNA",
    atletaId: aid, articolo: "DIVISA GARA", taglia: vecchio.divise[libera].taglia,
    qta: 1, divisaId: libera, numero: vecchio.divise[libera].numero,
    prevHolder: null, prevDR: false, note: "",
  },
};
const copiaDi = (o) => JSON.parse(JSON.stringify(o));
const prima = copiaDi(vecchio);

/* ---- il finto computer, con l'archivio vecchio gia' sul disco ---- */
const disco = { dati: JSON.stringify(vecchio), file: {} };
const invoke = async (nome, arg) => {
  switch (nome) {
    case "carica_dati":
      return disco.dati;
    case "salva_dati":
      disco.dati = arg.contenuto;
      return null;
    case "percorso_dati":
      return "C:\\finto\\magazzino.json";
    case "elenco_copie":
      return [];
    case "copia_prima_di_importare":
      return "C:\\finto\\copie\\prima.json";
    case "leggi_file":
      return disco.file[arg.percorso];
    case "annulla_uscita":
      return null;
    default:
      throw new Error("comando sconosciuto: " + nome);
  }
};
let prossimoApri = null;

function apri() {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://x.test/#home",
    beforeParse(w) {
      w.__TAURI__ = {
        core: { invoke },
        dialog: { save: async () => null, open: async () => prossimoApri },
        process: { exit() {} },
      };
      w.scrollTo = () => {};
      w.confirm = () => true; w.__rispostaConferme = true;
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const errs = [];
  dom.window.addEventListener("error", (e) => errs.push(e.message));
  return { w: dom.window, errs };
}

const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
let falliti = 0;
const ok = (c, m) => {
  console.log((c ? "OK   " : "FAIL ") + m);
  if (!c) falliti++;
};
const esiti = (w) => {
  const c = { OK: 0, MANCA: 0, ESCLUSA: 0 };
  Object.values(w.eval("derive()").prop).forEach((p) => c[p.esito]++);
  return c;
};
const senzaCodice = (arts) => arts.map((a) => { const x = { ...a }; delete x.codice; return x; });

(async () => {
  /* 1. primo avvio della versione nuova sull'archivio vecchio */
  let { w, errs } = apri();
  await attendi(1500);
  const dopo = JSON.parse(disco.dati);
  const arts = dopo.settings.main.articoli;
  const codici = arts.map((a) => a.codice);
  ok(arts.every((a) => /^A\d{3}$/.test(a.codice || "")), `ogni articolo ha il suo codice (${arts.length} articoli)`);
  ok(new Set(codici).size === codici.length, "nessun codice ripetuto");
  ok(dopo.settings.main.articoli[3].codice === "A005", "il codice gia' presente resta quello");
  ok(
    JSON.stringify(senzaCodice(arts)) === JSON.stringify(senzaCodice(prima.settings.main.articoli)),
    "per il resto gli articoli sono identici (nome, famiglia, taglie, stagione...)",
  );
  const restoSettings = (m) => { const x = { ...m }; delete x.articoli; return JSON.stringify(x); };
  ok(restoSettings(dopo.settings.main) === restoSettings(prima.settings.main), "le altre impostazioni sono identiche");
  for (const col of ["atlete", "divise", "materiale", "richieste", "movimenti"])
    ok(JSON.stringify(dopo[col]) === JSON.stringify(prima[col]), `${col}: identici a prima`);
  const c1 = esiti(w);
  ok(c1.OK + c1.MANCA + c1.ESCLUSA === Object.keys(prima.richieste).length, `ogni richiesta ha la sua proposta ${JSON.stringify(c1)}`);
  ok(errs.length === 0, "nessun errore all'avvio " + errs.join("; "));

  /* 2. riaprendo, i codici non cambiano */
  w.close();
  ({ w, errs } = apri());
  await attendi(1500);
  const riaperto = JSON.parse(disco.dati).settings.main.articoli.map((a) => a.codice);
  ok(JSON.stringify(riaperto) === JSON.stringify(codici), "riaprendo il programma i codici restano gli stessi");
  ok(JSON.stringify(esiti(w)) === JSON.stringify(c1), "e le proposte anche");

  /* 3. un movimento della versione vecchia si annulla */
  await w.eval("annullaMovimento('VECCHIO1')");
  await attendi(500);
  const dopoAnnullo = JSON.parse(disco.dati);
  ok(!dopoAnnullo.movimenti.VECCHIO1 && dopoAnnullo.divise[libera].holder === null,
    "un movimento registrato dalla versione precedente si annulla e la divisa torna in magazzino");

  /* 4. riprendendo una copia vecchia, senza codici, i codici arrivano subito */
  prossimoApri = "D:\\copia-vecchia.json";
  disco.file[prossimoApri] = JSON.stringify(prima);
  await w.__APP.importa();
  await attendi(1200);
  const ripresa = JSON.parse(disco.dati).settings.main.articoli;
  ok(ripresa.every((a) => /^A\d{3}$/.test(a.codice || "")) && new Set(ripresa.map((a) => a.codice)).size === ripresa.length,
    "riprendendo una copia senza codici, i codici vengono assegnati senza riavviare");
  ok(errs.length === 0, "nessun errore JavaScript " + errs.join("; "));
  process.exit(falliti ? 1 : 0);
})();
