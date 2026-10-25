#!/usr/bin/env python3
"""
gen_demo_photos.py — Génère des portraits de démonstration (silhouettes professionnelles)
pour les 8 annonces seed. Sortie : public/uploads/listings/demo-1.webp … demo-8.webp
Usage : python3 scripts/gen_demo_photos.py
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'uploads', 'listings')
os.makedirs(OUT, exist_ok=True)

# (fond clair, fond foncé, silhouette, cheveux) — femmes : chignon, hommes : casquette
PALS = [
    ((255, 231, 205), (247, 158, 46), (120, 82, 52)),
    ((214, 245, 244), (13, 158, 146), (66, 57, 50)),
    ((255, 218, 224), (219, 39, 119), (74, 60, 54)),
    ((219, 234, 254), (37, 99, 235), (60, 50, 44)),
    ((221, 247, 231), (22, 163, 74), (130, 92, 60)),
    ((254, 244, 199), (202, 138, 4), (70, 58, 50)),
    ((237, 233, 254), (124, 58, 237), (90, 66, 48)),
    ((255, 237, 213), (234, 88, 12), (105, 76, 52)),
]
# Ordre des annonces seed : 1F 2F 3M 4F 5F 6F 7M 8F
FEMALE = [True, True, False, True, True, True, False, True]
SUP, SIZE = 2, 600


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def portrait(idx, palette, female):
    light, dark, skin = palette
    S = SIZE * SUP
    img = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(img)
    for y in range(S):  # dégradé vertical doux
        d.line([(0, y), (S, y)], fill=lerp(light, dark, (y / S) * 0.55))

    cx = S / 2
    # Épaules / buste
    d.ellipse([cx - 0.34 * S, 0.66 * S, cx + 0.34 * S, 1.45 * S], fill=skin)
    # Cou
    d.rectangle([cx - 0.075 * S, 0.52 * S, cx + 0.075 * S, 0.72 * S], fill=skin)
    # Tête
    d.ellipse([cx - 0.185 * S, 0.16 * S, cx + 0.185 * S, 0.575 * S], fill=skin)
    # Chevelure (ton sombre) — dessinée sur le haut du crâne
    hair = tuple(int(c * 0.35) for c in skin)
    if female:  # chignon + raie
        d.ellipse([cx - 0.20 * S, 0.10 * S, cx + 0.20 * S, 0.42 * S], fill=hair)
        d.ellipse([cx - 0.10 * S, 0.02 * S, cx + 0.10 * S, 0.22 * S], fill=hair)
        d.rectangle([cx - 0.20 * S, 0.24 * S, cx - 0.145 * S, 0.58 * S], fill=hair)
        d.rectangle([cx + 0.145 * S, 0.24 * S, cx + 0.20 * S, 0.58 * S], fill=hair)
    else:       # coupe courte
        d.pieslice([cx - 0.19 * S, 0.13 * S, cx + 0.19 * S, 0.50 * S], 180, 360, fill=hair)

    # Col audacieux (couleur de la palette)
    d.polygon([(cx - 0.22 * S, 0.72 * S), (cx + 0.22 * S, 0.72 * S), (cx, 0.88 * S)], fill=lerp(dark, (255, 255, 255), 0.25))
    d.ellipse([cx - 0.075 * S, 0.855 * S, cx + 0.075 * S, 0.93 * S], fill=lerp(dark, (255, 255, 255), 0.45))

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    out = os.path.join(OUT, f'demo-{idx}.webp')
    img.save(out, 'WEBP', quality=85)
    print(f'✔ demo-{idx}.webp')


for i, (p, f) in enumerate(zip(PALS, FEMALE), start=1):
    portrait(i, p, f)
print('Portraits de démonstration générés dans', os.path.abspath(OUT))
