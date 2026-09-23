"""Disegna l'icona del programma: una maglia da gioco, niente stemmi.

L'icona e' del prodotto, non di una societa': una societa' il suo stemma lo
carica dalle Impostazioni e lo vede nell'intestazione. Qui serve un segno
neutro, che vada bene a chiunque lo installi.

Produce assets/icona.png (1024x1024). Da li' `npx tauri icon assets/icona.png`
genera tutti i formati per Windows, Mac e il resto.

Si lancia a mano quando si vuole cambiare il disegno:
    python tools/crea_icona.py
"""

import os

from PIL import Image, ImageDraw

LATO = 1024
INCHIOSTRO = (28, 36, 48, 255)  # lo stesso grigio-blu dell'app
GIALLO = (242, 194, 48, 255)


def maglia(d: ImageDraw.ImageDraw, cx: int, cy: int, larghezza: int, colore) -> None:
    """Una maglia vista di fronte: corpo, spalle, maniche, scollo."""
    w = larghezza
    h = int(w * 1.05)
    x, y = cx - w // 2, cy - h // 2

    spalla = int(w * 0.22)  # quanto sporgono le maniche
    manica = int(h * 0.34)  # fin dove arrivano
    collo = int(w * 0.17)

    corpo = [
        (x + spalla, y),                      # spalla sinistra
        (x, y + int(h * 0.10)),               # punta manica sinistra
        (x, y + manica),
        (x + spalla, y + int(manica * 0.92)),
        (x + spalla, y + h),                  # fondo sinistra
        (x + w - spalla, y + h),              # fondo destra
        (x + w - spalla, y + int(manica * 0.92)),
        (x + w, y + manica),
        (x + w, y + int(h * 0.10)),
        (x + w - spalla, y),                  # spalla destra
    ]
    d.polygon(corpo, fill=colore)

    # lo scollo: un mezzo cerchio scavato in mezzo alle spalle
    d.pieslice(
        [cx - collo, y - collo, cx + collo, y + collo],
        start=0,
        end=180,
        fill=INCHIOSTRO,
    )


def main() -> None:
    radice = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    im = Image.new("RGBA", (LATO, LATO), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # Fondo: quadrato con gli angoli molto arrotondati. Sul Mac le icone sono
    # gia' dentro una loro forma, ma un fondo pieno regge su tutti e due i sistemi.
    margine = int(LATO * 0.06)
    d.rounded_rectangle(
        [margine, margine, LATO - margine, LATO - margine],
        radius=int(LATO * 0.22),
        fill=INCHIOSTRO,
    )

    maglia(d, LATO // 2, int(LATO * 0.50), int(LATO * 0.50), GIALLO)

    dove = os.path.join(radice, "assets", "icona.png")
    im.save(dove)
    print(f"{dove} ({LATO}x{LATO})")
    print("Ora: npx tauri icon assets/icona.png")


if __name__ == "__main__":
    main()
