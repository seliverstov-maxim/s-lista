"""Извлекает контуры нотных знаков из шрифта Bravura (SMuFL) в src/glyphs.json.

Запускать нужно только при добавлении новых знаков. Шрифт:
    npm pack @vexflow-fonts/bravura && tar xzf vexflow-fonts-bravura-*.tgz
    pip install fonttools
    python3 scripts/extract-glyphs.py package/bravura.otf

Координаты — в межстрочных интервалах (1 интервал = 1/4 кегля), ось Y направлена вниз,
начало координат — точка привязки знака по SMuFL (для ключей — линия ключа,
для головок и знаков альтерации — центр ноты по вертикали, левый край).
"""
import json
import re
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

# имя знака по SMuFL → кодовая точка
GLYPHS = {
    'gClef': 0xE050,
    'fClef': 0xE062,
    'noteheadWhole': 0xE0A2,
    'noteheadHalf': 0xE0A3,
    'noteheadBlack': 0xE0A4,
    'accidentalSharp': 0xE262,
    'accidentalFlat': 0xE260,
    'accidentalNatural': 0xE261,
    'flag8thUp': 0xE240,
    'flag8thDown': 0xE241,
    'flag16thUp': 0xE242,
    'flag16thDown': 0xE243,
    'restWhole': 0xE4E3,
    'restHalf': 0xE4E4,
    'restQuarter': 0xE4E5,
    'rest8th': 0xE4E6,
    'rest16th': 0xE4E7,
    'augmentationDot': 0xE1E7,
    **{f'timeSig{i}': 0xE080 + i for i in range(10)},
}

font_path = sys.argv[1] if len(sys.argv) > 1 else 'package/bravura.otf'
out_path = Path(__file__).resolve().parent.parent / 'src' / 'glyphs.json'

font = TTFont(font_path)
space = font['head'].unitsPerEm / 4
cmap = font.getBestCmap()
glyph_set = font.getGlyphSet()
fmt = lambda v: ('%.2f' % v).rstrip('0').rstrip('.')  # 0,01 интервала ≈ 0,1 px — точнее не нужно

out = {}
for name, cp in GLYPHS.items():
    g = glyph_set[cmap[cp]]
    pen = SVGPathPen(glyph_set, ntos=fmt)
    g.draw(TransformPen(pen, (1 / space, 0, 0, -1 / space, 0, 0)))
    bounds = BoundsPen(glyph_set)
    g.draw(bounds)
    # короче запись: .5 вместо 0.5, без пробела перед минусом
    d = re.sub(r'(?<![\d.])0\.', '.', pen.getCommands()).replace(' -', '-')
    out[name] = {
        'd': d,
        'adv': round(g.width / space, 3),
        'bbox': [round(v / space, 3) for v in bounds.bounds],  # x0, y0, x1, y1 (ось Y вверх)
    }
    print(f'{name}: ширина {out[name]["adv"]}, рамка {out[name]["bbox"]}')

out_path.write_text(json.dumps(out))
print('записано', out_path)
