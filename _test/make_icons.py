# -*- coding: utf-8 -*-
"""アプリのアイコンを生成する（9番ボール風）

依存を増やさないよう、PNGは Playwright のスクリーンショットで作る。
再生成が必要になったら: python _test/make_icons.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 9番ボール（黄色のストライプ）。アプリの配色に合わせる
def svg(size, maskable):
    # maskable はセーフゾーン確保のため図柄を小さめに描く
    r = 34 if maskable else 46
    cx = 50
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#22b573"/>
  <circle cx="{cx}" cy="50" r="{r}" fill="#ffffff" stroke="#2b2118" stroke-width="3"/>
  <path d="M {cx-r} 50 a {r} {r} 0 0 1 {r*2} 0 z" fill="#f5a524" opacity="0"/>
  <!-- 上下の黄色い帯（ストライプ球） -->
  <clipPath id="c"><circle cx="{cx}" cy="50" r="{r-1.5}"/></clipPath>
  <g clip-path="url(#c)">
    <rect x="0" y="{50-r}" width="100" height="{r*0.42}" fill="#f5a524"/>
    <rect x="0" y="{50+r*0.58}" width="100" height="{r*0.42}" fill="#f5a524"/>
  </g>
  <circle cx="{cx}" cy="50" r="{r*0.44}" fill="#ffffff" stroke="#2b2118" stroke-width="2.5"/>
  <text x="{cx}" y="50" font-family="'M PLUS Rounded 1c','Yu Gothic',sans-serif"
        font-size="{r*0.62}" font-weight="900" fill="#2b2118"
        text-anchor="middle" dominant-baseline="central">9</text>
</svg>'''


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
