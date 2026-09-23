"""Pubblica una versione nuova: prende i pacchetti firmati da GitHub e li mette
online, insieme al file che i programmi installati vanno a leggere.

Come si manda un aggiornamento, dall'inizio:

 1. alzare il numero di versione in `src-tauri/tauri.conf.json` e in
    `src-tauri/Cargo.toml` (devono essere uguali);
 2. commit, tag `vX.Y.Z`, push del tag;
 3. aspettare che la compilazione su GitHub finisca (Mac e Windows);
 4. lanciare questo script.

I pacchetti restano in una **bozza** di release, che solo il proprietario del
repository vede: chi installa non li scarica da GitHub (troverebbe un 404) ma
dalla pagina pubblicata qui. Il repository invece e' pubblico: per questo prima
di tutto parte il controllo privacy. Rinominare i file non tocca il contenuto, quindi le
firme restano valide.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import unquote

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITO = os.path.join(RADICE, "sito")
CONF = os.path.join(RADICE, "src-tauri", "tauri.conf.json")
CARGO = os.path.join(RADICE, "src-tauri", "Cargo.toml")

# Dove finisce la pagina. Il team e' scritto qui apposta: senza, la CLI userebbe
# l'account collegato in quel momento, che puo' essere un altro (confermato con
# Andrea il 22/09/2026: e' lo stesso di Valutazioni).
PROGETTO_VERCEL = os.environ.get("MAGAZZINO_VERCEL_PROGETTO", "magazzino-sportivo")
SCOPE_VERCEL = os.environ.get("MAGAZZINO_VERCEL_SCOPE", "andrea-rota-s-projects")

# L'indirizzo pubblico e' una cosa a se', anche se oggi coincide col nome del
# progetto: un giorno potrebbe essere un dominio comprato apposta, e allora si
# cambia solo questa riga. Vercel ne assegna due, quello corto e quello lungo
# con dentro il team; qui si usa il corto, che e' quello scritto nel programma
# e sulla pagina. Il lungo continua a funzionare e non si puo' spegnere: e'
# l'indirizzo che Vercel da' al progetto.
#
# Il 22/09/2026 tutti e due hanno risposto 404 per un giorno intero, e la
# colpa non era dell'indirizzo: Vercel pubblicava da sola la radice del
# repository a ogni push, vuota, sostituendo la pagina vera. Vedi
# NOTA-VERCEL.md.
HOST_VERCEL = os.environ.get("MAGAZZINO_VERCEL_HOST", f"{PROGETTO_VERCEL}.vercel.app")


def esegui(cmd: list[str], dove: str | None = None) -> str:
    print("  >", " ".join(cmd))
    # shell=True su Windows: senza, `npx` non viene trovato, perche' e' un
    # `npx.cmd` e la chiamata di sistema cerca solo gli `.exe`.
    r = subprocess.run(
        cmd, capture_output=True, text=True, shell=(os.name == "nt"), cwd=dove or RADICE
    )
    if r.returncode != 0:
        raise SystemExit(f"Comando fallito:\n{r.stdout}\n{r.stderr}")
    return r.stdout


def versioni_coerenti() -> str:
    """Versione del programma, dopo aver controllato che tutto concordi."""
    with open(CONF, encoding="utf-8") as h:
        conf = json.load(h)["version"]
    cargo = re.search(r'^version\s*=\s*"([^"]+)"', open(CARGO, encoding="utf-8").read(), re.M)
    cargo = cargo.group(1) if cargo else "?"
    if conf != cargo:
        raise SystemExit(
            f"Le versioni non coincidono: tauri.conf.json dice {conf}, Cargo.toml dice {cargo}.\n"
            "Allineale prima di pubblicare."
        )
    return conf


def main() -> None:
    # Prima di mettere online qualunque cosa: niente di una societa' vera.
    if subprocess.run([sys.executable, os.path.join(RADICE, "tools", "controlla_privacy.py")]).returncode != 0:
        raise SystemExit("Pubblicazione fermata dal controllo privacy.")
    versione = versioni_coerenti()
    tag = f"v{versione}"
    print(f"Pubblico la versione {versione} ({tag})")

    # --- 1. i pacchetti, scaricati con le credenziali di gh ---
    # Non con urllib: la release e' una bozza, e l'indirizzo pubblico degli
    # allegati risponde 404 senza autenticazione.
    scarico = os.path.join(SITO, "_pacchetti")
    shutil.rmtree(scarico, ignore_errors=True)
    os.makedirs(scarico, exist_ok=True)
    esegui(["gh", "release", "download", tag, "--dir", scarico, "--clobber"])

    allegati = sorted(os.listdir(scarico))
    if not allegati:
        raise SystemExit(
            f"La release {tag} non ha allegati: la compilazione su GitHub e' finita?"
        )
    print(f"  scaricati {len(allegati)} file")

    note = json.loads(esegui(["gh", "release", "view", tag, "--json", "body"])).get("body") or ""

    # --- 2. il file che i programmi installati vanno a leggere ---
    # Non si indovinano i nomi dei pacchetti: la compilazione ha gia' scritto
    # `latest.json` con le firme giuste. Qui si riusa quello, cambiando solo gli
    # indirizzi: puntano alla release (privata, risponderebbe 404) e devono
    # puntare alla pagina.
    manifesto = os.path.join(scarico, "latest.json")
    if not os.path.exists(manifesto):
        raise SystemExit(
            "Manca latest.json fra gli allegati: la compilazione non ha prodotto i\n"
            "pacchetti firmati. Controlla che bundle.createUpdaterArtifacts sia true."
        )
    with open(manifesto, encoding="utf-8") as h:
        dati = json.load(h)

    # Come si chiamera' il file sulla pagina, per ogni tipo di computer.
    def nome_pubblico(piattaforma: str, originale: str) -> str:
        if piattaforma.startswith("darwin"):
            return "MagazzinoSportivo-per-Mac.app.tar.gz"
        if originale.lower().endswith(".exe"):
            return "MagazzinoSportivo-per-Windows.exe"
        return "MagazzinoSportivo-per-Windows" + os.path.splitext(originale)[1]

    piattaforme = {}
    for piattaforma, voce in (dati.get("platforms") or {}).items():
        originale = unquote(voce["url"].rsplit("/", 1)[-1])
        sorgente = os.path.join(scarico, originale)
        if not os.path.exists(sorgente):
            print(f"  ATTENZIONE: {piattaforma}: manca {originale}")
            continue
        pubblico = nome_pubblico(piattaforma, originale)
        shutil.copy2(sorgente, os.path.join(SITO, pubblico))
        piattaforme[piattaforma] = {
            "signature": voce["signature"],
            "url": f"https://{HOST_VERCEL}/{pubblico}",
        }
        print(f"  {piattaforma:18} {originale} -> {pubblico}")

    if not piattaforme:
        raise SystemExit("Nessun pacchetto da pubblicare: mi fermo.")
    if not any(k.startswith("darwin") for k in piattaforme):
        print("  ATTENZIONE: nessun pacchetto Mac. Il cliente ha un Mac.")

    # --- 3. il file da scaricare a mano, per chi installa la prima volta ---
    # Su Windows il setup.exe fa tutti e due i mestieri ed e' gia' sulla pagina.
    # Sul Mac serve il .dmg, che l'aggiornamento non usa.
    dmg = next((n for n in allegati if n.endswith(".dmg")), None)
    if dmg:
        shutil.copy2(os.path.join(scarico, dmg), os.path.join(SITO, "MagazzinoSportivo-per-Mac.dmg"))
        print(f"  {'primo scarico Mac':18} {dmg} -> MagazzinoSportivo-per-Mac.dmg")

    ultima = {
        "version": versione,
        "notes": re.sub(r"\s+", " ", note).strip()[:400] or f"Versione {versione}",
        "pub_date": dati.get("pub_date")
        or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": piattaforme,
    }
    with open(os.path.join(SITO, "ultima-versione.json"), "w", encoding="utf-8") as h:
        json.dump(ultima, h, ensure_ascii=False, indent=1)
    print(f"  scritto ultima-versione.json ({', '.join(piattaforme)})")

    shutil.copy2(os.path.join(RADICE, "assets", "icona.png"), os.path.join(SITO, "icona.png"))
    shutil.rmtree(scarico, ignore_errors=True)

    # --- 4. online ---
    if "--solo-file" in sys.argv:
        print("Fermato prima di pubblicare (--solo-file). I file sono in sito/")
        return
    # Prima si lega la cartella al progetto giusto. Senza, Vercel crea un
    # progetto nuovo col nome della cartella ("sito") e la pagina finisce a un
    # indirizzo diverso da quello scritto dentro il programma: i programmi
    # installati cercherebbero gli aggiornamenti su un indirizzo che non esiste.
    legame = ["npx", "vercel@latest", "link", "--yes", "--project", PROGETTO_VERCEL]
    deploy = ["npx", "vercel@latest", "deploy", "--prod", "--yes"]
    if SCOPE_VERCEL:
        legame += ["--scope", SCOPE_VERCEL]
        deploy += ["--scope", SCOPE_VERCEL]
    esegui(legame, dove=SITO)
    esegui(deploy, dove=SITO)
    print(f"Fatto: https://{HOST_VERCEL}")

    # --- 5. i pacchetti su GitHub adesso sono una copia in piu' ---
    # Si cancellano **solo adesso**, a caricamento riuscito: cancellandoli prima,
    # un errore di Vercel lascerebbe senza niente e costringerebbe a ricompilare.
    # Il tag resta, quindi la versione si puo' sempre ricostruire da li'.
    if "--tieni-release" in sys.argv:
        print("Release lasciata su GitHub (--tieni-release).")
        return
    esegui(["gh", "release", "delete", tag, "--yes", "--cleanup-tag=false"])
    print(f"Release {tag} cancellata da GitHub: i pacchetti stanno sulla pagina.")


if __name__ == "__main__":
    main()
