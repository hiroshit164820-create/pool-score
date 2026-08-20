# -*- coding: utf-8 -*-
"""kailun_test.py — カイルンの検証（本人指示14）

カイルンは NBA 競技規程に章が無いハウスゲーム。
店ごとに決め方が違う2点（rules_data.js の unverified）は
勝手に決めず、試合開始前に選ばせる方針で作っている。

対象:
  1. 種目一覧に出る（ハウスゲームのカテゴリ）
  2. 公式規程が無いことを案内する
  3. ハウス設定を選べる（ミス時のリセット／1手番の得点数／反則の付け方）
  4. 3段階を進めて1点になる
  5. 選んだハウス設定が実際の記録に効く
  6. 取り消しできる

実行: python _test/kailun_test.py
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


def section(name):
    print("\n-- " + name + " --")


def stage(pg):
    return (pg.text_content(".step-head .sp-target") or "").strip()


def who(pg):
    return (pg.text_content(".step-head .sp-who") or "").strip()


def setup(pg, one_point=False, penalty_other=False, no_reset=False, goal=3):
    """ハウス設定を選んでから試合を始める"""
    pg.goto(URL)
    pg.wait_for_timeout(500)
    helpers.pick_game(pg, "kailun")
    pg.wait_for_timeout(400)
    if one_point:
        pg.click('#houseRuleArea .field:has(label:text-is("1回の手番で")) .chip:text-is("1点まで")')
        pg.wait_for_timeout(250)
    if no_reset:
        pg.click('#houseRuleArea .field:has(label:text-is("ミスしたとき")) '
                 '.chip:text-is("続きから（段階を保つ）")')
        pg.wait_for_timeout(250)
    if penalty_other:
        pg.click('#houseRuleArea .field:has(label:text-is("反則のとき")) .chip:text-is("相手が1点増える")')
        pg.wait_for_timeout(250)
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    helpers.set_goal(pg, goal)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 375, "height": 667})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("1. 種目一覧に出る")
    labels = helpers.all_game_labels(pg)
    check("カイルン" in labels, "種目一覧にカイルンがある", labels)

    # 公式種目と混ぜない（規程の有無が違うため）
    groups = pg.locator(".group-head .gh-label").all_text_contents()
    check(any("ハウス" in g for g in groups), "ハウスゲームのカテゴリに入っている", groups)

    # ================================================================
    section("2. 規程が無い前提のハウス設定が出る")
    helpers.pick_game(pg, "kailun")
    pg.wait_for_timeout(400)
    # ルール説明は本人指示（2026-08-20）で削除した。案内文の代わりに、
    # 店ごとに決める設定そのものが出ていることを確認する。
    check(pg.locator("#gameNote").count() == 0, "ルール説明は表示しない")
    kd = pg.evaluate(
        "() => { const b = BASE_RULES[GAMES['kailun'].base];"
        " return { balls: b.balls, steps: b.steps, carom: b.isCarom }; }"
    )
    check(kd["carom"] is True, "カイルンは当てて進めるゲームのまま", kd)
    check(kd["balls"] == [1, 3, 11], "当てる球は1・3・11番のまま", kd["balls"])

    # ================================================================
    section("3. ハウス設定を選べる")
    check(not pg.locator("#houseRuleSection").is_hidden(), "ハウス設定の欄が出る")
    house = pg.text_content("#houseRuleArea") or ""
    check("ミスしたとき" in house, "ミス時の扱いを選べる", house[:60])
    check("1回の手番で" in house, "1手番の得点数を選べる", house[:60])
    check("反則のとき" in house, "反則の付け方を選べる", house[:60])

    # 他の種目では出さない
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(350)
    check(pg.locator("#houseRuleSection").is_hidden(), "公式種目ではハウス設定を出さない")

    # ================================================================
    section("4. 3段階を進めて1点")
    setup(pg)
    check(pg.is_visible("#stepPad"), "段階の入力が出る")
    check(not pg.is_visible("#ballGrid"), "球の盤面は出さない")
    check(pg.is_disabled("#panelA"), "スコアのタップは使わない（段階で入力するため）")
    check(stage(pg) == "1 / 3段目", "最初は1段目", stage(pg))

    pg.click(".step-btn.ok")
    pg.wait_for_timeout(400)
    check(stage(pg) == "2 / 3段目", "成功で2段目へ", stage(pg))
    check(pg.text_content("#scoreA") == "0", "途中では点にならない", pg.text_content("#scoreA"))

    pg.click(".step-btn.ok")
    pg.wait_for_timeout(400)
    check(stage(pg) == "3 / 3段目", "3段目へ", stage(pg))

    pg.click(".step-btn.ok")
    pg.wait_for_timeout(450)
    check(pg.text_content("#scoreA") == "1", "3段目を成功で1点", pg.text_content("#scoreA"))
    check(stage(pg) == "1 / 3段目", "点が入ると1段目へ戻る", stage(pg))
    pg.screenshot(path=os.path.join(SHOTS, "kailun_match.png"))

    # ================================================================
    section("5-1. ハウス設定「1点まで」")
    setup(pg, one_point=True)
    for _ in range(3):
        pg.click(".step-btn.ok")
        pg.wait_for_timeout(350)
    check(pg.text_content("#scoreA") == "1", "1点入る", pg.text_content("#scoreA"))
    check(who(pg) == "佐藤", "1点取ったら相手に交代する", who(pg))

    section("5-2. ハウス設定「何点でも取れる」（既定）")
    setup(pg)
    for _ in range(3):
        pg.click(".step-btn.ok")
        pg.wait_for_timeout(350)
    check(who(pg) == "山田", "1点取っても続けて撞ける", who(pg))

    section("5-3. ハウス設定「ミスで最初から」（既定）")
    setup(pg)
    pg.click(".step-btn.ok")
    pg.wait_for_timeout(350)
    check(stage(pg) == "2 / 3段目", "2段目まで進む", stage(pg))
    pg.click(".step-btn.miss")
    pg.wait_for_timeout(450)
    pg.click(".step-btn.miss")  # 相手もミスして戻す
    pg.wait_for_timeout(450)
    check(stage(pg) == "1 / 3段目", "ミスすると1段目に戻る", stage(pg))

    section("5-4. ハウス設定「ミスでも続きから」")
    setup(pg, no_reset=True)
    pg.click(".step-btn.ok")
    pg.wait_for_timeout(350)
    pg.click(".step-btn.miss")
    pg.wait_for_timeout(450)
    pg.click(".step-btn.miss")
    pg.wait_for_timeout(450)
    check(stage(pg) == "2 / 3段目", "ミスしても段階が残る", stage(pg))

    section("5-5. ハウス設定「反則で自分が1点減る」（既定）")
    setup(pg)
    pg.click(".step-btn.penalty")
    pg.wait_for_timeout(500)
    check(pg.text_content("#scoreA") == "-1", "自分が1点減る", pg.text_content("#scoreA"))
    check(pg.text_content("#scoreB") == "0", "相手は変わらない", pg.text_content("#scoreB"))

    section("5-6. ハウス設定「反則で相手が1点増える」")
    setup(pg, penalty_other=True)
    pg.click(".step-btn.penalty")
    pg.wait_for_timeout(500)
    check(pg.text_content("#scoreB") == "1", "相手が1点増える", pg.text_content("#scoreB"))
    check(pg.text_content("#scoreA") == "0", "自分は減らない", pg.text_content("#scoreA"))

    # ================================================================
    section("6. 取り消しできる")
    setup(pg)
    pg.click(".step-btn.ok")
    pg.wait_for_timeout(400)
    check(stage(pg) == "2 / 3段目", "2段目まで進む", stage(pg))
    pg.click("#undoBtn")
    pg.wait_for_timeout(450)
    check(stage(pg) == "1 / 3段目", "取り消しで1段目に戻る", stage(pg))

    # ================================================================
    section("7. 設定が試合に保存される")
    setup(pg, one_point=True, penalty_other=True, no_reset=True)
    opts = pg.evaluate("""() => {
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
      return { step: m.options.stepResetOnMiss, multi: m.options.allowMultiScorePerInning,
               penalty: m.options.penaltyMode };
    }""")
    check(opts["step"] is False, "ミスでリセットしない設定が残る", opts)
    check(opts["multi"] is False, "1点までの設定が残る", opts)
    check(opts["penalty"] == "othersPlus", "反則の設定が残る", opts)

    real = [e for e in errs if "favicon" not in e.lower()]
    check(len(real) == 0, "JavaScriptエラーが出ていない", real[:3])
    b.close()

print("\n" + "=" * 44)
ok = sum(1 for r in results if r[0])
ng = len(results) - ok
print("成功: %d / 失敗: %d" % (ok, ng))
if ng:
    print("\n【失敗した項目】")
    for good, label, detail in results:
        if not good:
            print("  - " + label + (("  -> " + str(detail)) if detail else ""))
    sys.exit(1)
else:
    print("すべて成功")
