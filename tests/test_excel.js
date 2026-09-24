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
  const tit = f0.intestazioni, gru = f0.gruppi;
  ok(gru.length === tit.length && tit.filter((t) => t === "Risposta").length === w.eval("modArticoli(derive()).length"),
    "il modulo ha un articolo per gruppo: Risposta e, se ha le taglie, Taglia");
  ok(!tit.some((t) => /taglia richiesta/i.test(t)), "la colonna della taglia attuale non c'è più");
  // Come Excel restituisce l'intestazione su due righe: la casella unita
  // dell'articolo ha il nome solo nella prima colonna; Cognome, Nome, Note
  // stanno sopra e sotto non hanno niente.
  const su = tit.map((t, k) => (!gru[k] ? t : k > 0 && gru[k - 1] === gru[k] ? "" : gru[k]));
  const giu = tit.map((t, k) => (gru[k] ? t : ""));
  // un articolo con le taglie che l'atleta della riga non ha ancora chiesto
  const sceltaPer = (r0) => w.eval(`(()=>{const D=derive();const tit=${JSON.stringify(tit)};const gru=${JSON.stringify(gru)};const r0=${JSON.stringify(r0)};
    const sq=${JSON.stringify(f0.nome)};
    const aid=Object.keys(S.atlete).find(k=>S.atlete[k].squadra===sq&&S.atlete[k].cognome===r0[0]&&S.atlete[k].nome===r0[1]);
    for(let i=0;i<tit.length;i++){if(tit[i]!=='Risposta'||tit[i+1]!=='Taglia'||gru[i+1]!==gru[i])continue;const a=articoloDaNome(D,gru[i]);if(!a)continue;
      if(Object.values(S.richieste).some(r=>r.atletaId===aid&&r.articolo===a.nome))continue;
      return {i,taglia:a.taglie[0],et:gru[i]}}return null})()`);
  const scelta = sceltaPer(f0.righe[0]);
  const riga = [...f0.righe[0]];
  riga[scelta.i] = "mi manca";
  riga[scelta.i + 1] = String(scelta.taglia).toLowerCase();
  const riga2 = [...f0.righe[1]];
  riga2[scelta.i] = "non mi manca";
  modulo.daLeggere = [[f0.nome, [su, giu, riga, riga2]], [f0.nome + " (2)", [su, giu, riga]]];
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
  // Un modulo di prima, a tre colonne per articolo su una riga sola, si legge ancora.
  {
    const r3 = f0.righe[2];
    const s3 = sceltaPer(r3);
    const vecchio = ["Cognome", "Nome", "Numero maglia", s3.et, s3.et + " taglia", s3.et + " taglia richiesta", "Note"];
    modulo.daLeggere = [[f0.nome, [vecchio, [r3[0], r3[1], "", "mi manca", "", String(s3.taglia), ""]]]];
    const prima = Object.keys(w.eval("S.richieste")).length;
    await w.eval("caricaModulo()");
    await attendi(900);
    const nuova = Object.values(w.eval("S.richieste")).find((r) => r.articolo === w.eval(`articoloDaNome(derive(),${JSON.stringify(s3.et)}).nome`) &&
      w.eval(`S.atlete[${JSON.stringify(r.atletaId)}].cognome`) === r3[0]);
    ok(Object.keys(w.eval("S.richieste")).length === prima + 1 && nuova && nuova.taglia === s3.taglia,
      "un modulo vecchio, con la taglia attuale e quella richiesta, viene ancora letto");
  }

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

  /* 12. le colonne informative e il foglio dei movimenti */
  ok(
    fogli.every((f, k) => f.intestazioni.length === w.eval(`MODELLI_EXCEL.${TIPI[k]}.colonne.length+(MODELLI_EXCEL.${TIPI[k]}.info||[]).length`)),
    "ogni foglio esce con le colonne da caricare e quelle solo informative",
  );
  /* 12b. menu a tendina e istruzioni impaginate */
  // Per guardare i file veri: SALVA_FOGLI=<cartella> scrive qui quello che
  // arriverebbe alla parte Rust (lo usa la prova `scrive_i_fogli_salvati`).
  if (process.env.SALVA_FOGLI) {
    fs.writeFileSync(path.join(process.env.SALVA_FOGLI, "fogli.json"), JSON.stringify({ fogli, modulo: modulo.scritto }));
  }
  {
    const tutti = [...fogli, ...modulo.scritto.fogli];
    ok(tutti.every((f) => f.menu == null || f.menu.length === f.intestazioni.length),
      "i menu a tendina sono allineati alle colonne di ogni foglio");
    const menuDi = (f, titolo) => f.menu && f.menu[f.intestazioni.indexOf(titolo)];
    const menuArt = (f, et, titolo) => f.menu && f.menu[f.intestazioni.findIndex((t, k) => f.gruppi[k] === et && t === titolo)];
    const div = fogli[TIPI.indexOf("divise")];
    ok(JSON.stringify(menuDi(div, "Da cambiare").valori) === '["sì","no"]' &&
       JSON.stringify(menuDi(div, "Tipo").valori) === '["gara","libero"]' && menuDi(div, "Modello").libero === true,
      "foglio Divise: menu per Da cambiare, Tipo e Modello (questo accetta anche un lotto nuovo)");
    ok(JSON.stringify(menuDi(div, "Numero").intero) === "[0,99]" && menuDi(div, "Note").lunghezza === 200 && !menuDi(div, "Note").valori.length,
      "foglio Divise: il numero accetta solo interi da 0 a 99, le note hanno un limite di lunghezza");
    // ogni casella di ogni foglio e' guidata: un messaggio d'aiuto per ogni colonna
    const senzaAiuto = tutti.flatMap((f) => f.intestazioni.filter((t, k) => !(f.menu && f.menu[k] && f.menu[k].aiuto)).map((t) => f.nome || f.foglio + ": " + t));
    ok(senzaAiuto.length === 0, "ogni colonna di ogni foglio ha il suo messaggio d'aiuto" + (senzaAiuto.length ? ": mancano " + senzaAiuto.slice(0, 5).join(", ") : ""));
    ok(tutti.every((f) => (f.menu || []).every((m) => !m || m.aiuto.length <= 255)), "nessun messaggio d'aiuto supera il limite di Excel (255 caratteri)");
    // obbligatorie e informative
    const art = fogli[TIPI.indexOf("articoli")];
    ok(menuDi(art, "Articolo").obbligatoria && /^Obbligatoria/.test(menuDi(art, "Articolo").aiuto) && !menuDi(art, "Codice").obbligatoria,
      "le colonne obbligatorie sono segnate come tali");
    ok(fogli.every((f) => f.gruppi && f.gruppi.length === f.intestazioni.length &&
      f.intestazioni.every((t, k) => (f.menu[k].informativa ? f.gruppi[k] !== f.gruppi[0] : f.gruppi[k] === f.gruppi[0]))),
      "ogni foglio ha sopra i titoli il gruppo: da compilare oppure solo informative");
    // cognomi e articoli: menu con gli atleti e gli articoli gia' caricati
    const ric = fogli[TIPI.indexOf("richieste")];
    ok(menuDi(ric, "Cognome").valori.length > 20 && menuDi(ric, "Articolo").valori.length === w.eval("S.settings.articoli.length"),
      "foglio Richieste: cognomi e articoli si scelgono dal menu");
    // il foglio si rilegge anche con i gruppi sopra i titoli (come esce da Excel)
    {
      const f = fogli[TIPI.indexOf("atlete")];
      const sopra = f.gruppi.map((g, k) => (k > 0 && f.gruppi[k - 1] === g ? "" : g));
      daLeggere = [sopra, f.intestazioni, ...f.righe];
      const prima = conta();
      await w.eval("caricaModello('atlete')");
      await attendi(600);
      ok(JSON.stringify(conta()) === JSON.stringify(prima) && !(w.eval("S.app.esitoExcel") || {}).problemi?.length,
        "il foglio con l'intestazione su due righe si ricarica senza errori e senza doppioni");
    }
    // ogni valore dei menu viene poi accettato al caricamento
    ok(w.eval("['sì','no'].every(siNoValido)"), "sì e no del menu sono valori ammessi");
    const f0m = modulo.scritto.fogli[0];
    const arts = w.eval("modArticoli(derive()).map(a=>({et:artLabel(a.nome),taglie:modConTaglie(a)?a.taglie.filter(Boolean):null,nome:a.nome}))");
    const risposteOk = arts.every((a) => {
      const m = menuArt(f0m, a.et, "Risposta");
      return m && m.valori.length === 3 && m.valori.every((v) => w.eval(`modRisposta(${JSON.stringify(v)})`) !== "?");
    });
    ok(risposteOk, `modulo: ogni articolo ha il menu delle tre risposte, tutte riconosciute al caricamento (${arts.length} articoli)`);
    const taglieOk = arts.filter((a) => a.taglie).every((a) => {
      const m1 = menuArt(f0m, a.et, "Taglia");
      return m1 && JSON.stringify(m1.valori) === JSON.stringify(a.taglie) &&
        a.taglie.every((t) => w.eval(`tagliaArticolo((derive().set.articoli||[]).find(x=>x.nome===${JSON.stringify(a.nome)}),${JSON.stringify(t)})`));
    });
    ok(taglieOk, "modulo: la colonna Taglia ha il menu con le taglie dell'articolo, tutte accettate");
    ok(!menuDi(f0m, "Cognome").valori.length && menuDi(f0m, "Note").lunghezza === 200 && JSON.stringify(menuDi(f0m, "Numero maglia").intero) === "[0,99]",
      "modulo: nomi e note restano da scrivere, il numero di maglia solo da 0 a 99");
    const guide = [...fogli.map((f) => f.istruzioni), modulo.scritto.istruzioni];
    const TIPI_RIGA = ["titolo", "sezione", "voce", "testo"];
    const guideOk = guide.every((g) => g[0].startsWith("titolo\t") && g.every((r) => {
      if (r === "") return true;
      const p = r.split("\t");
      return TIPI_RIGA.includes(p[0]) && p.slice(1).every((x) => x.trim()) && (p[0] !== "voce" || p.length === 3);
    }));
    ok(guideOk, "le istruzioni arrivano impaginate: titolo, sezioni, voci con nome e spiegazione, paragrafi");
    ok(guide.every((g) => g.some((r) => r.startsWith("sezione\tColonne"))), "ogni foglio da compilare ha la sezione Colonne");
    // nessuna spiegazione spezzata a meta' (una voce che finisce con una virgola)
    const spezzate = guide.flat().filter((r) => r.startsWith("voce\t") && /[,(]$/.test(r.trim()));
    ok(spezzate.length === 0, "nessuna voce con la spiegazione spezzata" + (spezzate.length ? ": " + spezzate.join(" / ") : ""));
  }
  await w.eval("scaricaMovimenti()");
  await attendi(200);
  const mov = fogliScritti["Movimenti"];
  ok(!mov || mov.righe.every((r) => r.length === mov.intestazioni.length && r.every((c) => typeof c === "string")),
    `il foglio dei movimenti ha righe allineate (${mov ? mov.righe.length : 0} movimenti)`);
  ok(!w.document.querySelector('[data-act="exp"]') && typeof w.esporta === "undefined",
    "le esportazioni CSV non ci sono piu': un solo posto per i fogli");

  /* 13. i controlli al caricamento: errori, avvisi, anteprima senza scritture */
  const primaControlli = conta();
  const esame = await w.eval(`MODELLI_EXCEL.articoli.applica([
    ['ARTICOLO PROVA','forse','M','3','',''],
    ['ARTICOLO PROVA','no','05/06/2026','3','',''],
    ['ARTICOLO PROVA','no','L','2,5','',''],
    ['ARTICOLO PROVA','no','XL','4','A 1','2026'],
    ['ARTICOLO PROVA','no','S','4','',''],
    ['ARTICOLO PROVA','no','S','4','','']],true)`);
  ok(esame.problemi.length === 4, `articoli: 4 righe sbagliate riconosciute (${esame.problemi.length}): ${esame.problemi.join(' | ')}`);
  ok(esame.avvisi.some((a) => /più volte/.test(a)), "articoli: la riga ripetuta viene segnalata");
  ok(JSON.stringify(conta()) === JSON.stringify(primaControlli), "il giro di prova non scrive niente");
  const unAtleta = w.eval("Object.values(S.atlete)[0]");
  const esameA = await w.eval(`MODELLI_EXCEL.atlete.applica([
    ['U99','Rossi','','','',''],
    ['U99','Provetta','Esempia','chiamare il +39 in serata','',''],
    ['U99','Verdi','Eva','','forse',''],
    [${JSON.stringify(unAtleta.squadra)},${JSON.stringify(unAtleta.cognome)},${JSON.stringify(unAtleta.nome)},'','no','']],true)`);
  ok(esameA.problemi.length === 2 && esameA.avvisi.some((a) => /recapito/.test(a)) && esameA.squadreNuove.includes("U99"),
    `atleti: dati mancanti e valori non ammessi segnalati, nota con recapito scartata, squadra nuova annunciata (${esameA.problemi.length} errori)`);
  const conDivisa = w.eval("(()=>{const d=Object.values(S.divise).find(x=>x.holder&&!x.daRestituire&&!x.dismessa&&(x.modello||'STANDARD')==='STANDARD');const a=S.atlete[d.holder];const altro=Object.values(S.atlete).find(y=>y.squadra===a.squadra&&y!==a);return {n:d.numero,t:d.taglia,a,altro}})()");
  const esameD = await w.eval(`MODELLI_EXCEL.divise.applica([
    ['STANDARD','M','120','','','','',''],
    ['STANDARD','M','','','','','',''],
    ['STANDARD','XL','${conDivisa.n}',${JSON.stringify(conDivisa.altro.squadra)},${JSON.stringify(conDivisa.altro.cognome)},${JSON.stringify(conDivisa.altro.nome)},'','']],true)`);
  ok(esameD.problemi.length === 2 && esameD.avvisi.some((x) => /risulterà doppio/.test(x)),
    `divise: numero fuori intervallo e numero mancante rifiutati, numero già in uso in squadra segnalato (${esameD.problemi.join(' | ')})`);
  const esameR = await w.eval(`MODELLI_EXCEL.richieste.applica([
    [${JSON.stringify(unAtleta.squadra)},${JSON.stringify(unAtleta.cognome)},${JSON.stringify(unAtleta.nome)},'ARTICOLO CHE NON ESISTE','M','','',''],
    [${JSON.stringify(unAtleta.squadra)},${JSON.stringify(unAtleta.cognome)},${JSON.stringify(unAtleta.nome)},'DIVISA GARA','M','200','',''],
    [${JSON.stringify(unAtleta.squadra)},${JSON.stringify(unAtleta.cognome)},${JSON.stringify(unAtleta.nome)},'DIVISA GARA','M','','','PORTIERE']],true)`);
  ok(esameR.problemi.length === 3, `richieste: articolo sconosciuto, numero non valido e tipo non ammesso segnalati (${esameR.problemi.length})`);

  ok(errs.length === 0, "nessun errore JavaScript " + errs.join("; "));
  process.exit(falliti ? 1 : 0);
})();
