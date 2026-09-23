/* Prova dell'archivio sul computer (le schermate del programma installabile).
 *
 * Non serve compilare il programma: al posto della parte Rust c'e' un finto
 * computer in memoria. Si segue il percorso vero di chi installa: il programma
 * nasce **vuoto**, poi si carica l'archivio di una societa' da una copia, e da
 * li' si controlla che le consegne restino scritte, che le copie funzionino e
 * che un file sbagliato non mandi tutto all'aria.
 *
 * Uso: npm run test:app (dalla radice del progetto).
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const PAGINA = "src-tauri/dist/index.html";
if (!fs.existsSync(PAGINA)) {
  console.error("Manca " + PAGINA + ": lancia prima npm run build:app");
  process.exit(1);
}
const html = fs.readFileSync(PAGINA, "utf8");

/* Con quale societa' nasce il programma, se con una: lo dice lo stesso file che
   legge la compilazione. Senza, nasce vuoto. */
const societaDiPartenza = fs.existsSync("data/societa-di-partenza.txt")
  ? fs.readFileSync("data/societa-di-partenza.txt", "utf8").trim()
  : "";

/* L'archivio di una societa' vera, come se fosse una copia di sicurezza da
   caricare. Restano sul computer e non entrano nel programma distribuito. */
// L'archivio da caricare e' *quello vero*, il file che si consegna alla
// societa', non una copia ricostruita dal seed: se quel file si guasta la prova
// deve accorgersene. Se non c'e' (copia pulita del progetto) si ripiega sul seed.
const datiProve = require("./dati_prove");
const pronto = datiProve.archivioPronto();
const archivioSocieta = pronto
  ? JSON.parse(fs.readFileSync(pronto))
  : datiProve.seed();

/* ---- il finto computer ---- */
const disco = { dati: "", file: {} }; // dati = magazzino.json, file = quelli esportati
let scritture = 0;
// Quanto ci mette la finta scrittura. Con zero i salvataggi non si accavallano
// mai e il difetto piu' grave non si puo' nemmeno riprodurre: la scrittura vera
// fa sync sul disco e poi la copia del giorno, che puo' stare su una chiavetta.
let ritardo = 0;
const invoke = async (nome, arg) => {
  switch (nome) {
    case "carica_dati":
      return disco.dati;
    case "salva_dati": {
      scritture++;
      const contenuto = arg.contenuto;
      if (ritardo) await new Promise((r) => setTimeout(r, ritardo));
      disco.dati = contenuto;
      return null; // nessun avviso: la copia del giorno e' andata bene
    }
    case "percorso_dati":
      return "C:\\finto\\magazzino.json";
    case "elenco_copie":
      return ["magazzino-2026-09-21.json"];
    case "scrivi_file":
      disco.file[arg.percorso] = arg.contenuto;
      return null;
    case "leggi_file":
      if (!(arg.percorso in disco.file)) throw new Error("file inesistente");
      return disco.file[arg.percorso];
    default:
      throw new Error("comando sconosciuto: " + nome);
  }
};

let prossimoSalva = null; // percorso che la finta finestra di sistema restituisce
let prossimoApri = null;
const dialog = {
  save: async () => prossimoSalva,
  open: async () => prossimoApri,
};

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://x.test/#assegnazioni",
  beforeParse(w) {
    w.__TAURI__ = { core: { invoke }, dialog, process: { exit() {} } };
    w.scrollTo = () => {};
    w.confirm = () => true;
    w.HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    w.HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  },
});
const w = dom.window;
const errs = [];
w.addEventListener("error", (e) => errs.push(e.message));
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

let falliti = 0;
const ok = (c, m) => {
  console.log((c ? "OK   " : "FAIL ") + m);
  if (!c) falliti++;
};

