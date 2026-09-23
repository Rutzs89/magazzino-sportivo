/* Adattatore per il programma installato.
 *
 * L'app e' nata sul database di claude.ai e parla quella lingua:
 * doc/collection, onSnapshot, get/set/update/delete/add. Qui sotto la stessa
 * lingua viene servita da un unico file JSON sul computer, letto all'avvio e
 * riscritto quando qualcosa cambia. Cosi' l'app non e' stata riscritta: e'
 * cambiato solo il magazzino sotto (come gia' fatto per la versione di prova,
 * vedi tools/shim_locale.js).
 *
 * Tutto quello che sta sotto la chiave `__config` non e' un'anagrafica ma le
 * preferenze di questo computer (dove finiscono le copie): non esce con i dati
 * e non entra da un file importato.
 */
(function () {
  if (!window.__TAURI__) return; // fuori dal programma non facciamo nulla
  var T = window.__TAURI__;

  /* Le finestre "scegli un file" le apre un componente a parte del programma.
     Se un giorno non ci fosse, i pulsanti che salvano o aprono file
     smetterebbero di funzionare senza dire niente: meglio una frase chiara. */
  function dialoghi() {
    if (T && T.dialog) return T.dialog;
    throw new Error(
      "Le finestre per scegliere i file non sono disponibili in questa versione del programma"
    );
  }
  var invoke = T.core.invoke;

  var store = null;
  var subs = new Set();
  var n = 0;
  var attesa = null;
  var sporco = false; // c'e' roba cambiata che non e' ancora finita sul disco
  var catena = Promise.resolve(); // le scritture si mettono in fila, una per volta
  var ultimoAvviso = null; // "la copia del giorno non e' riuscita", da far vedere fisso

  function config() {
    if (!store.__config) store.__config = {};
    return store.__config;
  }

  /* Il salvataggio aspetta un attimo: durante una consegna in blocco partono
   * decine di scritture di fila e non ha senso riscrivere il file ogni volta. */
  function programmaSalvataggio() {
    sporco = true;
    if (attesa) clearTimeout(attesa);
    attesa = setTimeout(salvaOra, 350);
  }

  /* Scrive adesso, e torna una promessa che finisce quando **tutto** quello che
   * c'era da scrivere e' sul disco.
   *
   * Le scritture stanno in fila una dietro l'altra invece di essere rimandate:
   * prima, se se ne chiedeva una mentre un'altra era in volo, quella nuova
   * veniva rinviata di 350 ms — e chiudendo il programma in quel momento il
   * rinvio non arrivava mai e l'ultima modifica spariva senza dire niente. */
  function salvaOra() {
    if (attesa) {
      clearTimeout(attesa);
      attesa = null;
    }
    catena = catena.then(scriviSeSporco);
    return catena;
  }

  async function scriviSeSporco() {
    if (!sporco) return;
    sporco = false;
    try {
      var avviso = await invoke("salva_dati", {
        contenuto: JSON.stringify(store),
        cartellaCopie: config().cartellaCopie || null,
      });
      // I dati sono salvati comunque: se e' fallita solo la copia del giorno
      // bisogna dirlo, altrimenti si crede di avere copie che non ci sono.
      ultimoAvviso = avviso || null;
      if (avviso) {
        if (window.toast) window.toast("Dati salvati; " + avviso);
        else console.error(avviso);
      }
    } catch (e) {
      // Non e' andata: i dati restano da scrivere, cosi' il prossimo giro
      // riprova invece di darli per salvati.
      sporco = true;
      if (window.toast) window.toast("Salvataggio non riuscito: " + e);
      else console.error(e);
    }
  }

  function notify() {
    programmaSalvataggio();
    setTimeout(function () {
      subs.forEach(function (f) {
        f();
      });
    }, 0);
  }

  function snap(id, d) {
    return {
      id: id,
      exists: d !== undefined,
      data: function () {
        return d;
      },
      metadata: { fromCache: false, hasPendingWrites: false },
    };
  }

  var db = {
    doc: function (p) {
      var s = p.split("/"),
        c = s[0],
        id = s.slice(1).join("/");
      return {
        id: id,
        path: p,
        get: async function () {
          return snap(id, (store[c] || {})[id]);
        },
        onSnapshot: function (next) {
          var f = function () {
            next(snap(id, (store[c] || {})[id]));
          };
          subs.add(f);
          setTimeout(f, 0);
          return function () {
            subs.delete(f);
          };
        },
        set: async function (o) {
          (store[c] = store[c] || {})[id] = o;
          notify();
        },
        update: async function (o) {
          if (!store[c] || !store[c][id])
            throw { code: "invalid_argument", message: "missing" };
          store[c][id] = Object.assign({}, store[c][id], o);
          notify();
        },
        delete: async function () {
          if (store[c]) delete store[c][id];
          notify();
        },
      };
    },
    collection: function (c) {
      return {
        path: c,
        onSnapshot: function (next) {
          var f = function () {
            var docs = Object.keys(store[c] || {}).map(function (id) {
              return snap(id, store[c][id]);
            });
            next({ docs: docs, size: docs.length, empty: !docs.length });
          };
          subs.add(f);
          setTimeout(f, 0);
          return function () {
            subs.delete(f);
          };
        },
        add: async function (o) {
          var id = "L" + Date.now().toString(36) + n++;
          (store[c] = store[c] || {})[id] = o;
          notify();
          return db.doc(c + "/" + id);
        },
        doc: function (id) {
          return db.doc(c + "/" + id);
        },
      };
    },
  };

  /* Esportazioni dell'app (i CSV): finestra di sistema, poi scrittura. */
  var downloads = {
    save: async function (r) {
      var dove = await dialoghi().save({
        defaultPath: r.filename,
        filters: [{ name: "Tabella CSV", extensions: ["csv"] }],
      });
      if (!dove) return { status: "cancelled" };
      await invoke("scrivi_file", { percorso: dove, contenuto: r.data });
      return { status: "saved" };
    },
  };

  /** L'archivio senza le preferenze di questo computer, pronto per uscire. */
  function senzaPreferenze() {
    var fuori = Object.assign({}, store);
    delete fuori.__config;
    return fuori;
  }

  /* Un file sbagliato non deve svuotare il magazzino.
   *
   * Prima si guardava solo se le chiavi c'erano: cosi' passavano anche
   * {"atlete":1,"divise":1} e {"atlete":[],"divise":[]}, che sostituivano
   * l'archivio con il vuoto. Adesso si guarda che dentro ci sia roba vera. */
  function controllaArchivio(dati) {
    var no = function (perche) {
      throw new Error("Questo file non sembra un archivio del magazzino: " + perche);
    };
    if (!dati || typeof dati !== "object" || Array.isArray(dati))
      no("non contiene un archivio");
    ["atlete", "divise"].forEach(function (c) {
      var v = dati[c];
      if (!v || typeof v !== "object" || Array.isArray(v)) no("manca l'elenco " + c);
      if (!Object.keys(v).length) no("l'elenco " + c + " e' vuoto");
      // Basta guardarne una: se la forma e' quella giusta, il file e' nostro.
      var uno = v[Object.keys(v)[0]];
      if (!uno || typeof uno !== "object" || Array.isArray(uno))
        no("l'elenco " + c + " non ha la forma giusta");
    });
    var a = dati.atlete[Object.keys(dati.atlete)[0]];
    if (typeof a.cognome !== "string" || typeof a.squadra !== "string")
      no("le atlete non hanno cognome e squadra");
    var d = dati.divise[Object.keys(dati.divise)[0]];
    if (d.taglia === undefined || d.numero === undefined)
      no("le divise non hanno taglia e numero");
  }

  /* Sostituisce l'archivio con quello del testo dato.
   * Prima si controlla che sia davvero un archivio, poi si mette via quello di
   * adesso nella cartella delle copie, con data e ora. Se quella copia non
   * riesce ci si ferma: senza rete di sicurezza non si sostituisce niente. */
  async function sostituisciArchivio(testo) {
    var dati = JSON.parse(testo);
    controllaArchivio(dati); // se non va, si ferma qui e non tocca niente
    await invoke("copia_prima_di_importare", {
      contenuto: JSON.stringify(senzaPreferenze(), null, 1),
      cartellaCopie: config().cartellaCopie || null,
    });
    // Le preferenze di questo computer non si toccano: un file preparato da
    // altri non deve poter dirottare dove finiscono i dati delle atlete.
    var preferenze = store && store.__config ? store.__config : null;
    delete dati.__config;
    store = dati;
    if (preferenze) store.__config = preferenze;
    notify();
    await salvaOra();
  }

  /* --- copie di sicurezza, usate dalla schermata Impostazioni --- */
  var APP = {
    /** L'ultimo avviso sulla copia del giorno, da mostrare fisso e non a lampo. */
    avvisoCopie: function () {
      return ultimoAvviso;
    },
    percorso: function () {
      return invoke("percorso_dati");
    },
    cartellaCopie: function () {
      return config().cartellaCopie || "";
    },
    elencoCopie: function () {
      return invoke("elenco_copie", {
        cartellaCopie: config().cartellaCopie || null,
      });
    },

    /** Copia di tutto l'archivio dove decide l'utente. */
    esporta: async function () {
      var oggi = new Date().toISOString().slice(0, 10);
      var dove = await dialoghi().save({
        // Non "magazzino-<data>.json": e' lo stesso nome delle copie
        // automatiche, e salvandola nella loro cartella il programma la
        // scambierebbe per una sua e prima o poi la cancellerebbe.
        defaultPath: "archivio-magazzino-" + oggi + ".json",
        filters: [{ name: "Archivio magazzino", extensions: ["json"] }],
      });
      if (!dove) return null;
      await invoke("scrivi_file", {
        percorso: dove,
        contenuto: JSON.stringify(senzaPreferenze(), null, 1),
      });
      return dove;
    },

    /** Rimette in piedi l'archivio da una copia. Sostituisce tutto. */
    importa: async function () {
      var scelto = await dialoghi().open({
        multiple: false,
        filters: [{ name: "Archivio magazzino", extensions: ["json"] }],
      });
      if (!scelto || typeof scelto !== "string") return null;
      await sostituisciArchivio(await invoke("leggi_file", { percorso: scelto }));
      return scelto;
    },

    /** Lo stesso, da una delle copie automatiche, scelta per nome. Sul Mac la
        loro cartella non si apre dalla finestra "apri". */
    riprendiCopiaAutomatica: async function (nome) {
      await sostituisciArchivio(
        await invoke("leggi_copia", { nome: nome, cartellaCopie: config().cartellaCopie || null }),
      );
      return nome;
    },

    /** Dove finiscono le copie del giorno: meglio un disco esterno. */
    scegliCartellaCopie: async function () {
      var scelta = await dialoghi().open({ directory: true, multiple: false });
      if (typeof scelta !== "string") return null;
      config().cartellaCopie = scelta;
      notify();
      return scelta;
    },

    dimenticaCartellaCopie: function () {
      delete config().cartellaCopie;
      notify();
    },

    /* --- aggiornamenti --- */
    versione: function () {
      return window.__VERSIONE || "";
    },
    /** Torna il numero della versione nuova, oppure niente se siamo a posto. */
    cercaAggiornamento: function () {
      return invoke("cerca_aggiornamento");
    },
    /** Scarica, finisce di salvare, poi installa. Il pacchetto passa solo se
        la firma corrisponde. Se i dati non si riescono a salvare non si
        installa niente: il programma si chiuderebbe con le modifiche in sospeso. */
    installaAggiornamento: async function () {
      await invoke("scarica_aggiornamento");
      if (!(await chiudiIConti()))
        throw new Error("i dati non sono stati salvati, l'aggiornamento non è stato installato");
      await invoke("applica_aggiornamento");
    },
    esci: function () {
      return invoke("esci");
    },
    /** Aspetta che tutto quello che c'e' da scrivere sia sul disco. */
    finisciDiScrivere: function () {
      return chiudiIConti();
    },

    /* --- fogli Excel: il programma sa solo scrivere e leggere celle,
       cosa significano le colonne lo decide l'app --- */
    scegliDoveSalvare: function (nome) {
      return dialoghi().save({
        defaultPath: nome,
        filters: [{ name: "Foglio Excel", extensions: ["xlsx"] }],
      });
    },
    scegliDaAprire: async function () {
      var f = await dialoghi().open({
        multiple: false,
        filters: [{ name: "Foglio Excel", extensions: ["xlsx"] }],
      });
      return typeof f === "string" ? f : null;
    },
    /** Lo stemma della societa': si sceglie un file e torna pronto da mostrare. */
    scegliImmagine: async function () {
      var f = await dialoghi().open({
        multiple: false,
        filters: [{ name: "Immagine", extensions: ["png", "jpg", "jpeg", "svg", "webp"] }],
      });
      if (typeof f !== "string") return null;
      return invoke("leggi_immagine", { percorso: f });
    },
    /* La parte Rust vuole solo testo: un numero in una casella faceva
       rifiutare tutto il file, in silenzio. Qui si converte ogni casella. */
    scriviExcel: function (percorso, foglio, intestazioni, righe, istruzioni) {
      return invoke("scrivi_excel", {
        percorso: percorso,
        foglio: testo(foglio),
        intestazioni: (intestazioni || []).map(testo),
        righe: tabellaDiTesto(righe),
        istruzioni: (istruzioni || []).map(testo),
      });
    },
    leggiExcel: function (percorso) {
      return invoke("leggi_excel", { percorso: percorso });
    },
    /* Il modulo di distribuzione ha un foglio per squadra: questi due lavorano
       su tutti i fogli, non solo sul primo. */
    scriviExcelFogli: function (percorso, fogli, istruzioni) {
      return invoke("scrivi_excel_fogli", {
        percorso: percorso,
        fogli: (fogli || []).map(function (f) {
          return {
            nome: testo(f.nome),
            intestazioni: (f.intestazioni || []).map(testo),
            righe: tabellaDiTesto(f.righe),
          };
        }),
        istruzioni: (istruzioni || []).map(testo),
      });
    },
    /** A che punto e' lo scaricamento: [byte presi, byte totali, finito]. */
    avanzamentoAggiornamento: function () {
      return invoke("avanzamento_aggiornamento");
    },
    leggiExcelFogli: function (percorso) {
      return invoke("leggi_excel_fogli", { percorso: percorso });
    },
  };

  window.__APP = APP;

  function testo(v) {
    return v == null ? "" : String(v);
  }
  function tabellaDiTesto(righe) {
    return (righe || []).map(function (r) {
      return (r || []).map(testo);
    });
  }

  /** Finisce di scrivere tutto quello che manca. Torna vero se e' tutto sul
      disco, falso se il salvataggio non e' riuscito: prima tornava sempre
      "fatto", e chiudendo il programma le ultime modifiche sparivano senza
      nessun avviso. */
  async function chiudiIConti() {
    await salvaOra();
    return !sporco;
  }

  var AVVISO_CHIUSURA =
    "Le ultime modifiche non sono state salvate sul computer.\n\n" +
    "Chiudere comunque il programma? Le modifiche non salvate andranno perse.";

  /* Sul Mac chiudere la finestra non chiude il programma: resta acceso nel Dock
   * (trappola gia' pagata con Valutazioni). Prima di sparire si scrive quello
   * che manca, poi si esce davvero. L'uscita la fa la parte Rust: non dipende
   * da librerie JavaScript che potrebbero non esserci. */
  if (T.window && T.window.getCurrentWindow) {
    T.window.getCurrentWindow().onCloseRequested(async function (e) {
      e.preventDefault();
      if (!(await chiudiIConti()) && !window.confirm(AVVISO_CHIUSURA)) return;
      await invoke("esci");
    });
  }

  /* Sul Mac si esce anche con Cmd+Q, o spegnendo il computer: quelle non sono
   * chiusure di finestra e non passano da onCloseRequested. La parte Rust le
   * intercetta e chiede alla pagina di finire di scrivere; quando ha finito,
   * la pagina lo dice e Rust spegne. */
  if (T.event && T.event.listen) {
    T.event.listen("chiudi-i-conti", async function () {
      if (!(await chiudiIConti())) {
        // Prima si ferma la rete di sicurezza che spegne dopo qualche
        // secondo, poi si chiede: la domanda puo' restare aperta a lungo.
        await invoke("annulla_uscita");
        if (!window.confirm(AVVISO_CHIUSURA)) return;
      }
      await invoke("conti_chiusi");
    });
  }

  /* Rete di sicurezza in piu': appena la finestra perde il fuoco si scrive. */
  window.addEventListener("blur", function () {
    salvaOra();
  });

  window.claude = {
    use: async function (nome) {
      if (nome === "downloads") return downloads;
      if (nome !== "db") return null;
      if (store === null) {
        var testo = await invoke("carica_dati");
        if (testo) {
          store = JSON.parse(testo);
        } else {
          // Primo avvio: il file non c'e' ancora. Si parte dalla fotografia
          // iniziale del magazzino, cosi' il programma e' subito utilizzabile
          // invece di aprirsi vuoto.
          store = JSON.parse(JSON.stringify(window.__DATI_INIZIALI || {}));
          programmaSalvataggio();
        }
      }
      return db;
    },
  };
})();
