"""Controlla che niente di una societa' vera finisca nei file destinati a GitHub.

Cosa cerca, nei file versionati (e in quelli nuovi non ancora aggiunti):
  - i nomi e i cognomi degli atleti, letti dal seed della societa' delle prove
    (vedi tools/dati_prove.py), senza distinguere maiuscole e minuscole;
  - le parole elencate in `parole-private.txt` nella cartella della societa'
    (il nome della societa', la citta', qualunque cosa la riconosca), una per
    riga;
  - collegamenti ad app condivise su claude.ai, indirizzi email, numeri di
    telefono;
  - pacchetti del programma versionati per sbaglio (.msi, .exe, .dmg).

I nomi non sono scritti qui dentro: si leggono dall'archivio locale, che sul
computer c'e' e online non va mai. Cosi' il controllo non e' lui stesso un
elenco di minorenni.

Si lancia da `prove.bat`, da `tools/pubblica_aggiornamento.py` e dal controllo
prima di ogni push:
    python tools/controlla_privacy.py
Esce con codice 1 se trova qualcosa, cosi' si puo' mettere in catena. Esce con
codice 1 anche se non trova i dati da cui leggere i nomi: un controllo che non
controlla niente non deve dire "pulito".
"""

import glob
import json
import os
import re
import subprocess
import sys
import unicodedata

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dati_prove import cartella  # noqa: E402

# Pezzi di nome piu' corti danno falsi allarmi dappertutto, anche cercando
# solo la parola intera.
LUNGHEZZA_MINIMA = 4
# Parole che sono anche cognomi o nomi ma compaiono normalmente nel codice.
DA_IGNORARE = {
    "prima", "bianca", "nera", "verde", "rossa", "gialla", "bianco", "nero",
    "rosa", "marino", "sole", "gloria", "vittoria", "serena", "bella", "rita",
    "neve", "luna", "stella", "mare", "rocco", "lotto", "costa", "valle",
    "monti", "villa", "fiore", "leone", "campo", "porta", "riva", "piazza",
    "resta", "vera", "chiara", "franca", "grazia", "speranza", "fede",
    # chi sviluppa il programma: compare come autore, non e' un atleta
    "andrea",
}
ESTENSIONI_PACCHETTO = (".msi", ".exe", ".dmg", ".app.tar.gz")
SEGNI = [
    ("collegamento a un'app condivisa su claude.ai", re.compile(r"claude\.ai/(?:artifact|public/artifacts)/\w+", re.I)),
    ("indirizzo email", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    ("numero di telefono", re.compile(r"(?<![\w.])(?:\+39[\s.]?)?3\d{2}[\s.]?\d{6,7}(?![\w.])")),
]
# Email che possono stare nel codice: quella per le firme dei commit generati.
EMAIL_AMMESSE = {"noreply@anthropic.com"}


def senza_accenti(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def nomi(dati: str) -> set[str]:
    fuori = set()
    for f in glob.glob(os.path.join(dati, "seed", "atlete_*.json")):
        with open(f, encoding="utf-8") as h:
            a = json.load(h)
        for campo in ("cognome", "nome"):
            v = senza_accenti(str(a.get(campo) or "")).strip()
            for pezzo in re.split(r"[\s'’-]+", v):
                if len(pezzo) >= LUNGHEZZA_MINIMA and pezzo.lower() not in DA_IGNORARE:
                    fuori.add(pezzo.lower())
    return fuori


def parole_private(dati: str) -> set[str]:
    p = os.path.join(dati, "parole-private.txt")
    if not os.path.exists(p):
        return set()
    with open(p, encoding="utf-8") as h:
        return {
            senza_accenti(r.strip()).lower()
            for r in h
            if r.strip() and not r.startswith("#")
        }


def file_versionati() -> list[str]:
    r = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=RADICE,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        print("Non e' un repository git: niente da controllare.")
        sys.exit(0)
    return [f for f in r.stdout.splitlines() if f.strip()]


def copia_pubblicabile() -> bool:
    """Questa copia del progetto puo' finire online?"""
    r = subprocess.run(["git", "remote"], cwd=RADICE, capture_output=True, text=True)
    return r.returncode == 0 and bool(r.stdout.strip())


def main() -> None:
    # Il programma che si scarica dal web deve nascere vuoto. Se questa copia
    # puo' essere pubblicata e insieme ha una societa' di partenza, il pacchetto
    # conterrebbe gli atleti di quella societa': ci si ferma prima.
    partenza = os.path.join(RADICE, "data", "societa-di-partenza.txt")
    if os.path.exists(partenza) and copia_pubblicabile():
        with open(partenza, encoding="utf-8") as h:
            quale = h.read().strip()
        print(
            "\nFERMO TUTTO. Questa copia del progetto e' collegata a GitHub,\n"
            f"ma il programma nascerebbe con i dati di '{quale}' dentro.\n\n"
            "Il programma che si scarica dal web deve essere vuoto: togli\n"
            "data/societa-di-partenza.txt, oppure lavora nella copia che non\n"
            "ha nessun collegamento a GitHub."
        )
        sys.exit(1)

    dati = cartella()
    if not dati:
        print(
            "\nFERMO TUTTO. Non trovo i dati da cui leggere i nomi da cercare.\n"
            "Scrivi in data/dati-delle-prove.txt la cartella della societa'\n"
            "(quella con seed/). Senza, il controllo non controlla niente."
        )
        sys.exit(1)
    cercati = nomi(dati) | parole_private(dati)
    print(f"Controllo {len(cercati)} nomi e parole private, piu' email, telefoni e collegamenti...")

    trovati: dict[str, set[str]] = {}
    for percorso in file_versionati():
        if percorso.lower().endswith(ESTENSIONI_PACCHETTO):
            trovati.setdefault(percorso, set()).add("pacchetto del programma: non va versionato")
            continue
        intero = os.path.join(RADICE, percorso)
        try:
            with open(intero, encoding="utf-8") as h:
                testo = h.read()
        except (OSError, UnicodeDecodeError):
            continue  # file binari: immagini, font, icone
        piatto = senza_accenti(testo).lower()
        for n in cercati:
            # Parola intera. Senza, un nome corto che e' anche l'inizio di una
            # parola comune scatta dappertutto. (Capitato davvero: un cognome
            # dell'elenco compariva dentro un verbo del .gitignore.)
            if re.search(r"(?<!\w)" + re.escape(n) + r"(?!\w)", piatto):
                trovati.setdefault(percorso, set()).add(n)
        for cosa, schema in SEGNI:
            for m in schema.finditer(testo):
                t = m.group(0).lower()
                # "icona@2x.png" non e' una email
                if t in EMAIL_AMMESSE or t.endswith((".png", ".jpg", ".svg", ".webp", ".ico")):
                    continue
                trovati.setdefault(percorso, set()).add(f"{cosa}: {m.group(0)[:40]}")

    if not trovati:
        print("Pulito: niente di una societa' vera nei file che andrebbero online.")
        return

    print("\nFERMO TUTTO. Questi file contengono dati da non pubblicare:\n")
    for percorso, quali in sorted(trovati.items()):
        print(f"  {percorso}: {', '.join(sorted(quali))}")
    print("\nToglili, oppure escludi il file nel .gitignore, prima di pubblicare.")
    sys.exit(1)


if __name__ == "__main__":
    main()
