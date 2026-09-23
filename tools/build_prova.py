"""Genera dist/magazzino-sportivo-PROVA.html da src/magazzino-sportivo.html + il seed della
societa' indicata in data/dati-delle-prove.txt (vedi tools/dati_prove.py).
La versione di prova sostituisce il db di claude.ai con localStorage e include i dati iniziali."""
import json, glob, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dati_prove import cartella
dati = cartella()
if not dati:
    sys.exit("Manca data/dati-delle-prove.txt: una riga con la cartella della societa' (quella con seed/).")
seed = {}
for f in glob.glob(os.path.join(dati, 'seed', '*.json')):
    col, did = os.path.basename(f)[:-5].split('_', 1)
    seed.setdefault(col, {})[did] = json.load(open(f, encoding='utf-8'))
html = open('src/magazzino-sportivo.html', encoding='utf-8').read()
shim = open('tools/shim_locale.js', encoding='utf-8').read().replace('__SEED__', json.dumps(seed, ensure_ascii=False, separators=(',', ':')))
ANCHOR = '<script>\n/* ============ stato'
assert ANCHOR in html, 'ancora dello script principale non trovata'
out = html.replace(ANCHOR, '<script>\n' + shim + '\n</script>\n' + ANCHOR, 1)
REPL = [
 ('<span class="sync" id="sync">', '<span class="pill yellow" style="margin-left:4px">Versione di prova</span><span class="sync" id="sync">'),
 ("'Sincronizzato'", "(window.__PROVA?'Salvato sul computer':'Sincronizzato')"),
]
for a, b in REPL:
    assert a in out, f'punto di aggancio mancante: {a[:40]}'
    out = out.replace(a, b, 1)
os.makedirs('dist', exist_ok=True)
open('dist/magazzino-sportivo-PROVA.html', 'w', encoding='utf-8').write(out)
print('dist/magazzino-sportivo-PROVA.html', len(out) // 1024, 'KB', {k: len(v) for k, v in seed.items()})
