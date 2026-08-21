# -*- coding: utf-8 -*-
"""setup2_test.py — 設定画面の指示8件の検証（2026-08-20）

対象:
  1. 種目の開閉式カードがすべて閉じた状態で始まる
  2. 名前なしで始めた側はゲスト扱い（選手一覧に残さない）
  3. 9/10ボールともボールハンデで7番以上を選べる
  4. 「この内容で始める」の直前にまとめカードが1行1項目で出る
  5. 8ボールに1ボールハンデがある
  6. チタニウムが消えている
  7. ボウラードに勝利条件が出ない
  8. JPAはブレイク方式を選ばせない

実行: python _test/setup2_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOTS, exist_ok=True)

results = []
def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label + (("  -> " + str(detail)) if detail and not cond else ""))

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(500)
    # 起動して最初に出るのはホーム（本人の指示 2026-08-22）
    helpers.goto_setup(pg)

    print("\n-- 1. カテゴリが全部閉じている --")
    opened = pg.eval_on_selector_all(".group-head", "els => els.map(e => e.getAttribute('aria-expanded'))")
    check(all(v == "false" for v in opened), "すべての種目カードが閉じている", opened)
    check(pg.eval_on_selector_all(".group-body", "e => e.length") == 0, "開いている中身が無い")
    check(len(opened) == 3, "カテゴリは3つ", opened)

    print("\n-- 4. まとめカード --")
    check(pg.is_visible("#startSummary"), "まとめカードが出ている")
    rows = pg.eval_on_selector_all("#startSummary .ss-row",
        "els => els.map(e => e.querySelector('.ss-key').textContent + e.querySelector('.ss-val').textContent)")
    print("   " + " | ".join(rows))
    check(any(r.startswith("競技種目：") for r in rows), "競技種目の行がある", rows)
    check(any(r.startswith("勝利条件：") for r in rows), "勝利条件の行がある", rows)
    check(any("9ボール" in r for r in rows), "選んでいる種目が反映されている", rows)
    # 1行1項目であること（各行が縦に積まれている）
    tops = pg.eval_on_selector_all("#startSummary .ss-row", "els => els.map(e => Math.round(e.getBoundingClientRect().top))")
    check(len(set(tops)) == len(tops), "各項目が別々の行にある", tops)

    print("\n-- 3. 9/10ボールのハンデは7番以上から --")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(250)
    pg.click("#goalArea .toggle-group button[data-v='handicap']")
    pg.wait_for_timeout(250)
    chips9 = pg.eval_on_selector_all("#ballHandicapArea .bh-chips button", "els => els.map(e => e.textContent)")
    check("7番以上" in chips9, "9ボールで7番以上が選べる", chips9)
    helpers.pick_game(pg, "10ball")
    pg.wait_for_timeout(250)
    pg.click("#goalArea .toggle-group button[data-v='handicap']")
    pg.wait_for_timeout(250)
    chips10 = pg.eval_on_selector_all("#ballHandicapArea .bh-chips button", "els => els.map(e => e.textContent)")
    check("7番以上" in chips10, "10ボールで7番以上が選べる", chips10)
    check("9番以上" in chips10, "10ボールで9番以上も残っている", chips10)

    print("\n-- 5. 8ボールの1ボールハンデ --")
    helpers.pick_game(pg, "8ball")
    pg.wait_for_timeout(250)
    pg.click("#goalArea .toggle-group button[data-v='handicap']")
    pg.wait_for_timeout(250)
    chips8 = pg.eval_on_selector_all("#ballHandicapArea .bh-chips button", "els => els.map(e => e.textContent)")
    check("1ボールハンデ" in chips8, "1ボールハンデがある", chips8)
    check("7番以上" not in chips8, "8ボールに「N番以上」は出さない", chips8)
    pg.click("#ballHandicapArea .bh-chips button:has-text('1ボールハンデ')")
    pg.wait_for_timeout(300)
    srows = pg.eval_on_selector_all("#startSummary .ss-row", "els => els.map(e => e.textContent)")
    check(any("1ボールハンデ" in r for r in srows), "まとめにハンデが出る", srows)
    goal_row = [r for r in srows if r.startswith("勝利条件")]
    check(goal_row and "ラック" in goal_row[0] and "点" not in goal_row[0],
          "1ボールハンデでも勝利条件はラックのまま（点数制に変わらない）", goal_row)

    print("\n-- 7. ボウラードに勝利条件が無い --")
    helpers.pick_game(pg, "bowlard")
    pg.wait_for_timeout(300)
    check(pg.eval_on_selector("#goalTitle", "e => e.hidden"), "「勝利条件」の見出しが消えている")
    check(pg.eval_on_selector("#goalArea", "e => e.hidden"), "勝利条件の中身も消えている")
    srows = pg.eval_on_selector_all("#startSummary .ss-row", "els => els.map(e => e.textContent)")
    check(not any(r.startswith("勝利条件") for r in srows), "まとめにも勝利条件が出ない", srows)

    print("\n-- 8. JPAはブレイク方式を選ばせない --")
    for gid in ["jpa_9ball", "jpa_8ball"]:
        helpers.pick_game(pg, gid)
        pg.wait_for_timeout(300)
        hidden = pg.evaluate("() => document.getElementById('breakTypeToggle').closest('.field').hidden")
        check(hidden, gid + " でブレイク方式の欄が消えている")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(250)
    check(not pg.evaluate("() => document.getElementById('breakTypeToggle').closest('.field').hidden"),
          "一般の9ボールでは残っている（消しすぎていない）")

    print("\n-- 6. チタニウムが消えている --")
    sets = pg.evaluate("() => Object.keys(BALL_SETS)")
    check("titanium" not in sets, "BALL_SETSから消えた", sets)
    check("titanium" not in pg.evaluate("() => BALL_SET_ORDER"), "並び順からも消えた")
    check(pg.evaluate("() => ballAppearance('titanium', 1).base === ballAppearance('standard', 1).base"),
          "古い記録が titanium を指していても標準の色に倒れる")

    print("\n-- 2. 名前なしはゲスト（選手一覧に残さない） --")
    pg.evaluate("() => localStorage.removeItem('pool_players')")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)
    pg.fill("#inNameA", "タイラ")
    pg.fill("#inNameB", "")
    pg.wait_for_timeout(200)
    srows = pg.eval_on_selector_all("#startSummary .ss-row", "els => els.map(e => e.textContent)")
    check(any("タイラ 対 ゲスト" in r for r in srows), "まとめで相手がゲストと出る", srows)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    players = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_players') || '[]').map(p => p.name)")
    check(players == ["タイラ"], "登録されたのは名前を入れた人だけ", players)
    sides = pg.evaluate("""() => {
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
      return m.sides.map(s => ({name: s.name, guest: !!s.guest, ids: (s.playerIds||[]).length}));
    }""")
    check(sides[1]["guest"] is True, "B側にゲストの印が付いた", sides)
    check(sides[1]["ids"] == 0, "B側は選手IDを持たない", sides)
    pg.screenshot(path=os.path.join(SHOTS, "setup2.png"), full_page=True)

    print("\n-- JSエラー --")
    check(not errs, "ページのJSエラーなし", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
