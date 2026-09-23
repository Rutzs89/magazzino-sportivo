"""Scarica i font Barlow una volta sola, in assets/font/.

Il programma installato non deve chiedere niente a internet: i font vanno con
lui. Si tengono solo i sottoinsiemi latino (l'italiano ci sta dentro tutto),
non il cirillico o il vietnamita, che peserebbero e non servono.

Si lancia a mano: python tools/scarica_font.py
"""

import os
import re
import urllib.request

URL = (
    "https://fonts.googleapis.com/css2"
    "?family=Barlow:wght@400;500;600"
    "&family=Barlow+Condensed:wght@500;600;700&display=swap"
)
# Chrome recente: senza, Google manda i font nel formato vecchio e pesante.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
DEST = os.path.join("assets", "font")
SOTTOINSIEMI_UTILI = ("latin", "latin-ext")


def scarica(url: str) -> bytes:
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30
    ).read()


def main() -> None:
    os.makedirs(DEST, exist_ok=True)
    css = scarica(URL).decode("utf-8")

    # Ogni blocco @font-face è preceduto dal commento col nome del sottoinsieme.
    blocchi = re.findall(r"/\*\s*([\w-]+)\s*\*/\s*(@font-face\s*\{.*?\})", css, re.S)
    assert blocchi, "non ho trovato i blocchi dei font nel CSS di Google"

    fuori, tenuti = [], 0
    for sottoinsieme, blocco in blocchi:
        if sottoinsieme not in SOTTOINSIEMI_UTILI:
            continue
        famiglia = re.search(r"font-family:\s*'([^']+)'", blocco).group(1)
        peso = re.search(r"font-weight:\s*(\d+)", blocco).group(1)
        url = re.search(r"url\((https[^)]+)\)", blocco).group(1)

        nome = f"{famiglia.replace(' ', '-').lower()}-{peso}-{sottoinsieme}.woff2"
        with open(os.path.join(DEST, nome), "wb") as f:
            f.write(scarica(url))
        tenuti += 1

        # Lo stesso blocco, ma che punta al file accanto invece che a Google.
        fuori.append(re.sub(r"url\(https[^)]+\)", f"url(fonts/{nome})", blocco).strip())

    with open(os.path.join(DEST, "font.css"), "w", encoding="utf-8") as f:
        f.write("/* Barlow, copia locale: generato da tools/scarica_font.py */\n")
        f.write("\n".join(fuori) + "\n")

    print(f"{tenuti} file scaricati in {DEST}")


if __name__ == "__main__":
    main()
