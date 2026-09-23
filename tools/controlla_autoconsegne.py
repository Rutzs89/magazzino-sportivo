"""Trova le consegne di una divisa a chi la aveva gia' addosso.

Fino alla versione 0.3.7 il programma poteva proporre a un'atleta la stessa
maglia che stava restituendo (stessa taglia, stesso numero). Premendo
"Consegna" la richiesta si chiudeva, ma nella realta' non cambiava niente: la
maglia vecchia restava a lei e non risultava piu' da cambiare.

Dall'archivio attuale da solo non si capisce: una consegna cosi' e' identica a
una consegna normale. Serve anche l'archivio di partenza, quello caricato la
prima volta, per sapere chi aveva ogni maglia prima dei movimenti.

Uso:
    python tools/controlla_autoconsegne.py <copia-di-adesso.json> <archivio-di-partenza.json>

La copia di adesso si salva dal programma: Impostazioni -> Copie di sicurezza
-> Salva una copia.
"""

import json
import sys


def carica(p: str) -> dict:
    with open(p, encoding="utf-8") as h:
        return json.load(h)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    ora, partenza = carica(sys.argv[1]), carica(sys.argv[2])
    atlete = {**partenza.get("atlete", {}), **ora.get("atlete", {})}

    def nome(aid, mv=None):
        a = atlete.get(aid)
        if a:
            return f"{a.get('cognome', '')} {a.get('nome', '')}".strip()
        return (mv or {}).get("a") or "atleta non piu' in archivio"

    # chi aveva ogni divisa all'inizio
    chi = {did: d.get("holder") for did, d in partenza.get("divise", {}).items()}
    movimenti = sorted(
        (m for m in ora.get("movimenti", {}).values() if m.get("divisaId")),
        key=lambda m: m.get("ts") or 0,
    )
    trovate = []
    for m in movimenti:
        did = m["divisaId"]
        if m.get("tipo") == "CONSEGNA":
            destinataria = m.get("atletaId")
            if destinataria and chi.get(did) == destinataria:
                trovate.append(m)
            chi[did] = destinataria
        elif m.get("tipo") == "RIENTRO":
            chi[did] = None

    if not trovate:
        print("Nessuna consegna di una divisa a chi la aveva gia'.")
        return
    print(f"{len(trovate)} consegne di una divisa a chi la aveva gia':\n")
    for m in trovate:
        a = atlete.get(m.get("atletaId")) or {}
        print(
            f"  {m.get('data', '')}  {nome(m.get('atletaId'), m)}"
            f" ({a.get('squadra', '')}): taglia {m.get('taglia')} n.{m.get('numero')}"
        )
    print(
        "\nPer ognuna, nella scheda dell'atleta: 'Segna da cambiare' sulla maglia,"
        "\npoi 'Nuova richiesta' della divisa. Il programma proporra' una maglia"
        "\ndiversa, con lo stesso numero se c'e'."
    )


if __name__ == "__main__":
    main()
