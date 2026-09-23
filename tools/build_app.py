"""Prepara le schermate del programma installabile in src-tauri/dist/.

Prende l'app (un solo file HTML) e la adatta a vivere fuori dal browser:
 - i font Barlow diventano copie locali, perche' il programma non deve chiedere
   niente a internet;
 - al posto del database di claude.ai ci va l'adattatore che scrive il file sul
   computer (tools/adattatore_tauri.js);
 - i dati di partenza vengono messi dentro, per il primo avvio;
 - cambiano le poche scritte che parlavano di claude.ai.

Si lancia da solo prima di ogni compilazione (npm run build:app).
"""

import datetime
import glob
import json
import os
import shutil

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(RADICE, "src-tauri", "dist")


def societa_di_partenza() -> str:
    """Con quale societa' nasce il programma, se con una.

    Sta in `data/societa-di-partenza.txt`, un file locale che **non si copia**
    fra le due copie del progetto: in quella di una societa' c'e' il suo nome e
    il programma nasce gia' pieno, in quella generica il file non c'e' e nasce
    vuoto. Cosi' il codice resta identico e l'allineamento e' una copia secca.
    """
    p = os.path.join(RADICE, "data", "societa-di-partenza.txt")
    if not os.path.exists(p):
        return ""
    with open(p, encoding="utf-8") as h:
        return h.read().strip()


def archivio_iniziale() -> dict:
    """Con cosa nasce il programma appena installato.

    Senza una societa' scelta: niente. Nessuna atleta, nessun articolo. Il
    programma e' generico, e i dati di una societa' dentro il pacchetto se li
    ritroverebbe chiunque altro lo installi. Si riempie dai fogli Excel o da una
    copia di sicurezza.

    L'unica cosa che c'e' sempre e' l'ossatura: la stagione (indovinata dalla
    data, si cambia in Impostazioni) e i due modelli di divisa, che non sono
    dati di nessuno ma il modo in cui il programma ragiona.
    """
    oggi = datetime.date.today()
    inizio = oggi.year if oggi.month >= 7 else oggi.year - 1
    vuoto = {
        "settings": {
            "main": {
                "stagione": f"{inizio}/{str(inizio + 1)[-2:]}",
                "squadre": [],
                "articoli": [],
                "modelli": ["STANDARD", "LIBERO"],
                "modelliComuni": ["LIBERO"],
            }
        }
    }

    societa = societa_di_partenza()
    if not societa:
        return vuoto

    # Un programma con dentro i dati di una societa' non deve poter nascere in
    # una copia che va online: ne' su GitHub (CI) ne' in una copia collegata a
    # un repository. Il controllo privacy lo dice gia', ma solo se lo si lancia.
    import subprocess
    remoto = subprocess.run(["git", "remote"], cwd=RADICE, capture_output=True, text=True)
    if os.environ.get("CI") or (remoto.returncode == 0 and remoto.stdout.strip()):
        raise SystemExit(
            "FERMO TUTTO: data/societa-di-partenza.txt c'e', ma questa copia puo' andare "
            "online. Il programma pubblicato deve nascere vuoto."
        )

    cartella = os.path.join(RADICE, "data", societa, "seed")
    assert os.path.isdir(cartella), (
        f"data/societa-di-partenza.txt dice '{societa}' ma {cartella} non c'e'"
    )
    archivio: dict = {}
    for f in glob.glob(os.path.join(cartella, "*.json")):
        col, did = os.path.basename(f)[:-5].split("_", 1)
        with open(f, encoding="utf-8") as h:
            archivio.setdefault(col, {})[did] = json.load(h)
    assert archivio, f"{cartella} e' vuota"
    print(f"  il programma nasce con i dati di '{societa}'")
    return archivio


