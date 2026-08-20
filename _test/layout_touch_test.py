# -*- coding: utf-8 -*-
"""layout_touch_test.py — 配置図の見た目と操作性（本人指示3・2026-08-20）

指示: 「配置図のボールはパラジウムにして、操作性をもっと良くして」

確認する内容:
  1. 球が試合画面と同じ描き方（番号が白い丸の中／選んだセットの色）
  2. 指で掴める大きさ（44px以上）
  3. 取り消しができる（どける・動かす・全部どける）

実行: python _test/layout_touch_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def put(pg, n):
    pg.click('.tray-ball[data-ball="%s"]' % n)
    pg.wait_for_timeout(200)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 375, "height": 667})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(600)
    pg.click("#tabLayout")
    pg.wait_for_timeout(600)

    # ============================================================
    section("1. 試合画面と同じ描き方")
    put(pg, "1")
    put(pg, "9")

    # 番号は白い丸（.bb-num）の中にある
    check(pg.locator('.tb-ball[data-ball="1"] .bb-num').count() == 1,
          "台の球の番号が白い丸の中にある")
    check(pg.locator('.tray-ball[data-ball="5"] .bb-num').count() == 1,
          "一覧の球も同じ描き方")

    # 色は BALL_SETS（標準＝パラジウム）と一致する
    # ブラウザは #f2b705 を rgb(242,183,5) に直して持つため、
    # 文字列ではなく同じ色かどうかで比べる
    same = pg.evaluate("""() => {
      const el = document.querySelector('.tb-ball[data-ball="1"]');
      const ap = ballAppearance('standard', 1);
      const probe = document.createElement('span');
      probe.style.color = ap.base;
      document.body.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).backgroundColor === want;
    }""")
    check(same, "1番の色が標準セット（パラジウム）と一致する")

    # ストライプ（9番）は帯になっている
    striped = pg.evaluate("""() => {
      const el = document.querySelector('.tb-ball[data-ball="9"]');
      return (el.style.background || '').indexOf('gradient') >= 0;
    }""")
    check(striped, "9番はストライプ（帯）で描かれる")

    # 手玉は番号を持たない
    put(pg, "0")
    check(pg.locator('.tb-ball[data-ball="0"] .bb-num').count() == 0, "手玉に番号は出ない")

    # ============================================================
    section("2. 指で掴める大きさ")
    size = pg.evaluate("""() => {
      const r = document.querySelector('.tb-ball').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }""")
    check(size["w"] >= 44 and size["h"] >= 44, "台の球が44px以上", size)

    tray = pg.evaluate("""() => {
      const r = document.querySelector('.tray-ball').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }""")
    check(tray["h"] >= 44, "一覧の球も44px以上", tray)

    # 丸いまま（楕円に潰れない）
    check(abs(size["w"] - size["h"]) <= 1, "球が丸いまま", size)

    # ============================================================
    section("3. 取り消しができる")
    before = pg.locator(".tb-ball").count()
    check(before == 3, "3個置いてある", before)

    # どけたら戻せる
    pg.click('.tb-ball[data-ball="9"]')
    pg.wait_for_timeout(250)
    check(pg.locator(".tb-ball").count() == 2, "タップでどけられる")
    check(not pg.is_disabled("#layoutUndoBtn"), "どけた直後は取り消せる")
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(250)
    check(pg.locator(".tb-ball").count() == 3, "取り消すと戻る")
    check(pg.locator('.tb-ball[data-ball="9"]').count() == 1, "戻ったのは9番")

    # 全部どけても戻せる
    pg.click("#layoutClearBtn")
    pg.wait_for_timeout(250)
    check(pg.locator(".tb-ball").count() == 0, "全部どけられる")
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(250)
    check(pg.locator(".tb-ball").count() == 3, "全部どけたのも取り消せる")

    # 動かしたのも戻せる
    ball = pg.locator('.tb-ball[data-ball="1"]')
    box = ball.bounding_box()
    pos_before = pg.evaluate(
        """() => document.querySelector('.tb-ball[data-ball="1"]').style.left"""
    )
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(box["x"] + 60, box["y"] + 40, steps=8)
    pg.mouse.up()
    pg.wait_for_timeout(250)
    pos_after = pg.evaluate(
        """() => document.querySelector('.tb-ball[data-ball="1"]').style.left"""
    )
    check(pos_before != pos_after, "指で動かせる", (pos_before, pos_after))
    check(pg.locator(".tb-ball").count() == 3, "動かしても消えない")
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(250)
    pos_undo = pg.evaluate(
        """() => document.querySelector('.tb-ball[data-ball="1"]').style.left"""
    )
    check(pos_undo == pos_before, "動かしたのも取り消せる", (pos_before, pos_undo))

    # 取り消しは1手だけでなく直近30手ぶん控えるようにした（本人の指示 2026-08-20）。
    # 1回戻しただけではまだ戻れる。「一つ次に進む」で戻し過ぎを取り返せる
    check(not pg.is_disabled("#layoutUndoBtn"), "1回戻したあともまだ前に戻れる")
    check(not pg.is_disabled("#layoutRedoBtn"), "戻したあとは「一つ次に進む」が押せる")
    # 戻せるものが無くなるまで押すと、そこで押せなくなる
    for _ in range(30):
        if pg.is_disabled("#layoutUndoBtn"):
            break
        pg.click("#layoutUndoBtn")
        pg.wait_for_timeout(60)
    check(pg.is_disabled("#layoutUndoBtn"), "全部戻しきると押せなくなる")

    check(not errs, "JavaScriptエラーが出ていない", errs[:3])
    b.close()

ng = [r for r in results if not r[0]]
print("\n============================================")
print("成功: %d / 失敗: %d" % (len(results) - len(ng), len(ng)))
if ng:
    print("【失敗した項目】")
    for _, label, detail in ng:
        print("  - " + label + (("  -> " + str(detail)) if detail else ""))
    sys.exit(1)
print("すべて成功")
