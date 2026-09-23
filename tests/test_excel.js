/* Prova del caricamento da Excel.
 *
 * Il programma parte vuoto e si riempie coi quattro fogli, nell'ordine in cui
 * li carica una persona vera. Le righe qui sono costruite come le scriverebbe
 * il foglio Excel: che il file si scriva e si rilegga davvero e' provato dalla
 * parte Rust (cargo test), qui si prova quello che succede ai dati.
 *
 * Uso: npm run test:excel (dalla radice del progetto).
 */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const PAGINA = "src-tauri/dist/index.html";
if (!fs.existsSync(PAGINA)) {
  console.error("Manca " + PAGINA + ": lancia prima npm run build:app");
  process.exit(1);
}

/* I dati di una societa' vera, da cui ricaviamo le righe dei fogli. */
const seed = require("./dati_prove").seed();
const set0 = seed.settings.main;
const ordine = {};
set0.squadre.forEach((s, i) => (ordine[s.nome] = i));

/* --- le righe dei quattro fogli, nell'ordine delle colonne --- */
const giacenza = {};
for (const m of Object.values(seed.materiale)) {
  const k = m.articolo + "|" + m.taglia;
  giacenza[k] = (giacenza[k] || 0) + (Number(m.iniziale) || 0);
}
const righeArticoli = [];
for (const a of set0.articoli) {
  for (const t of a.taglie && a.taglie.length ? a.taglie : ["UNICA"]) {
    righeArticoli.push([
      a.nome,
      a.conNumero ? "si" : "no",
      t,
      a.conNumero ? "" : String(giacenza[a.nome + "|" + t] || 0),
    ]);
  }
}
const righeAtlete = Object.values(seed.atlete)
  .sort((a, b) => (ordine[a.squadra] ?? 99) - (ordine[b.squadra] ?? 99))
  .map((a) => [a.squadra, a.cognome, a.nome, a.note || ""]);
const righeDivise = Object.values(seed.divise)
  .filter((d) => !d.dismessa)
  .map((d) => {
    const a = d.holder ? seed.atlete[d.holder] : null;
    return [
      d.modello || "STANDARD", d.taglia, String(d.numero),
      a ? a.squadra : "", a ? a.cognome : "", a ? a.nome : "",
      d.daRestituire ? "si" : "", d.note || "",
    ];
  });
const righeRichieste = Object.values(seed.richieste)
  .map((r) => {
    const a = seed.atlete[r.atletaId];
    if (!a) return null;
    return [
      a.squadra, a.cognome, a.nome, r.articolo, r.taglia,
      r.numeroDesiderato != null ? String(r.numeroDesiderato) : "",
      r.note || "",
    ];
  })
  .filter(Boolean);

/* ---- il finto computer ---- */
// Si parte sempre da un programma vuoto, anche in una copia di lavoro dove il
// programma nascerebbe gia' pieno: questa prova serve proprio a controllare il
// riempimento da zero. Dando al finto disco un archivio vuoto ma valido, il
// programma lo legge e non tocca i dati di partenza incorporati.
const ARCHIVIO_VUOTO = JSON.stringify({
  settings: {
    main: {
      stagione: "2026/27",
      squadre: [],
      articoli: [],
      modelli: ["STANDARD", "LIBERO"],
      modelliComuni: ["LIBERO"],
    },
  },
});
const disco = { dati: ARCHIVIO_VUOTO, file: {} };
const invoke = async (nome, arg) => {
  switch (nome) {
    case "carica_dati": return disco.dati;
    case "salva_dati": disco.dati = arg.contenuto; return null;
    case "percorso_dati": return "C:\\finto\\magazzino.json";
    case "elenco_copie": return [];
    case "scrivi_file": disco.file[arg.percorso] = arg.contenuto; return null;
    case "leggi_file": return disco.file[arg.percorso];
    default: throw new Error("comando sconosciuto: " + nome);
  }
};

