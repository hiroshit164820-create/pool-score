# -*- coding: utf-8 -*-
"""money_ui_test.py — 5-9 / 5-10 の画面（本人指示4・2026-08-20）

指示: 「種目選択のハウスゲームに5-9と5-10を追加。
       これも各個人にハンデボールをふれるように」

ルールは本人からの聞き取り（公式競技規程は存在しない）:
  5番=1点 / 9番(10番)=2点 / ハンデボール=1点
  サイドポケットは倍、マスワリはそのラックの得点すべてが倍、
  重なれば4倍。3人以上なら全員からもらう。総得点で勝敗。

確認する内容:
  1. ハウスゲームに5-9と5-10が出る
  2. 準備画面で人を増やせる／ハンデ球を人ごとに割り当てられる
  3. 2人でゼロサムに動く
  4. サイドポケットで倍
  5. 3人なら全員からもらう
  6. ハンデ球は本人だけ得点する
  7. 取り消しができる
  8. 5-10は10番が2点

実行: python _test/money_ui_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
sys.path.insert(0, os.path.join(ROOT, "_test"))
import helpers

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def scores(pg):
    """持ち点を {名前: 点} で返す"""
    return pg.evaluate("""() => {
      const out = {};
      document.querySelectorAll('.money-score').forEach(c => {
        const n = c.querySelector('.ms-name').textContent.trim();
        out[n] = parseInt(c.querySelector('.ms-val').textContent.replace('+',''), 10);
      });
      return out;
    }""")


def pick_shooter(pg, name):
    pg.click('.money-pick:text-is("%s")' % name)
    pg.wait_for_timeout(200)


def drop(pg, ball, side=False):
    if side:
        pg.check("#moneySideChk")
        pg.wait_for_timeout(120)
    pg.click('.money-ball[data-ball="%s"]' % ball)
    pg.wait_for_timeout(250)


def set_names(pg, names):
    """準備画面で名前を入れる。足りなければ人を足す"""
    while pg.locator(".money-player-row").count() < len(names):
        pg.click("#moneyAddBtn")
        pg.wait_for_timeout(200)
    for i, nm in enumerate(names):
        pg.locator(".money-name").nth(i).fill(nm)
        pg.wait_for_timeout(100)


def open_game(pg, label):
    """種目選択からハウスゲームを開く"""
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.open_group(pg, "house")
    pg.wait_for_timeout(300)
    pg.click('.game-pick:has(.gp-name:text-is("%s"))' % label)
    pg.wait_for_timeout(500)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 375, "height": 667})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
    # マスワリの確認はプロンプトで聞く。既定は「いない」
    pg.on("dialog", lambda d: d.accept(getattr(pg, "_answer", "")))

    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ============================================================
    section("1. ハウスゲームに5-9と5-10が出る")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.open_group(pg, "house")
    pg.wait_for_timeout(300)
    labels = pg.evaluate("""() => Array.from(document.querySelectorAll('.gp-name'))
      .map(e => e.textContent.trim())""")
    check("5-9" in labels, "5-9がある", labels)
    check("5-10" in labels, "5-10がある", labels)
    check("カイルン" in labels, "カイルンも残っている", labels)

    # ============================================================
    section("2. 準備画面で人とハンデを決められる")
    pg.click('.game-pick:has(.gp-name:text-is("5-9"))')
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenMoneySetup"), "5-9の準備画面が開く")
    check(pg.locator(".money-player-row").count() == 2, "はじめは2人",
          pg.locator(".money-player-row").count())

    pg.click("#moneyAddBtn")
    pg.wait_for_timeout(250)
    check(pg.locator(".money-player-row").count() == 3, "人を増やせる")

    # ハンデ球の欄が人数ぶん出る
    check(pg.locator(".money-hc").count() == 3, "ハンデ欄が人数ぶん出る",
          pg.locator(".money-hc").count())
    # 5番と9番はハンデにできない（全員の得点球のため）
    chips = pg.evaluate("""() => Array.from(
      document.querySelectorAll('.money-hc')[0].querySelectorAll('.chip'))
      .map(c => c.textContent.trim())""")
    check("5" not in chips, "5番はハンデに選べない", chips)
    check("9" not in chips, "9番はハンデに選べない", chips)

    # ============================================================
    section("3. 2人でゼロサムに動く")
    # 3人目を消して2人に戻す
    pg.locator(".money-player-row").nth(2).locator("button").click()
    pg.wait_for_timeout(250)
    set_names(pg, ["あ", "い"])
    pg.click("#moneyStartBtn")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenMoneyMatch"), "試合画面が開く")

    pick_shooter(pg, "あ")
    drop(pg, 9)
    sc = scores(pg)
    check(sc.get("あ") == 2, "9番コーナーで+2", sc)
    check(sc.get("い") == -2, "相手は-2", sc)
    check(sc.get("あ") + sc.get("い") == 0, "合計は0（ゼロサム）", sc)

    drop(pg, 5)
    sc = scores(pg)
    check(sc.get("あ") == 3, "5番で+1され合計+3", sc)

    # ============================================================
    section("4. サイドポケットは倍")
    drop(pg, 9, side=True)
    sc = scores(pg)
    check(sc.get("あ") == 7, "9番サイドは4点入って+7", sc)
    # サイドの印は毎回戻る（倍が続かない）
    check(not pg.is_checked("#moneySideChk"), "サイドの印は1回で戻る")

    # ============================================================
    section("5. 取り消しができる")
    pg.click("#moneyUndoBtn")
    pg.wait_for_timeout(300)
    sc = scores(pg)
    check(sc.get("あ") == 3, "取り消すと元に戻る", sc)

    # ============================================================
    section("6. ハンデ球は本人だけ得点する")
    pg.click("#moneyQuitBtn")
    pg.wait_for_timeout(400)
    open_game(pg, "5-9")
    set_names(pg, ["あ", "い"])
    # 「あ」に7番を割り当てる
    pg.locator(".money-hc").nth(0).locator('.chip:text-is("7")').click()
    pg.wait_for_timeout(250)
    # 同じ球は相手側で選べない
    dis = pg.locator(".money-hc").nth(1).locator('.chip:text-is("7")').is_disabled()
    check(dis, "同じ球を2人で持てない")
    pg.click("#moneyStartBtn")
    pg.wait_for_timeout(500)

    # 「あ」の球には7番が出る
    pick_shooter(pg, "あ")
    balls_a = pg.evaluate("""() => Array.from(document.querySelectorAll('.money-ball'))
      .map(b => b.dataset.ball)""")
    check("7" in balls_a, "ハンデを持つ人には7番が出る", balls_a)
    drop(pg, 7)
    sc = scores(pg)
    check(sc.get("あ") == 1, "ハンデ球で+1", sc)

    # 「い」には7番が出ない（持っていないので得点にならない）
    pick_shooter(pg, "い")
    balls_b = pg.evaluate("""() => Array.from(document.querySelectorAll('.money-ball'))
      .map(b => b.dataset.ball)""")
    check("7" not in balls_b, "持っていない人には7番が出ない", balls_b)

    # ============================================================
    section("7. 3人なら全員からもらう")
    pg.click("#moneyQuitBtn")
    pg.wait_for_timeout(400)
    open_game(pg, "5-9")
    set_names(pg, ["あ", "い", "う"])
    pg.click("#moneyStartBtn")
    pg.wait_for_timeout(500)
    check(pg.locator(".money-score").count() == 3, "持ち点が3人ぶん出る")

    pick_shooter(pg, "あ")
    drop(pg, 9)
    sc = scores(pg)
    check(sc.get("あ") == 4, "9番=2点を2人からもらって+4", sc)
    check(sc.get("い") == -2 and sc.get("う") == -2, "ほかの2人は-2ずつ", sc)
    check(sc.get("あ") + sc.get("い") + sc.get("う") == 0, "合計は0", sc)

    # ============================================================
    section("8. マスワリはそのラックの得点が倍")
    pg._answer = "あ"  # プロンプトに「あ」と答える
    pg.click("#moneyRackBtn")
    pg.wait_for_timeout(400)
    sc = scores(pg)
    check(sc.get("あ") == 8, "マスワリで倍（4→8）", sc)
    pg._answer = ""

    # ============================================================
    section("9. 5-10は10番が2点")
    pg.click("#moneyQuitBtn")
    pg.wait_for_timeout(400)
    open_game(pg, "5-10")
    check(pg.is_visible("#screenMoneySetup"), "5-10の準備画面が開く")
    check("5-10" in (pg.text_content("#moneySetupTitle") or ""), "見出しが5-10")
    set_names(pg, ["あ", "い"])
    pg.click("#moneyStartBtn")
    pg.wait_for_timeout(500)
    pick_shooter(pg, "あ")
    balls = pg.evaluate("""() => Array.from(document.querySelectorAll('.money-ball'))
      .map(b => b.dataset.ball)""")
    check(balls == ["5", "10"], "5番と10番が出る（9番は出ない）", balls)
    drop(pg, 10)
    sc = scores(pg)
    check(sc.get("あ") == 2, "10番で+2", sc)

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
