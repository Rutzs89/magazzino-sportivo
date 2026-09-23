"""Dove stanno i dati della societa' su cui girano le prove.

Lo stesso di tests/dati_prove.js: la cartella si indica in
data/dati-delle-prove.txt (una riga, il percorso della cartella che contiene
seed/ e modelli/) o nella variabile d'ambiente MAGAZZINO_DATI. I dati non
stanno nel repository: sono nomi di atleti veri.
"""

import os

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUNTATORE = os.path.join(RADICE, "data", "dati-delle-prove.txt")


def cartella() -> str:
    """Il percorso assoluto, oppure "" se non e' indicato o non esiste."""
    d = os.environ.get("MAGAZZINO_DATI", "")
    if not d and os.path.exists(PUNTATORE):
        with open(PUNTATORE, encoding="utf-8") as h:
            d = h.read().strip()
    if not d:
        return ""
    if not os.path.isabs(d):
        d = os.path.join(RADICE, d)
    return d if os.path.isdir(os.path.join(d, "seed")) else ""
