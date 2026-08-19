# -*- coding: utf-8 -*-
"""アプリのアイコンを生成する（8bitドット絵の9番ボール）

依存を増やさないよう、PNGは Playwright のスクリーンショットで作る。
再生成が必要になったら: python _test/make_icons.py

意匠について:
    既存ゲームの画像・ロゴ・スプライトは一切使っていない。
    16x16のドットを1マスずつ矩形で置いて描いた独自の図案。
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# style.css の配色トークンと揃える
SKY = "#5c94fc"
INK = "#1a1408"
COIN = "#fbd000"
WHITE = "#ffffff"
SHADE = "#c79000"   # 球の陰
GROUND = "#3aa63a"  # 地面の緑

# 16x16のドット絵。1文字=1マス
#   .=空  #=黒(輪郭と数字)  W=白  Y=黄(ストライプ)  S=陰
# 9番ボール（上下に黄色い帯／中央の白帯に「9」）を正面から見た図。
# 数字は4x5マスで描く。これ以上小さくすると192pxで潰れる。
PIXELS = [
    ".....######.....",
    "...##YYYYYY##...",
    "..#YYYYYYYYYY#..",
    ".#YYYYYYYYYYYY#.",
    "#YYYYYYYYYYYYYS#",
    "#WWWWWWWWWWWWWS#",
    "#WWWW######WWWS#",
    "#WWWW#WWWW#WWWS#",
    "#WWWW######WWWS#",
    "#WWWWWWWW##WWWS#",
    "#WWWWW#####WWWS#",
    "#YYYYYYYYYYYYSS#",
    ".#YYYYYYYYYYYS#.",
    "..#YYYYYYYYYS#..",
    "...##YYYYYYS##..",
    ".....######.....",
]

COLOR = {"#": INK, "W": WHITE, "Y": COIN, "S": SHADE, "G": GROUND}


def svg(size, maskable):
    """16x16のドットを矩形で並べたSVGを返す。

    maskable は端が丸く切り取られてもよいよう、図柄を中央に小さめに置く
    （セーフゾーン = 中央80%）。
    """
    grid = 16
    # 図柄の占める割合。maskable は安全域に収める
    scale = 0.60 if maskable else 0.80
    cell = 100.0 * scale / grid
    off = (100.0 - cell * grid) / 2.0

    rects = []
    # 背景。空色にして、下部に地面の帯を入れる（世界観を出す）
    rects.append('<rect width="100" height="100" fill="%s"/>' % SKY)
    if not maskable:
        # 地面は角まで届かせる。maskable では切られるので描かない
        rects.append('<rect x="0" y="87" width="100" height="13" fill="%s"/>' % GROUND)
        rects.append('<rect x="0" y="87" width="100" height="3" fill="%s"/>' % INK)

    for y, row in enumerate(PIXELS):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            fill = COLOR.get(ch)
            if not fill:
                continue
            px = off + x * cell
            py = off + y * cell
            # 隣接マスの継ぎ目が出ないよう、わずかに大きく描く
            rects.append(
                '<rect x="%.3f" y="%.3f" width="%.3f" height="%.3f" fill="%s"/>'
                % (px, py, cell + 0.06, cell + 0.06, fill)
            )

    body = "\n  ".join(rects)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
        'viewBox="0 0 100 100" shape-rendering="crispEdges">\n  %s\n</svg>'
        % (size, size, body)
    )


ICONS = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("icon-512-maskable.png", 512, True),
    ("apple-touch-icon.png", 180, False),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, size, maskable in ICONS:
        pg = b.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
        pg.set_content(
            '<html><body style="margin:0;padding:0">' + svg(size, maskable) + "</body></html>"
        )
        pg.wait_for_timeout(250)
        out = os.path.join(ROOT, name)
        pg.screenshot(path=out, omit_background=False)
        print("生成:", name, "(%dx%d)" % (size, size))
        pg.close()
    b.close()

print("完了")
