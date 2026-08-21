# -*- coding: utf-8 -*-
"""layoutcard_test.py — 「保存した配置」をその場で開くカードに（本人の指示 2026-08-22）

本人の指摘:
  「配置ページで『保存した配置』を押すと、ひっそりと画面の外に表示されて
    気づきづらいので、その場でカードがぱっと開く形にして」

以前は台・球トレイ・操作ボタンの**すべて下**に一覧を伸ばす作りで、
上の帯のボタンを押しても画面の外（下）に開いていた。

対象:
  1. 押す前はカードが閉じている
  2. 押すとカードが開き、**押した時点で画面の中に見えている**
  3. 保存した配置の名前がカードの中に出る
  4. 「閉じる」で閉じる
  5. 背景（カードの外）を押しても閉じる
  6. 「呼び出す」を押すと自動で閉じ、台に配置が戻る
  7. 何も保存していないときは、その旨がカードに出る
  8. JSエラーが無い

実行: python _test/layoutcard_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
if not os.path.isdir(SHOTS):
    os.makedirs(SHOTS)

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def card_hidden(pg):
    return pg.locator("#layoutListModal").get_attribute("hidden") is not None


def in_viewport(pg, selector):
    """その要素が、いま見えている画面の中に収まっているか"""
    return pg.evaluate("""(sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const h = window.innerHeight, w = window.innerWidth;
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        vh: h,
        inside: r.top < h && r.bottom > 0 && r.left < w && r.right > 0,
        area: Math.round(r.width * r.height),
      };
    }""", selector)


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    section("1. 何も保存していないとき")
    pg.click("#tabLayout")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenLayout"), "配置の画面が開く")
    check(card_hidden(pg), "押す前はカードが閉じている")
    pg.click("#layoutListBtn")
    pg.wait_for_timeout(400)
    check(not card_hidden(pg), "押すとカードが開く")
    txt0 = pg.inner_text("#layoutList")
    check("まだありません" in txt0, "保存が無いことがカードに出る", txt0[:80])
    pg.click("#layoutListCloseBtn")
    pg.wait_for_timeout(300)
    check(card_hidden(pg), "「閉じる」で閉じる")

    section("2. 配置を1つ保存する")
    # 球を2つ置いて保存する
    pg.click("#ballTray .tray-ball >> nth=0")
    pg.wait_for_timeout(200)
    pg.click("#ballTray .tray-ball >> nth=1")
    pg.wait_for_timeout(200)
    balls = pg.eval_on_selector_all("#tableBalls .tb-ball", "e => e.length")
    check(balls == 2, "台に球が2つ乗る", balls)
    pg.once("dialog", lambda d: d.accept("テスト配置"))
    pg.click("#layoutSaveBtn")
    pg.wait_for_timeout(600)
    saved = pg.evaluate("() => STORE.listLayouts().length")
    check(saved == 1, "配置が1つ保存される", saved)

    section("3. 押すとその場で開き、画面の中に見えている")
    pg.click("#layoutListBtn")
    pg.wait_for_timeout(400)
    check(not card_hidden(pg), "カードが開く")
    box = in_viewport(pg, ".layout-list-modal")
    print("   " + str(box))
    check(box and box["inside"], "カードが画面の中にある", box)
    # 以前の作りは、押しても中身が画面のはるか下（スクロールしないと見えない）にあった。
    # 見出しが画面の高さの中に入っていることを、実際の座標で確かめる
    head = in_viewport(pg, ".layout-list-modal h2")
    print("   " + str(head))
    check(head and 0 <= head["top"] < head["vh"],
          "見出しがスクロールなしで見える位置にある", head)
    check(head and head["area"] > 0, "見出しに大きさがある（隠れていない）", head)
    listbox = in_viewport(pg, "#layoutList .layout-item")
    check(listbox and listbox["inside"], "1件目もスクロールなしで見える", listbox)
    txt = pg.inner_text("#layoutList")
    check("テスト配置" in txt, "保存した名前がカードに出る", txt[:80])
    pg.screenshot(path=os.path.join(SHOTS, "layout_card.png"), full_page=False)

    section("4. 背景を押すと閉じる")
    # カードの外（上のほう）を押す
    pg.mouse.click(195, 40)
    pg.wait_for_timeout(400)
    check(card_hidden(pg), "背景を押すと閉じる")

    section("5. 呼び出すと自動で閉じる")
    pg.click("#layoutClearBtn")
    pg.wait_for_timeout(400)
    check(pg.eval_on_selector_all("#tableBalls .tb-ball", "e => e.length") == 0,
          "いったん台を空にする")
    pg.click("#layoutListBtn")
    pg.wait_for_timeout(400)
    pg.locator("#layoutList button", has_text="呼び出す").first.click()
    pg.wait_for_timeout(600)
    check(card_hidden(pg), "呼び出すとカードが閉じる")
    back = pg.eval_on_selector_all("#tableBalls .tb-ball", "e => e.length")
    check(back == 2, "台に配置が戻る", back)

    section("6. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