(async () => {
  await attendi(900); // avvio + primo salvataggio

  /* 1. primo avvio: con cosa nasce dipende dalla configurazione */
  ok(disco.dati.length > 0, "al primo avvio l'archivio viene scritto sul computer");
  const appenaNato = JSON.parse(disco.dati || "{}");
  ok(
    appenaNato.settings &&
      appenaNato.settings.main &&
      appenaNato.settings.main.stagione,
    "l'ossatura c'e': la stagione e' gia' impostata",
  );
  // In una copia di lavoro di una societa' il programma nasce gia' pieno; in
  // quella generica, quella che si scarica dal web, deve nascere vuoto.
  if (societaDiPartenza) {
    ok(
      Object.keys(appenaNato.atlete || {}).length > 0,
      `il programma nasce con i dati di '${societaDiPartenza}'`,
    );
  } else {
    ok(
      !appenaNato.atlete && !appenaNato.divise,
      "il programma nasce vuoto: nessun dato di nessuna societa' dentro il pacchetto",
    );
  }

  /* 2. si carica l'archivio di una societa', come fara' chi installa */
  prossimoApri = "D:\\copie\\archivio-societa.json";
  disco.file[prossimoApri] = JSON.stringify(archivioSocieta);
  await w.__APP.importa();
  await attendi(800);

  const caricato = JSON.parse(disco.dati);
  ok(
    Object.keys(caricato.atlete || {}).length === 143,
    `caricando l'archivio arrivano le 143 atlete (trovate ${Object.keys(caricato.atlete || {}).length})`,
  );

  const D = w.eval("derive()");
  const c = { OK: 0, MANCA: 0, ESCLUSA: 0 };
  Object.values(D.prop).forEach((p) => c[p.esito]++);
  ok(
    c.OK === 216 && c.MANCA === 6 && c.ESCLUSA === 0,
    `esiti uguali alla versione online ${JSON.stringify(c)}`,
  );

  /* 3. una consegna deve restare scritta sul disco, non solo a schermo */
  const primaDelle = scritture;
  const bottone = w.document.querySelector('[data-act="consegna"]');
  ok(!!bottone, "dopo il caricamento l'elenco delle consegne c'e'");
  const rid = bottone.dataset.id;
  const divisaId = D.prop[rid].divisaId;
  bottone.click();
  await attendi(60);
  w.document.querySelector('#dlgForm button[value="ok"]').click();
  await attendi(900);

  const dopo = JSON.parse(disco.dati);
  const atletaId = caricato.richieste[rid].atletaId;
  ok(scritture > primaDelle, "la consegna fa scrivere il file");
  ok(
    dopo.divise[divisaId] && dopo.divise[divisaId].holder === atletaId,
    "sul disco la divisa risulta consegnata all'atleta giusta",
  );
  ok(
    Object.keys(dopo.movimenti || {}).length >
      Object.keys(caricato.movimenti || {}).length,
    "il movimento e' finito nell'archivio",
  );

  /* 4. la copia di sicurezza: si salva, si sporca tutto, si rimette dentro */
  prossimoSalva = "D:\\copie\\archivio-magazzino-prova.json";
  await w.__APP.esporta();
  const copia = disco.file[prossimoSalva];
  ok(!!copia, "la copia di sicurezza viene scritta dove si chiede");
  const dentroCopia = JSON.parse(copia || "{}");
  ok(
    dentroCopia.__config === undefined,
    "nella copia non finiscono le preferenze di questo computer",
  );
  ok(
    Object.keys(dentroCopia.atlete || {}).length === 143,
    "la copia contiene tutte le atlete",
  );

  // si cancella un'atleta, poi si riprende dalla copia
  const unaId = Object.keys(dopo.atlete)[0];
  await w.eval(`S.db.doc('atlete/${unaId}').delete()`);
  await attendi(600);
  ok(
    JSON.parse(disco.dati).atlete[unaId] === undefined,
    "la cancellazione arriva sul disco",
  );

  prossimoApri = prossimoSalva;
  await w.__APP.importa();
  await attendi(700);
  ok(
    JSON.parse(disco.dati).atlete[unaId] !== undefined,
    "riprendendo dalla copia l'atleta cancellata torna",
  );

  /* 5. chiudere mentre una scrittura e' in volo non deve perdere niente */
  // Prima: la seconda modifica veniva rimandata di 350 ms, la chiusura aspettava
  // solo la scrittura vecchia, e il rinvio non arrivava mai.
  ritardo = 200;
  const atleteId = Object.keys(JSON.parse(disco.dati).atlete);
  const unaA = atleteId[0];
  const unaB = atleteId[1];
  await w.eval(`S.db.doc('atlete/${unaA}').update({note:'prima modifica'})`);
  await attendi(420); // la scrittura parte ed e' ancora in corso
  await w.eval(`S.db.doc('atlete/${unaB}').update({note:'seconda modifica'})`);
  // la chiusura vera passa di qui: aspetta che tutto sia davvero sul disco
  await w.__APP.finisciDiScrivere();
  const finale = JSON.parse(disco.dati);
  ok(
    finale.atlete[unaA].note === "prima modifica",
    "chiudendo, la modifica gia' in scrittura resta",
  );
  ok(
    finale.atlete[unaB].note === "seconda modifica",
    "chiudendo, anche la modifica arrivata durante la scrittura non si perde",
  );
  ritardo = 0;

  /* 6. un file che sembra un archivio ma non lo e' non deve svuotare niente */
  const finti = [
    ['{"atlete":1,"divise":1}', "numeri al posto degli elenchi"],
    ['{"atlete":[],"divise":[]}', "elenchi vuoti"],
    ['{"atlete":"ciao","divise":"x"}', "testo al posto degli elenchi"],
    ['{"atlete":{"A1":{"x":1}},"divise":{"D1":{"y":2}}}', "elenchi senza i campi giusti"],
  ];
  for (const [contenuto, perche] of finti) {
    prossimoApri = "D:\\finti\\" + perche.replace(/ /g, "-") + ".json";
    disco.file[prossimoApri] = contenuto;
    let respinto = false;
    try {
      await w.__APP.importa();
    } catch (e) {
      respinto = true;
    }
    await attendi(500);
    ok(respinto, `file rifiutato: ${perche}`);
  }
  ok(
    Object.keys(JSON.parse(disco.dati).atlete || {}).length === 143,
    "dopo i quattro file finti il magazzino e' ancora tutto li'",
  );

  ok(errs.length === 0, "nessun errore JavaScript " + errs.join("; "));
  process.exit(falliti ? 1 : 0);
})();
