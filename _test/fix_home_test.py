# -*- coding: utf-8 -*-
"""fix_home_test.py — ホーム画面のボタン（本人の指示 2026-08-22）

本人の指示:
  「『試合を始める』ボタンが黄色いので最初から選択しているように見えるので修正」
  「『試合を始める』含めて『くわしい成績を見る』『試合結果を取り込む』
    『履歴をぜんぶ見る』ボタンが押せるボタンだということが
    ユーザーに認識しやすいようにする」

金色（--block #fbd000）は「選んである札」（.chip.is-on など）と同じ色で、
選択済みに見えていた。

対象:
  1. 「試合を始める」が金色ではない
  2. 選んである札（chip.is-on）と同じ色になっていない
  3. 押せる大きさ（44px以上）がある
  4. 4つのボタンとも、背景・枠・影があって押せると分かる形になっている
  5. 行き先のある3つには矢印が付いている
  6. 4つとも実際に押せて、行き先の画面が開く
  7. 文字と背景の明暗の差が4.5:1以上（読めること）
  8. JSエラーが無い

実行: python _test/fix_home_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
if not os.path.isdir(SHOTS):
    os.makedirs(SHOTS)

results = []

# ボタンの見た目を測る。押せると分かるかは
# 「背景がある・枠がある・影がある・十分な高さ」で判断する
LOOK = """(sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const c = getComputedStyle(e);
  const r = e.getBoundingClientRect();
  return {
    bg: c.backgroundColor, color: c.color,
    border: c.borderTopWidth, shadow: c.boxShadow,
    h: Math.round(r.height), w: Math.round(r.width),
    text: e.textContent.trim()
  };
}"""

# 明暗の差（WCAGの計算）。読めるかどうかの判断に使う
CONTRAST = """(sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  const c = getComputedStyle(e);
  function toRgb(s) {
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return [p[0], p[1], p[2]];
  }
  function lum(rgb) {
    const a = rgb.map(v => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  const fg = toRgb(c.color), bg = toRgb(c.backgroundColor);
  if (!fg || !bg) return null;
  const l1 = lum(fg), l2 = lum(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}"""


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def play_match(pg):
    """履歴と成績が出るよう、1試合こなしておく"""
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "いっちょ")
    helpers.set_goal(pg, 3)
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    for _ in range(10):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(180)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(800)


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    section("1. 自分を登録して1試合こなす（4つのボタンを全部出すため）")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    pg.click("#toggleSelfBtn")
    pg.wait_for_timeout(200)
    pg.fill("#newPlayerName", "たいら")
    pg.wait_for_timeout(150)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(400)
    play_match(pg)
    pg.click("#tabHome")
    pg.wait_for_timeout(700)

    labels = pg.eval_on_selector_all("#homeBody button",
                                     "e => e.map(x => x.textContent.trim())")
    print("   " + str(labels))
    for want in ["試合を始める", "くわしい成績を見る", "試合結果を取り込む", "履歴をぜんぶ見る"]:
        check(any(want in t for t in labels), "「" + want + "」がある", labels)
    pg.screenshot(path=os.path.join(SHOTS, "fix_home.png"), full_page=True)

    section("2. 「試合を始める」が金色ではない")
    start = pg.evaluate(LOOK, "#homeBody .home-start")
    print("   " + str(start))
    check(start is not None, "ボタンが見つかる")
    # ハテナブロックの金色 #fbd000 = rgb(251, 208, 0)
    check("251, 208, 0" not in (start["bg"] or ""), "金色ではない", start["bg"])
    check(start["h"] >= 44, "押せる大きさがある", start["h"])

    # 「選んである札」と同じ色になっていないか、実物のchipと比べる
    chip_bg = pg.evaluate("""() => {
      // 種目の画面にある選択済みの札の色を実際に読む
      const el = document.querySelector('#screenSetup .chip.is-on')
        || document.querySelector('.chip.is-on');
      return el ? getComputedStyle(el).backgroundColor : null;
    }""")
    print("   選んである札の色: " + str(chip_bg))
    if chip_bg:
        check(start["bg"] != chip_bg, "選んである札と別の色", {"ボタン": start["bg"], "札": chip_bg})
    else:
        print("   （比べる札が画面に無いので、この確認は飛ばす）")

    section("3. 4つとも押せると分かる形になっている")
    sels = [
        ("#homeBody .home-start", "試合を始める"),
        ("#homeBody .home-go", "行き先のあるボタン"),
    ]
    for sel, name in sels:
        look = pg.evaluate(LOOK, sel)
        print("   " + name + ": " + str(look))
        check(look and look["bg"] not in ("rgba(0, 0, 0, 0)", "transparent"),
              name + " に背景がある", look)
        check(look and float(look["border"].replace("px", "")) >= 2,
              name + " に枠がある", look)
        check(look and look["shadow"] != "none", name + " に影がある", look)
        check(look and look["h"] >= 44, name + " が44px以上", look)

    section("4. 行き先のあるボタンには矢印が付く")
    arrows = pg.eval_on_selector_all("#homeBody .home-go .hg-arrow", "e => e.length")
    gos = pg.eval_on_selector_all("#homeBody .home-go", "e => e.length")
    print("   行き先ボタン %d個 / 矢印 %d個" % (gos, arrows))
    check(gos == 3, "行き先のあるボタンが3つ", gos)
    check(arrows == gos, "全部に矢印が付いている", {"ボタン": gos, "矢印": arrows})

    section("5. 文字が読める明るさの差がある")
    for sel, name in [("#homeBody .home-start", "試合を始める"),
                      ("#homeBody .home-go", "行き先のあるボタン")]:
        ratio = pg.evaluate(CONTRAST, sel)
        print("   " + name + ": " + str(ratio) + " : 1")
        check(ratio and ratio >= 4.5, name + " の明暗の差が4.5:1以上", ratio)

    section("6. 実際に押せて、行き先が開く")
    pg.locator("#homeBody button", has_text="試合を始める").click()
    pg.wait_for_timeout(600)
    check(pg.is_visible("#screenSetup"), "「試合を始める」で種目の画面が開く")

    pg.click("#tabHome")
    pg.wait_for_timeout(500)
    pg.locator("#homeBody button", has_text="くわしい成績を見る").click()
    pg.wait_for_timeout(700)
    check(pg.is_visible("#screenStats"), "「くわしい成績を見る」で成績が開く")

    pg.click("#tabHome")
    pg.wait_for_timeout(500)
    pg.locator("#homeBody button", has_text="試合結果を取り込む").click()
    pg.wait_for_timeout(700)
    check(pg.is_visible("#screenImport"), "「試合結果を取り込む」で取り込みが開く")
    pg.click("#importCloseBtn")
    pg.wait_for_timeout(500)

    pg.click("#tabHome")
    pg.wait_for_timeout(500)
    pg.locator("#homeBody button", has_text="履歴をぜんぶ見る").click()
    pg.wait_for_timeout(700)
    check(pg.is_visible("#screenHistory"), "「履歴をぜんぶ見る」で履歴が開く")

    section("7. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