def main() -> None:
    sorgente = os.path.join(RADICE, "src", "magazzino-sportivo.html")
    html = open(sorgente, encoding="utf-8").read()

    cartella_font = os.path.join(RADICE, "assets", "font")
    assert os.path.exists(os.path.join(cartella_font, "font.css")), (
        "i font non ci sono: lancia prima python tools/scarica_font.py"
    )

    # --- font: dalle tre righe che puntano a Google a un foglio di stile locale
    inizio = html.index('<link rel="preconnect" href="https://fonts.googleapis.com">')
    fine = html.index("\n", html.index("fonts.googleapis.com/css2"))
    # Se qualcuno riordinasse l'intestazione, tagliare all'indietro duplicherebbe
    # un pezzo di pagina invece di dare errore.
    assert inizio < fine, "i collegamenti ai font non sono nell'ordine atteso"
    assert html.count("fonts.googleapis.com/css2") == 1, (
        "c'e' piu' di un collegamento a Google Fonts: ne verrebbe sostituito solo "
        "uno, e il programma userebbe i font di sistema senza dirlo"
    )
    html = (
        html[:inizio] + '<link href="fonts/font.css" rel="stylesheet">' + html[fine:]
    )

    # --- adattatore + dati di partenza, prima dello script principale
    adattatore = open(
        os.path.join(RADICE, "tools", "adattatore_tauri.js"), encoding="utf-8"
    ).read()
    # I dati finiscono dentro un <script>: una nota che contenesse la chiusura
    # del tag spezzerebbe la pagina. Vengono da un Excel, quindi puo' capitare.
    seed = json.dumps(
        archivio_iniziale(), ensure_ascii=False, separators=(",", ":")
    ).replace("</", "<\\/")
    # Il programma deve sapere a che versione sta, per la schermata aggiornamenti.
    with open(os.path.join(RADICE, "src-tauri", "tauri.conf.json"), encoding="utf-8") as h:
        versione = json.load(h)["version"]
    ANCORA = "<script>\n/* ============ stato"
    assert ANCORA in html, "ancora dello script principale non trovata"
    html = html.replace(
        ANCORA,
        "<script>\nwindow.__DATI_INIZIALI=" + seed + ";\n"
        'window.__VERSIONE="' + versione + '";\n</script>\n'
        "<script>\n" + adattatore + "\n</script>\n" + ANCORA,
        1,
    )

    # --- le scritte che parlavano del mondo di claude.ai
    CAMBI = [
        ("'Sincronizzato'", "'Salvato sul computer'"),
        (
            "<h1>Dati non raggiungibili</h1><p class=\"sub\">Apri questa pagina da claude.ai: è lì che vivono i dati condivisi del magazzino.</p>",
            "<h1>Dati non raggiungibili</h1><p class=\"sub\">Il programma non riesce ad aprire il suo archivio. Chiudi e riapri; se continua, riprendi da una copia di sicurezza.</p>",
        ),
        (
            "<h1>Archivio vuoto</h1><p class=\"sub\">Non ci sono ancora dati. Chiedi a Claude di caricare i dati iniziali.</p>",
            "<h1>Archivio vuoto</h1><p class=\"sub\">Non ci sono ancora dati. Da Impostazioni puoi riprendere da una copia di sicurezza.</p>",
        ),
    ]
    for vecchio, nuovo in CAMBI:
        assert vecchio in html, f"punto di aggancio mancante: {vecchio[:50]}"
        html = html.replace(vecchio, nuovo, 1)

    # --- scrittura
    # I file si sovrascrivono invece di cancellare la cartella: su Windows,
    # con OneDrive di mezzo, cancellarla ogni volta fallisce con "accesso negato"
    # appena qualcosa la sta guardando.
    os.makedirs(os.path.join(DEST, "fonts"), exist_ok=True)
    for f in glob.glob(os.path.join(cartella_font, "*.woff2")):
        shutil.copy2(f, os.path.join(DEST, "fonts", os.path.basename(f)))
    shutil.copy2(
        os.path.join(cartella_font, "font.css"), os.path.join(DEST, "fonts", "font.css")
    )
    # Il foglio di stile sta in fonts/, quindi gli indirizzi dei file partono da li'.
    css = open(os.path.join(DEST, "fonts", "font.css"), encoding="utf-8").read()
    open(os.path.join(DEST, "fonts", "font.css"), "w", encoding="utf-8").write(
        css.replace("url(fonts/", "url(")
    )

    with open(os.path.join(DEST, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)

    peso = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _, fs in os.walk(DEST)
        for f in fs
    )
    print(f"src-tauri/dist pronto: {peso // 1024} KB")


if __name__ == "__main__":
    main()
