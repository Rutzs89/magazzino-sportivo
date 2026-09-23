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
const modulo = { scritto: null, daLeggere: null }; // il modulo di distribuzione
const fogliScritti = {}; // i quattro fogli scaricati
let daLeggere = null; // il foglio che la finta finestra "apri" restituisce
const invoke = async (nome, arg) => {
  switch (nome) {
    case "carica_dati": return disco.dati;
    case "salva_dati": disco.dati = arg.contenuto; return null;
    case "percorso_dati": return "C:\\finto\\magazzino.json";
    case "elenco_copie": return [];
    case "scrivi_file": disco.file[arg.percorso] = arg.contenuto; return null;
    case "leggi_file": return disco.file[arg.percorso];
    case "scrivi_excel_fogli": modulo.scritto = arg; return null;
    case "scrivi_excel": fogliScritti[arg.foglio] = arg; return null;
    case "leggi_excel": return daLeggere;
    case "leggi_excel_fogli": return modulo.daLeggere;
    default: throw new Error("comando sconosciuto: " + nome);
  }
};

const dom = new JSDOM(fs.readFileSync(PAGINA, "utf8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "https://x.test/#impostazioni",
  beforeParse(w) {
    w.__TAURI__ = {
      core: { invoke },
      dialog: { save: async () => "C:\\finto\\modulo.xlsx", open: async () => "C:\\finto\\modulo.xlsx" },
      process: { exit() {} },
    };
    w.scrollTo = () => {};
    w.confirm = () => true; w.__rispostaConferme = true;
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

  /* 7. ricaricare i fogli scaricati dal programma non cambia niente */
  const ricPrima = Object.keys(w.eval("S.richieste")).length;
  const righeRicOra = w.eval("MODELLI_EXCEL.richieste.righe()");
  ok(
    righeRicOra.every((r) => r.every((c) => typeof c === "string")),
    "il foglio Richieste esce tutto in testo (la parte Rust rifiuta i numeri)",
  );
  const a7 = await carica("richieste", righeRicOra);
  await attendi(500);
  ok(
    Object.keys(w.eval("S.richieste")).length === ricPrima,
    `ricaricando il foglio Richieste non si raddoppia niente (${ricPrima} -> ${Object.keys(w.eval("S.richieste")).length}, saltate ${a7.saltati})`,
  );
  const taglieArt = () => JSON.stringify(w.eval("S.settings.articoli").map((x) => x.taglie));
  const primaT = taglieArt();
  const matPrima = Object.keys(w.eval("S.materiale")).length;
  await carica("articoli", w.eval("MODELLI_EXCEL.articoli.righe()"));
  await attendi(500);
  ok(
    taglieArt() === primaT && Object.keys(w.eval("S.materiale")).length === matPrima,
    "ricaricando il foglio Articoli le taglie in anni non si sdoppiano",
  );

  /* 8. casi scritti a mano */
  const divPrima = Object.keys(w.eval("S.divise")).length;
  const a8 = await carica("divise", [["STANDARD", "M", "", "", "", "", "", ""]]);
  await attendi(300);
  ok(
    a8.problemi.length === 1 && Object.keys(w.eval("S.divise")).length === divPrima,
    "una divisa senza numero viene segnalata, non diventa la n.0",
  );
  ok(w.eval("modRisposta('non mi manca')") === "?", "\"non mi manca\" non viene letto come \"mi manca\"");
  ok(w.eval("modRisposta('Mi manca')") === "manca" && w.eval("modRisposta('ce l’ho')") === "ha", "le risposte normali restano capite");
  ok(
    JSON.stringify(w.eval("fogliSquadre(['UNDER 13/14 FEMMINILE SQUADRA B MOLTO LUNGA','UNDER 13/14 FEMMINILE SQUADRA B MOLTO LUNGA 2','Istruzioni'])"))
      === JSON.stringify(["UNDER 13 14 FEMMINILE SQUADRA B", "UNDER 13 14 FEMMINILE SQUAD (2)", "Istruzioni (2)"]),
    "i nomi dei fogli delle squadre sono validi e tutti diversi",
  );

  /* 9. il modulo di distribuzione: si scarica, si compila, si ricarica */
  await w.eval("scaricaModulo()");
  await attendi(300);
  ok(modulo.scritto && modulo.scritto.fogli.length === w.eval("derive().perServire.length"),
    "il modulo esce con un foglio per squadra");
  const f0 = modulo.scritto.fogli[0];
  const tit = f0.intestazioni;
  // un articolo con le taglie che il primo atleta del foglio non ha ancora chiesto
  const scelta = w.eval(`(()=>{const D=derive();const tit=${JSON.stringify(tit)};const r0=${JSON.stringify(f0.righe[0])};
    const sq=${JSON.stringify(f0.nome)};
    const aid=Object.keys(S.atlete).find(k=>S.atlete[k].squadra===sq&&S.atlete[k].cognome===r0[0]&&S.atlete[k].nome===r0[1]);
    for(let i=0;i<tit.length;i++){const a=articoloDaNome(D,tit[i]);if(!a||!tit.includes(tit[i]+' taglia'))continue;
      if(Object.values(S.richieste).some(r=>r.atletaId===aid&&r.articolo===a.nome))continue;
      return {i,taglia:a.taglie[0]}}return null})()`);
  const riga = [...f0.righe[0]];
  riga[scelta.i] = "mi manca";
  riga[tit.indexOf(tit[scelta.i] + " taglia")] = String(scelta.taglia).toLowerCase();
  const riga2 = [...f0.righe[1]];
  riga2[scelta.i] = "non mi manca";
  modulo.daLeggere = [[f0.nome, [tit, riga, riga2]], [f0.nome + " (2)", [tit, riga]]];
  const ricPrimaModulo = Object.keys(w.eval("S.richieste")).length;
  await w.eval("caricaModulo()");
  await attendi(900);
  const ricDopoModulo = Object.keys(w.eval("S.richieste")).length;
  ok(ricDopoModulo === ricPrimaModulo + 1, `il modulo compilato crea la richiesta, una volta sola anche col foglio copiato (${ricPrimaModulo} -> ${ricDopoModulo})`);
  const probl = w.eval("S.app.problemiExcel") || [];
  ok(probl.some((p) => /non riconosciuta/i.test(p)), "la risposta 'non mi manca' viene segnalata invece di creare una richiesta");
  await w.eval("caricaModulo()");
  await attendi(900);
  ok(Object.keys(w.eval("S.richieste")).length === ricDopoModulo, "ricaricando lo stesso modulo non nasce niente di nuovo");

  /* 10. i quattro fogli: scaricati dal programma e ricaricati tali e quali */
  const conta = () => ({
    articoli: w.eval("S.settings.articoli.length"),
    atlete: Object.keys(w.eval("S.atlete")).length,
    divise: Object.keys(w.eval("S.divise")).length,
    materiale: Object.keys(w.eval("S.materiale")).length,
    richieste: Object.keys(w.eval("S.richieste")).length,
    squadre: w.eval("S.settings.squadre.length"),
  });
  const TIPI = ["articoli", "atlete", "divise", "richieste"];
  for (const tipo of TIPI) {
    await w.eval(`scaricaModello('${tipo}')`);
    await attendi(100);
  }
  const fogli = TIPI.map((t) => fogliScritti[w.eval(`MODELLI_EXCEL.${t}.foglio`)]);
  ok(fogli.every(Boolean), "i quattro fogli si scaricano");
  ok(
    fogli.every((f) => f.righe.every((r) => r.length === f.intestazioni.length && r.every((c) => typeof c === "string"))),
    "in ogni foglio ogni riga ha tante caselle quante colonne, tutte in testo",
  );
  const primaGiro = conta();
  for (const [i, tipo] of TIPI.entries()) {
    daLeggere = [fogli[i].intestazioni, ...fogli[i].righe];
    await w.eval(`caricaModello('${tipo}')`);
    await attendi(600);
    const probl = w.eval("S.app.problemiExcel") || [];
    ok(probl.length === 0, `${tipo}: il foglio scaricato si ricarica senza problemi ${probl.slice(0, 2).join("; ")}`);
  }
  ok(JSON.stringify(conta()) === JSON.stringify(primaGiro), `ricaricare i quattro fogli non cambia niente ${JSON.stringify(conta())}`);
  // le colonne in un altro ordine: il programma le riconosce dal titolo
  for (const [i, tipo] of TIPI.entries()) {
    const ordine = fogli[i].intestazioni.map((_, k) => k).reverse();
    daLeggere = [ordine.map((k) => fogli[i].intestazioni[k]), ...fogli[i].righe.map((r) => ordine.map((k) => r[k]))];
    await w.eval(`caricaModello('${tipo}')`);
    await attendi(600);
  }
  ok(JSON.stringify(conta()) === JSON.stringify(primaGiro), "anche con le colonne in ordine diverso non cambia niente");
  // un foglio sbagliato (le divise al posto degli atleti) viene rifiutato
  daLeggere = [fogli[2].intestazioni, ...fogli[2].righe];
  await w.eval("caricaModello('atlete')");
  await attendi(400);
  ok(JSON.stringify(conta()) === JSON.stringify(primaGiro), "il foglio delle divise caricato come atleti viene rifiutato");

  /* 11. dal programma pieno a uno vuoto: stesso archivio */
  const pieno = { esiti: {}, codici: w.eval("S.settings.articoli.map(a=>a.nome+'='+(a.codice||'')+'|'+(a.stagione||'')).sort().join(',')") };
  Object.values(w.eval("derive()").prop).forEach((p) => (pieno.esiti[p.esito] = (pieno.esiti[p.esito] || 0) + 1));
  disco.dati = ARCHIVIO_VUOTO;
  const dom2 = new JSDOM(fs.readFileSync(PAGINA, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://x.test/#impostazioni",
    beforeParse(w2) {
      w2.__TAURI__ = { core: { invoke }, dialog: { save: async () => "C:\\finto\\f.xlsx", open: async () => "C:\\finto\\f.xlsx" }, process: { exit() {} } };
      w2.scrollTo = () => {}; w2.confirm = () => true; w2.__rispostaConferme = true;
      w2.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w2.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  const w2 = dom2.window;
  await attendi(900);
  for (const [i, tipo] of TIPI.entries()) {
    daLeggere = [fogli[i].intestazioni, ...fogli[i].righe];
    await w2.eval(`caricaModello('${tipo}')`);
    await attendi(900);
  }
  const vuotoRiempito = {
    atlete: Object.keys(w2.eval("S.atlete")).length,
    divise: Object.keys(w2.eval("S.divise")).length,
    richieste: Object.keys(w2.eval("S.richieste")).length,
    articoli: w2.eval("S.settings.articoli.length"),
    squadre: w2.eval("S.settings.squadre.length"),
  };
  ok(vuotoRiempito.atlete === primaGiro.atlete && vuotoRiempito.divise === primaGiro.divise
    && vuotoRiempito.richieste === primaGiro.richieste && vuotoRiempito.articoli === primaGiro.articoli
    && vuotoRiempito.squadre === primaGiro.squadre,
    `un programma vuoto riempito con i quattro fogli ha gli stessi dati ${JSON.stringify(vuotoRiempito)}`);
  const codici2 = w2.eval("S.settings.articoli.map(a=>a.nome+'='+(a.codice||'')+'|'+(a.stagione||'')).sort().join(',')");
  ok(codici2 === pieno.codici, "codici e stagioni degli articoli passano con i fogli");
  const esiti2 = {};
  Object.values(w2.eval("derive()").prop).forEach((p) => (esiti2[p.esito] = (esiti2[p.esito] || 0) + 1));
  ok(JSON.stringify(esiti2) === JSON.stringify(pieno.esiti), `e le proposte sono le stesse ${JSON.stringify(esiti2)}`);
  ok(
    JSON.stringify(w2.eval("derive().perServire.map(x=>x.nome)")) === JSON.stringify(w.eval("derive().perServire.map(x=>x.nome)")),
    "e le squadre sono nello stesso ordine di distribuzione",
  );

  /* 12. le esportazioni CSV: intestazione e righe allineate */
  for (const kind of ["atlete", "divise", "materiale", "assegnazioni", "movimenti"]) {
    disco.file = {};
    await w.eval(`esporta('${kind}')`);
    await attendi(200);
    const testo = Object.values(disco.file)[0] || "";
    const righe = testo.replace(/^\ufeff/, "").split("\r\n").filter(Boolean);
    const campi = (r) => { let n = 1, dentro = false; for (const c of r) { if (c === '"') dentro = !dentro; else if (c === ";" && !dentro) n++; } return n; };
    const n0 = righe.length ? campi(righe[0]) : 0;
    ok(righe.length >= 1 && righe.every((r) => campi(r) === n0),
      `CSV ${kind}: ${righe.length - 1} righe, tutte con le ${n0} colonne dell'intestazione`);
  }

  ok(errs.length === 0, "nessun errore JavaScript " + errs.join("; "));
  process.exit(falliti ? 1 : 0);
})();
