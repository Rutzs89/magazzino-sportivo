"""Crea una societa' finta, per le prove automatiche.

Le prove avevano bisogno dei dati di una societa' vera, che pero' non sono
versionati: su una copia pulita del progetto non giravano. Questa societa' e'
inventata da capo — nomi mai esistiti, numeri scelti apposta — e **sta dentro
il repository**, cosi' le prove funzionano ovunque senza nessun dato di persone
vere.

E' costruita per far scattare tutte le regole: due lotti di divise, le maglie
da libero comuni a tutte le squadre, capi in rientro, un numero gia' occupato,
materiale che basta e materiale che non basta.

Si lancia: python tools/crea_societa_prova.py
"""

import json
import os
import random
import shutil

RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(RADICE, "data", "prova", "seed")

# Cognomi e nomi inventati: non devono somigliare a nessuno.
COGNOMI = [
    "Aldobrandi", "Bertoldi", "Cavicchi", "Dorigatti", "Ferrandi", "Gasparri",
    "Lombrichi", "Malfatti", "Nardozzi", "Ortolani", "Peveroni", "Quadrelli",
    "Rinaldeschi", "Sartorelli", "Tortelli", "Ubaldini", "Vannucci", "Zaccagni",
    "Barbanti", "Colombini", "Delfini", "Evangelisti", "Fabbroni", "Gherardi",
]
NOMI = [
    "Alba", "Bice", "Cleo", "Dafne", "Ebe", "Fiamma", "Gilda", "Iole",
    "Lidia", "Mirta", "Nina", "Ombretta", "Perla", "Rea", "Selva", "Tilde",
    "Ulma", "Vera", "Zaira", "Anita", "Brisa", "Celia", "Dina", "Elsa",
]

SQUADRE = ["UNDER 13", "UNDER 16", "UNDER 18", "PRIMA SQUADRA"]
TAGLIE = ["XS", "S", "M", "L", "XL"]


def main() -> None:
    r = random.Random(20260922)  # seme fisso: la societa' finta e' sempre la stessa
    shutil.rmtree(DEST, ignore_errors=True)
    os.makedirs(DEST, exist_ok=True)
    doc = {}

    # --- impostazioni: due lotti e le maglie da libero comuni a tutte
    doc["settings_main"] = {
        "stagione": "2026/27",
        "squadre": [
            {"nome": s, "includi": True,
             "modelloDivisa": "PRIMA SQUADRA" if s == "PRIMA SQUADRA" else "STANDARD"}
            for s in SQUADRE
        ],
        "articoli": [
            {"nome": "DIVISA GARA", "conNumero": True, "taglie": TAGLIE},
            {"nome": "TUTA", "conNumero": False, "taglie": TAGLIE},
            {"nome": "BORRACCIA", "conNumero": False, "taglie": ["UNICA"]},
            {"nome": "BORSONE", "conNumero": False, "taglie": ["UNICA"]},
        ],
        "modelli": ["STANDARD", "LIBERO", "PRIMA SQUADRA"],
        "modelliComuni": ["LIBERO"],
    }

    # --- atlete: sei per squadra
    atlete = []
    i = 0
    for squadra in SQUADRE:
        for _ in range(6):
            aid = f"A{i + 1:03d}"
            doc[f"atlete_{aid}"] = {
                "squadra": squadra,
                "cognome": COGNOMI[i % len(COGNOMI)],
                "nome": NOMI[i % len(NOMI)],
                "attiva": True,
                "note": "",
            }
            atlete.append((aid, squadra))
            i += 1

    # --- divise
    d = 0

    def divisa(taglia, numero, modello, holder=None, da_restituire=False, nota=""):
        nonlocal d
        d += 1
        doc[f"divise_D{d:03d}"] = {
            "taglia": taglia, "numero": numero, "modello": modello,
            "holder": holder, "daRestituire": da_restituire, "note": nota,
        }

    # una in uso e una da cambiare per ogni squadra, poi magazzino
    numero = 1
    for aid, squadra in atlete:
        lotto = "PRIMA SQUADRA" if squadra == "PRIMA SQUADRA" else "STANDARD"
        if numero % 3 == 0:
            divisa(r.choice(TAGLIE[:3]), numero, lotto, aid, True, "taglia sbagliata")
        elif numero % 3 == 1:
            divisa(r.choice(TAGLIE[:3]), numero, lotto, aid)
        numero += 1
    for n in range(40, 56):
        divisa(r.choice(TAGLIE), n, "STANDARD")
    for n in range(60, 66):
        divisa(r.choice(TAGLIE[:4]), n, "PRIMA SQUADRA")
    # maglie da libero: valgono per tutte le squadre
    for n in (90, 91, 92):
        divisa("M", n, "LIBERO")
    divisa("S", 93, "LIBERO", atlete[0][0])
    divisa("S", 93, "LIBERO", atlete[8][0])  # stesso numero, altra squadra: e' ammesso

    # --- materiale: qualcosa abbonda, qualcosa no
    m = 0

    def materiale(articolo, taglia, quanti):
        nonlocal m
        m += 1
        doc[f"materiale_M{m:03d}"] = {
            "articolo": articolo, "taglia": taglia,
            "iniziale": quanti, "precedente": False,
        }

    for t in TAGLIE:
        materiale("TUTA", t, {"XS": 2, "S": 6, "M": 8, "L": 4, "XL": 1}[t])
    materiale("BORRACCIA", "UNICA", 30)
    materiale("BORSONE", "UNICA", 3)  # meno delle richieste: qualcuna resta fuori

    # --- richieste
    q = 0

    def richiesta(aid, articolo, taglia, numero_des=None, modello=""):
        nonlocal q
        q += 1
        doc[f"richieste_R{q:04d}"] = {
            "atletaId": aid, "articolo": articolo, "modello": modello,
            "taglia": taglia, "numeroDesiderato": numero_des, "note": "", "ordine": q,
        }

    for k, (aid, squadra) in enumerate(atlete):
        richiesta(aid, "DIVISA GARA", r.choice(TAGLIE[:3]), 7 if k == 5 else None)
        richiesta(aid, "BORRACCIA", "UNICA")
        if k % 2 == 0:
            richiesta(aid, "TUTA", r.choice(TAGLIE))
        if k % 5 == 0:
            richiesta(aid, "BORSONE", "UNICA")
    # una libero, per far usare il mucchio comune
    richiesta(atlete[12][0], "DIVISA GARA", "M", None, "LIBERO")

    for nome, dati in doc.items():
        with open(os.path.join(DEST, f"{nome}.json"), "w", encoding="utf-8") as h:
            json.dump(dati, h, ensure_ascii=False)

    conta = {}
    for nome in doc:
        conta[nome.split("_")[0]] = conta.get(nome.split("_")[0], 0) + 1
    print(f"societa' di prova in {DEST}")
    print(" ", conta)


if __name__ == "__main__":
    main()
