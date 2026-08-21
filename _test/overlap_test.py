# -*- coding: utf-8 -*-
"""overlap_test.py — 試合画面のボタン干渉を全数で見張る

本人の指摘（2026-08-21・画像1）:
  「ショットクロックを入れて横向きにすると他のボタンに干渉して
    操作性が下がる」「ほかにもないかチェックしてみて」

種目11 × 時計3種 × 向き2 = 66通りで、
  ・押せるボタン同士が重なっていないか
  ・画面の外に出ていないか
  ・44px を割っていないか
を測る。1つでも見つかったら失敗にする。

最初に測ったときは6件（横向きのローテーションとボウラード）で
盤面が「交代」「スコア修正」に重なっていた。
実行: python _test/overlap_test.py（5分ほどかかる）
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, "D:/Claudecode/pool-score/_test")
import helpers

ROOT = "D:/Claudecode/pool-score"
URL = "file:///" + ROOT + "/index.html"

GAMES = ["9ball", "9ball_doubles", "10ball", "10ball_doubles", "8ball",
         "rotation", "straight", "bowlard", "jpa_9ball", "jpa_9ball_doubles",
         "jpa_8ball"]
CLOCKS = ["none", "shot", "chess"]
VIEWS = [("縦", 390, 844), ("横", 844, 390)]

PROBE = """() => {
  const scr = document.getElementById('screenMatch');
  const vis = e => {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const btns = [...scr.querySelectorAll('button')]
    .filter(b => !b.disabled && !b.closest('[hidden]') && vis(b))
    .map(b => {
      const r = b.getBoundingClientRect();
      return {id: b.id || b.className.split(' ')[0],
              t: (b.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 14),
              x: r.left, y: r.top, w: r.width, h: r.height};
    });
  const overlaps = [];
  for (let i = 0; i < btns.length; i++) {
    for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i], b = btns[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) {
        overlaps.push({a: a.t || a.id, b: b.t || b.id,
                       ox: Math.round(ox), oy: Math.round(oy)});
      }
    }
  }
  const W = window.innerWidth, H = window.innerHeight;
  const out = btns.filter(b => b.y + b.h > H + 1 || b.x + b.w > W + 1 || b.y < -1 || b.x < -1)
    .map(b => ({t: b.t || b.id,
                over: Math.round(Math.max(b.y + b.h - H, b.x + b.w - W))}));
  const small = btns.filter(b => b.h < 43.5)
    .map(b => ({t: b.t || b.id, h: Math.round(b.h)}));
  return {n: btns.length, overlaps: overlaps, out: out, small: small};
}"""


def start(pg, gid, clock):
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, gid)
    pg.wait_for_timeout(500)
    if pg.locator("#inNameA").count():
        pg.fill("#inNameA", "たいら")
    if pg.locator("#inNameA2").count() and pg.locator("#inNameA2").is_visible():
        pg.fill("#inNameA2", "たかのぶ")
    if pg.locator("#inNameB").count() and pg.locator("#inNameB").is_visible():
        pg.fill("#inNameB", "いっちょ")
    if pg.locator("#inNameB2").count() and pg.locator("#inNameB2").is_visible():
        pg.fill("#inNameB2", "みなみ")
    pg.wait_for_timeout(300)
    if gid.startswith("jpa"):
        f = pg.locator("#goalArea .field")
        for i in range(min(2, f.count())):
            c = f.nth(i).locator(".chip", has_text="SL5")
            if c.count():
                c.first.click()
                pg.wait_for_timeout(100)
    # 時計
    tg = pg.locator("#clockTypeToggle")
    if tg.count():
        label = {"none": "使わない", "shot": "ショット", "chess": "チェス"}[clock]
        tg.locator("button", has_text=label).first.click()
        pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)


results = []
rows = []
with sync_playwright() as p:
    br = p.chromium.launch()
    for vname, W, H in VIEWS:
        for gid in GAMES:
            for clock in CLOCKS:
                pg = br.new_page(viewport={"width": W, "height": H})
                errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.goto(URL)
                pg.wait_for_timeout(500)
                try:
                    start(pg, gid, clock)
                    if not pg.is_visible("#screenMatch"):
                        rows.append((vname, gid, clock, "開始できず", None))
                        pg.close()
                        continue
                    r = pg.evaluate(PROBE)
                    if r["overlaps"] or r["out"] or r["small"]:
                        rows.append((vname, gid, clock, "NG", r))
                        print("NG %s %s 時計=%s  重なり%d 画面外%d 小さい%d"
                              % (vname, gid, clock, len(r["overlaps"]),
                                 len(r["out"]), len(r["small"])))
                        for o in r["overlaps"][:4]:
                            print("     重なり: %s ⇔ %s (%dx%d)" % (o["a"], o["b"], o["ox"], o["oy"]))
                        for o in r["out"][:4]:
                            print("     画面外: %s (%dpx)" % (o["t"], o["over"]))
                        for o in r["small"][:4]:
                            print("     小さい: %s (%dpx)" % (o["t"], o["h"]))
                    else:
                        rows.append((vname, gid, clock, "OK", r))
                except Exception as e:
                    rows.append((vname, gid, clock, "例外", str(e)[:120]))
                    print("例外 %s %s %s -> %s" % (vname, gid, clock, str(e)[:120]))
                pg.close()
    br.close()

ng = [r for r in rows if r[3] != "OK"]
print("\n===== %d 組み合わせ中 %d 件に問題 =====" % (len(rows), len(ng)))
for r in ng:
    print("  %s / %s / 時計=%s : %s" % (r[0], r[1], r[2], r[3]))
