# -*- coding: utf-8 -*-
"""tune9_test.py — 成績の既定とプルダウンの色（本人の指示 2026-08-21・段階A）

対象:
  1. 成績タブを押すと、既定で「自分の成績」が開く
  2. 自分を登録していないときは、他選手の一覧が開く（今までどおり）
  3. 「他選手の成績」に切り替えれば一覧も見られる
  4. 勝利条件のプルダウンで「〇先」を選ぶと、そのプルダウンが金色になる
  5. ボタン（3先など）で選び直すと金色は消える
  6. ハンデありのときは、金色のまま枠だけ左右の色になる

実行: python _test/tune9_test.py
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

GOLD = "rgb(251, 208, 0)"
BLUE = "rgb(11, 99, 214)"
RED = "rgb(212, 59, 18)"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


SEL = """() => {
  const s = document.querySelector('#goalArea select.goal-more');
  if (!s) return null;
  const c = getComputedStyle(s);
  return {picked: s.classList.contains('is-picked'), bg: c.backgroundColor,
          border: c.borderTopColor, first: s.options[0].textContent};
}"""

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================= 2. 自分が未登録のとき =================
    section("1. 自分が未登録なら他選手の一覧")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    helpers.add_player(pg, "岸川")
    helpers.add_player(pg, "佐藤")
    pg.wait_for_timeout(300)
    pg.click("#tabStats")
    pg.wait_for_timeout(700)
    check(pg.locator("#statsBody .stats-card").count() == 2,
          "他選手の一覧が開く", pg.locator("#statsBody .stats-card").count())
    check(pg.locator("#statsBody .stats-head").count() == 0, "個人の成績ではない")

    # ================= 1. 自分を登録したあと =================
    section("2. 自分を登録すると既定が自分の成績になる")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    pg.click("#toggleSelfBtn")
    pg.wait_for_timeout(200)
    pg.fill("#newPlayerName", "たいら")
    pg.wait_for_timeout(120)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(400)
    pg.click("#tabHome")
    pg.wait_for_timeout(300)
    pg.click("#tabStats")
    pg.wait_for_timeout(800)
    head = pg.locator("#statsBody .stats-head")
    check(head.count() == 1, "個人の成績が開く", head.count())
    check("たいら" in (head.text_content() or ""), "開いているのは自分", head.text_content())
    sw = pg.eval_on_selector_all(".stats-switch button",
                                 "e => e.map(x => x.getAttribute('aria-pressed'))")
    check(sw == ["true", "false"], "「自分の成績」が押された状態", sw)

    section("3. 他選手の一覧にも切り替えられる")
    pg.locator(".stats-switch button", has_text="他選手の成績").click()
    pg.wait_for_timeout(600)
    check(pg.locator("#statsBody .stats-card").count() == 2, "一覧に切り替わる")
    pg.click("#tabHome")
    pg.wait_for_timeout(300)
    pg.click("#tabStats")
    pg.wait_for_timeout(700)
    check(pg.locator("#statsBody .stats-head").count() == 1,
          "タブを押し直すとまた自分の成績に戻る")

    # ================= 4〜5. プルダウンの色 =================
    section("4. プルダウンで選ぶと金色になる")
    pg.click("#tabSetup")
    pg.wait_for_timeout(500)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(600)
    before = pg.evaluate(SEL)
    print("   " + str(before))
    check(before and not before["picked"], "ボタンで選んでいる間は金色でない", before)
    check(before and before["bg"] != GOLD, "地は白のまま", before)

    # プルダウンから「9先」を選ぶ
    pg.select_option("#goalArea select.goal-more", label="9ラック先取")
    pg.wait_for_timeout(600)
    after = pg.evaluate(SEL)
    print("   " + str(after))
    check(after and after["picked"], "is-picked が付く", after)
    check(after and after["bg"] == GOLD, "プルダウンが金色になる", after)
    check(after and "選択中" in after["first"], "先頭に「選択中」が出る", after)
    pg.screenshot(path=os.path.join(SHOTS, "tune9_goal.png"), full_page=True)

    section("5. ボタンで選び直すと金色が消える")
    pg.locator("#goalArea .chip", has_text="5先").first.click()
    pg.wait_for_timeout(600)
    back = pg.evaluate(SEL)
    check(back and not back["picked"], "金色が消える", back)
    check(back and back["bg"] != GOLD, "地が白に戻る", back)

    section("6. ハンデありでも金色。枠は左右の色")
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "岸川")
    pg.wait_for_timeout(200)
    helpers.set_handicap_mode(pg, True)
    pg.wait_for_timeout(600)
    sels = pg.eval_on_selector_all("#goalArea .field select.goal-more", "e => e.length")
    check(sels == 2, "左右に1つずつ出る", sels)
    pg.locator("#goalArea .field.side-a select.goal-more").select_option(label="9ラック先取")
    pg.wait_for_timeout(600)
    r = pg.evaluate("""() => {
      const a = document.querySelector('#goalArea .field.side-a select.goal-more');
      const b = document.querySelector('#goalArea .field.side-b select.goal-more');
      const g = e => ({picked: e.classList.contains('is-picked'),
                       bg: getComputedStyle(e).backgroundColor,
                       border: getComputedStyle(e).borderTopColor});
      return {a: g(a), b: g(b)};
    }""")
    print("   " + str(r))
    check(r["a"]["picked"] and r["a"]["bg"] == GOLD, "A側が金色", r["a"])
    check(r["a"]["border"] == BLUE, "A側の枠は青のまま", r["a"])
    check(not r["b"]["picked"], "B側は選んでいないので金色でない", r["b"])
    check(r["b"]["border"] == RED, "B側の枠は赤", r["b"])

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