const dom = new JSDOM(fs.readFileSync(PAGINA, "utf8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://x.test/#impostazioni",
  beforeParse(w) {
    w.__TAURI__ = { core: { invoke }, dialog: {}, process: { exit() {} } };
    w.scrollTo = () => {};
    w.confirm = () => true;
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
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

const carica = async (tipo, righe) => {
  w.__RIGHE = righe;
  return w.eval(`MODELLI_EXCEL.${tipo}.applica(window.__RIGHE)`);
};

(async () => {
  await attendi(800);
  ok(
    Object.keys(w.eval("S.atlete")).length === 0,
    "si parte da un programma vuoto",
  );

  /* 1. articoli e magazzino */
  const a1 = await carica("articoli", righeArticoli);
  await attendi(500);
  const art = w.eval("derive().set.articoli").length;
  ok(art === set0.articoli.length, `creati i ${set0.articoli.length} articoli (trovati ${art})`);
  ok(a1.problemi.length === 0, "nessun problema sugli articoli " + a1.problemi.join("; "));
  const conNumero = w.eval("derive().set.articoli").filter((x) => x.conNumero).length;
  ok(conNumero === 1, "solo la divisa da gara risulta con il numero");

  /* 2. squadre e atlete */
  const a2 = await carica("atlete", righeAtlete);
  await attendi(700);
  const nAtlete = Object.keys(w.eval("S.atlete")).length;
  const nSquadre = w.eval("derive().set.squadre").length;
  ok(nAtlete === 143, `caricate le 143 atlete (trovate ${nAtlete})`);
  ok(nSquadre === 11, `create le 11 squadre (trovate ${nSquadre})`);
  ok(a2.problemi.length === 0, "nessuna riga incompleta " + a2.problemi.join("; "));
  ok(
    w.eval("derive().set.squadre")[0].nome === set0.squadre[0].nome,
    "l'ordine delle squadre e' quello del foglio",
  );

  /* ricaricare lo stesso foglio non deve creare doppioni */
  const a2bis = await carica("atlete", righeAtlete);
  await attendi(700);
  ok(
    Object.keys(w.eval("S.atlete")).length === 143 && a2bis.creati === 0,
    "ricaricando lo stesso foglio non nascono doppioni",
  );

  /* 3. divise */
  const a3 = await carica("divise", righeDivise);
  await attendi(700);
  const nDivise = Object.keys(w.eval("S.divise")).length;
  // Adesso che il foglio dice anche chi la tiene, i tre capi che prima
  // sembravano doppioni entrano tutti: sono maglie di atlete diverse.
  ok(
    nDivise === righeDivise.length,
    `caricate tutte le ${righeDivise.length} divise (trovate ${nDivise})`,
  );
  ok(a3.problemi.length === 0, "nessuna divisa scartata " + a3.problemi.join("; "));
  const inUso = w.eval("Object.values(S.divise).filter(d=>d.holder).length");
  const attese = Object.values(seed.divise).filter((d) => d.holder && !d.dismessa).length;
  ok(inUso === attese, `${attese} divise risultano in mano alle atlete (trovate ${inUso})`);
  const inRientro = w.eval("Object.values(S.divise).filter(d=>d.daRestituire).length");
  const atteseR = Object.values(seed.divise).filter((d) => d.daRestituire && !d.dismessa).length;
  ok(inRientro === atteseR, `${atteseR} divise risultano da cambiare (trovate ${inRientro})`);

  /* 4. richieste */
  const a4 = await carica("richieste", righeRichieste);
  await attendi(900);
  const nRic = Object.keys(w.eval("S.richieste")).length;
  ok(nRic === 222, `caricate le 222 richieste (trovate ${nRic})`);
  ok(
    a4.problemi.length === 0,
    "ogni richiesta ha trovato la sua atleta e il suo articolo " + a4.problemi.slice(0, 3).join("; "),
  );

  /* 5. una riga sbagliata viene segnalata, non caricata di nascosto */
  const prima = Object.keys(w.eval("S.richieste")).length;
  const a5 = await carica("richieste", [
    ["UNDER 14", "Inesistente", "Persona", "DIVISA GARA", "M", "", ""],
    ["UNDER 14", righeAtlete.find((r) => r[0] === "UNDER 14")[1],
      righeAtlete.find((r) => r[0] === "UNDER 14")[2], "ARTICOLO CHE NON C'E'", "M", "", ""],
  ]);
  await attendi(500);
  ok(a5.problemi.length === 2, `le due righe sbagliate sono segnalate (${a5.problemi.length})`);
  ok(
    Object.keys(w.eval("S.richieste")).length === prima,
    "e nessuna delle due e' entrata",
  );

  /* 6. il motore funziona sui dati caricati da Excel */
  const D = w.eval("derive()");
  const c = { OK: 0, MANCA: 0, ESCLUSA: 0 };
  Object.values(D.prop).forEach((p) => c[p.esito]++);
  // La prova che conta: partendo da vuoto e caricando i quattro fogli si
  // ottengono gli stessi esiti dell'archivio completo.
  ok(
    c.OK === 216 && c.MANCA === 6 && c.ESCLUSA === 0,
    `caricando da Excel si ottengono gli stessi esiti dell'archivio: ${JSON.stringify(c)}`,
  );
  const per = {};
  for (const [rid, p] of Object.entries(D.prop)) {
    if (!p.divisaId) continue;
    const a = w.eval(`S.atlete['${w.eval(`S.richieste['${rid}'].atletaId`)}']`);
    const k = a.squadra + "|" + w.eval(`S.divise['${p.divisaId}'].numero`);
    per[k] = (per[k] || 0) + 1;
  }
  ok(
    Object.values(per).every((v) => v === 1),
    "nessun numero proposto due volte nella stessa squadra",
  );

  ok(errs.length === 0, "nessun errore JavaScript " + errs.join("; "));
  process.exit(falliti ? 1 : 0);
})();
