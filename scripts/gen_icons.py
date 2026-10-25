#!/usr/bin/env python3
"""
gen_icons.py — Génère les icônes PWA de Domestik CI à partir de formes vectorielles.
Produit dans public/icons/ :
  icon-192.png / icon-512.png          → Android (purpose "any", coins arrondis)
  icon-maskable-512.png                → Android maskable (plein cadre, zone sûre 80%)
  apple-touch-icon.png (180)           → iOS (plein cadre, iOS applique son masque)
Usage : python3 scripts/gen_icons.py
"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

TOP = (255, 154, 46)     # #FF9A2E
BOTTOM = (229, 106, 0)   # #E56A00
GREEN = (0, 158, 96)     # #009E60
WHITE = (255, 255, 255)

SUP = 4  # supersampling anti-aliasing


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


HOUSE = [(256, 96), (412, 222), (380, 222), (380, 382), (132, 382), (132, 222), (100, 222)]
CHECK = [(196, 296), (232, 336), (322, 236)]


def mappts(pts, inner_scale, S):
    """Points définis sur une grille 512 → canvas S (centré, réduit par inner_scale)."""
    k, c = S / 512, 256
    return [((c + (x - c) * inner_scale) * k, (c + (y - c) * inner_scale) * k) for x, y in pts]


def render(size, rounded, inner_scale, out_name, base_radius_ratio=0.22):
    """Rend une icône `size`x`size` (dessinée à size*SUP puis réduite)."""
    S = size * SUP
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # --- dégradé diagonal ---
    bg = Image.new('RGBA', (S, S))
    d = ImageDraw.Draw(bg)
    for y in range(S):
        t = y / S
        row = [lerp(TOP, BOTTOM, t)] * S
        d.line([(0, y), (S, y)], fill=row[0])  # rapide : ligne par ligne
    # adoucissement horizontal léger pour un rendu diagonal
    overlay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for x in range(0, S, 4):
        t = x / S * 0.25
        od.line([(x, 0), (x, S)], fill=lerp((255, 255, 255), (0, 0, 0), t) + (28,))
    bg = Image.alpha_composite(bg, overlay)

    # --- masque du fond ---
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * base_radius_ratio, fill=255)
    else:
        md.rectangle([0, 0, S, S], fill=255)
    img.paste(bg, (0, 0), mask)

    # --- maison + coche ---
    k = S / 512
    d = ImageDraw.Draw(img)
    d.polygon(mappts(HOUSE, inner_scale, S), fill=WHITE)
    cps = mappts(CHECK, inner_scale, S)
    d.line(cps, fill=GREEN, width=int(34 * k * inner_scale), joint='curve')
    r = 17 * k * inner_scale
    for x, y in cps[::2]:  # bouts arrondis
        d.ellipse([x - r, y - r, x + r, y + r], fill=GREEN)

    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(OUT, out_name))
    print(f'✔ {out_name} ({size}px)')


render(192, rounded=True, inner_scale=1.0, out_name='icon-192.png')
render(512, rounded=True, inner_scale=1.0, out_name='icon-512.png')
render(512, rounded=False, inner_scale=0.72, out_name='icon-maskable-512.png')
render(180, rounded=False, inner_scale=0.82, out_name='apple-touch-icon.png')
render(32, rounded=True, inner_scale=1.0, out_name='favicon-32.png')
print('Icônes générées dans', os.path.abspath(OUT))
