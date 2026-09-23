/* Dove stanno i dati della societa' su cui girano le prove.

   Non stanno nel repository e non devono starci: sono nomi di atleti veri.
   La cartella si indica in data/dati-delle-prove.txt, un file locale (data/
   non e' versionata) con una riga sola: il percorso della cartella della
   societa', quella che contiene seed/ e modelli/. In alternativa la variabile
   d'ambiente MAGAZZINO_DATI.

   Cosi' la copia pubblica del progetto puo' usare i dati che stanno nella
   copia di lavoro senza averne una copia dentro di se'. */
const fs = require("fs");
const path = require("path");

const PUNTATORE = "data/dati-delle-prove.txt";

function cartella() {
  const d = process.env.MAGAZZINO_DATI ||
    (fs.existsSync(PUNTATORE) ? fs.readFileSync(PUNTATORE, "utf8").trim() : "");
  if (!d || !fs.existsSync(path.join(d, "seed"))) {
    console.error(
      "Le prove non trovano i dati della societa'.\n" +
      "Scrivi in " + PUNTATORE + " il percorso della cartella che contiene seed/ e modelli/.",
    );
    process.exit(1);
  }
  return d;
}

/* Il seed come oggetto {collezione: {id: documento}}. */
function seed() {
  const dir = path.join(cartella(), "seed");
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    const [c, id] = f.slice(0, -5).split(/_(.+)/);
    (out[c] = out[c] || {})[id] = JSON.parse(fs.readFileSync(path.join(dir, f)));
  }
  return out;
}

/* L'archivio pronto da consegnare (modelli/archivio-*.json), se c'e'. */
function archivioPronto() {
  const dir = path.join(cartella(), "modelli");
  if (!fs.existsSync(dir)) return null;
  // Non la copia che il programma mette accanto prima di importare.
  const f = fs.readdirSync(dir).find((n) => /^archivio-.*\.json$/.test(n) && !n.includes("prima-di-importare"));
  return f ? path.join(dir, f) : null;
}

module.exports = { cartella, seed, archivioPronto };
