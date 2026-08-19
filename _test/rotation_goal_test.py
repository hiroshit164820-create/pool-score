# -*- coding: utf-8 -*-
"""rotation_goal_test.py — 勝利条件UIとローテーションの検証

対象:
  1. 勝利条件は3〜7先がボタン、それ以外はプルダウン
  2. ハンデなしのときは左右別の入力もボールハンデも出さない
  3. ローテーションが選べて、盤面から得点を記録できる

実行: python _test/rotation_goal_test.py
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
    print("\n── " + name + " ──")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("① 勝利条件は3〜7先のボタン＋プルダウン")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)

    chips = pg.locator("#goalArea .goal-picker .chip").all_text_contents()
    check(chips == ["3先", "4先", "5先", "6先", "7先"],
          "3〜7先がボタンで並ぶ", chips)
    check(pg.locator("#goalArea .goal-picker select.goal-more").count() == 1,
          "それ以外を選ぶプルダウンがある")

    # ボタンで選べる
    helpers.set_goal(pg, 4)
    check(helpers.goal_value(pg) == 4, "4先を押すと4になる", helpers.goal_value(pg))
    helpers.set_goal(pg, 7)
    check(helpers.goal_value(pg) == 7, "7先も押せる", helpers.goal_value(pg))

    # プルダウンで8先以上を選べる
    opts = pg.locator("#goalArea .goal-picker select.goal-more option").all_text_contents()
    check(any("10ラック先取" in o for o in opts), "プルダウンに10先がある", opts[:6])
    check(any("2ラック先取" in o for o in opts),
          "ハンデ用に2先も選べる（ボタンは3先からのため）", opts[:6])

    helpers.set_goal(pg, 10)
    check(helpers.goal_value(pg) == 10, "プルダウンで10先を選べる", helpers.goal_value(pg))
    # プルダウンで選んだあとはボタンの押下状態が外れる
    pressed = pg.locator('#goalArea .goal-picker .chip[aria-pressed="true"]').count()
    check(pressed == 0, "プルダウンで選ぶとボタンの選択は外れる", pressed)

    # ================================================================
    section("② ハンデなしのときは余計な入力を出さない")
    helpers.set_handicap_mode(pg, False)
    check(pg.locator("#goalArea .goal-picker").count() == 1,
          "勝利条件の入力は1つだけ", pg.locator("#goalArea .goal-picker").count())
    check(pg.locator("#ballHandicapSection").get_attribute("hidden") is not None,
          "ボールハンデの欄は出ない")

    helpers.set_handicap_mode(pg, True)
    check(pg.locator("#goalArea .goal-picker").count() == 2,
          "ハンデありにすると左右別に出る", pg.locator("#goalArea .goal-picker").count())
    check(pg.is_visible("#ballHandicapSection"), "ボールハンデも出る")

    # 左右別に違う値を選べる
    helpers.set_goal(pg, 5, side="A")
    helpers.set_goal(pg, 3, side="B")
    check(helpers.goal_value(pg, "A") == 5, "Aは5先", helpers.goal_value(pg, "A"))
    check(helpers.goal_value(pg, "B") == 3, "Bは3先", helpers.goal_value(pg, "B"))

    # ハンデなしに戻すと両方リセットされる
    helpers.set_handicap_mode(pg, False)
    check(pg.locator("#goalArea .goal-picker").count() == 1, "1つに戻る")
    pg.screenshot(path=os.path.join(SHOTS, "70_goal.png"), full_page=True)

    # ================================================================
    section("③ ローテーションが選べる")
    labels = helpers.all_game_labels(pg)
    check("ローテーション" in labels, "種目一覧にローテーションがある", labels)

    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(300)

    note = pg.text_content("#gameNote") or ""
    check("ラックをまたいで" in note, "ラック跨ぎの得点だと案内される", note)
    check("120点" in note, "1ラック120点だと分かる", note)

    # ブレイク方式は選べない（規程で決まっているため）
    bt_field = pg.locator("#breakTypeToggle").locator("xpath=ancestor::div[@class='field'][1]")
    check(bt_field.is_hidden(), "ブレイク方式の選択は出さない（規程で決まっているため）")

    # 目標点は決まった選択肢（120/180/240/300）から選ぶ。
    # 61点は公式規程に無いのでプリセットに入れない（04_種目ルール仕様.md）
    choices = pg.locator("#goalArea .goal-choices .chip").all_text_contents()
    choices = [c.strip() for c in choices]
    check(choices == ["120点", "180点", "240点", "300点"],
          "目標点は120/180/240/300から選ぶ", choices)
    check("61点" not in choices, "61点は選択肢に入れない（公式規程に無いため）", choices)
    goal_label = pg.text_content("#goalArea") or ""
    check("120点" in goal_label, "1ラック120点だと案内される", goal_label[:80])

    # 既定は120点（JAPA B級・女子級／CUESの記載と一致）
    pressed = pg.locator('#goalArea .goal-choices .chip[aria-pressed="true"]').all_text_contents()
    check([p.strip() for p in pressed] == ["120点"], "既定は120点", pressed)

    # 選び直せる
    pg.click('#goalArea .goal-choices .chip:text-is("180点")')
    pg.wait_for_timeout(200)
    pressed = pg.locator('#goalArea .goal-choices .chip[aria-pressed="true"]').all_text_contents()
    check([p.strip() for p in pressed] == ["180点"], "選び直すと切り替わる", pressed)
    pg.click('#goalArea .goal-choices .chip:text-is("120点")')
    pg.wait_for_timeout(200)

    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenMatch"), "試合が始まる")

    saved = pg.evaluate("""() => {
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
      return m.goal.targets;
    }""")
    check(saved["A"] == 120 and saved["B"] == 120, "決着点は選んだ120点", saved)

    # ================================================================
    section("④ 盤面から得点を記録できる")
    check(pg.is_visible("#ballGrid"), "盤面が出ている")
    balls = pg.locator("#ballGrid .ball-btn").count()
    check(balls == 15, "1〜15番のボタンが並ぶ", balls)

    # 盤面が縦を使うので、スコアが画面外に押し出されていないこと。
    # 台の脇で使う道具なので「点数が見えない」は致命的
    vis = pg.evaluate("""() => {
      const out = {};
      ['#panelA', '#panelB', '#scoreA', '#scoreB'].forEach(sel => {
        const r = document.querySelector(sel).getBoundingClientRect();
        out[sel] = r.top >= 0 && r.bottom <= innerHeight && r.height > 0;
      });
      return out;
    }""")
    check(all(vis.values()), "盤面を出してもスコアが画面内に収まっている", vis)

    who = pg.text_content("#ballGrid .bg-who") or ""
    check("山田" in who, "誰が撞いているか分かる", who)

    # スコアのタップは使わない（盤面で入力するため）
    check(pg.is_disabled("#panelA"), "スコアのタップは無効になっている")
    check(pg.is_disabled("#panelB"), "スコアのタップは無効になっている（B）")

    # 球番号がそのまま得点になる
    pg.click('#ballGrid .ball-btn[data-ball="5"]')
    pg.wait_for_timeout(400)
    check(pg.text_content("#scoreA") == "5", "5番を入れると5点", pg.text_content("#scoreA"))

    pg.click('#ballGrid .ball-btn[data-ball="12"]')
    pg.wait_for_timeout(400)
    check(pg.text_content("#scoreA") == "17", "12番を足して17点", pg.text_content("#scoreA"))

    # 入った球は押せなくなる
    cls5 = pg.get_attribute('#ballGrid .ball-btn[data-ball="5"]', "class") or ""
    check("gone" in cls5, "入った球は消える")
    check(pg.is_disabled('#ballGrid .ball-btn[data-ball="5"]'), "入った球は押せない")
    check(not pg.is_disabled('#ballGrid .ball-btn[data-ball="1"]'), "残っている球は押せる")

    # ターンを渡すと、次に押した球は相手の得点になる
    pg.click("#turnBtn")
    pg.wait_for_timeout(400)
    who2 = pg.text_content("#ballGrid .bg-who") or ""
    check("佐藤" in who2, "交代すると撞く人が変わる", who2)
    pg.click('#ballGrid .ball-btn[data-ball="3"]')
    pg.wait_for_timeout(400)
    check(pg.text_content("#scoreB") == "3", "交代後は相手の得点になる", pg.text_content("#scoreB"))
    check(pg.text_content("#scoreA") == "17", "先に撞いた側の点は変わらない",
          pg.text_content("#scoreA"))

    # 取り消せる
    pg.click("#undoBtn")
    pg.wait_for_timeout(400)
    check(pg.text_content("#scoreB") == "0", "取り消しで戻る", pg.text_content("#scoreB"))
    check(not pg.is_disabled('#ballGrid .ball-btn[data-ball="3"]'), "取り消した球は盤面に戻る")

    pg.screenshot(path=os.path.join(SHOTS, "71_rotation.png"), full_page=False)

    # ================================================================
    section("⑤ ローテーションの決着（120点・ラックをまたぐ）")
    # 1ラックは合計120点。目標も120点なので、
    # 「1ラック取り切っても、途中で相手に取られた点があれば決着しない」ことを見る。
    # ここまでで A=17点 / B=0点。残りの球（合計103点）を全部Aが入れれば120点になる
    # いまAの番になるまで交代する（直前の取り消しで番が変わっているため）
    for _ in range(3):
        cur = pg.evaluate("() => document.querySelector('.score-panel.is-turn')?.id || ''")
        if cur == "panelA":
            break
        pg.click("#turnBtn")
        pg.wait_for_timeout(300)
    check(pg.evaluate("() => document.querySelector('.score-panel.is-turn')?.id || ''") == "panelA",
          "Aの番になっている")

    for n in [1, 2, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15]:
        btn = pg.locator('#ballGrid .ball-btn[data-ball="%d"]' % n)
        if btn.count() and not btn.is_disabled():
            btn.click()
            pg.wait_for_timeout(150)
        if pg.is_visible("#finishModal"):
            break

    score = int(pg.text_content("#scoreA") or "0")
    check(score >= 61, "61点を超えても続く（61点では決着しない）", score)
    ended_at_61 = pg.is_visible("#finishModal") and score < 120
    check(not ended_at_61, "61点で終了の確認は出ない", score)
    if score >= 120:
        check(pg.is_visible("#finishModal"), "120点に届いたら終了の確認が出る", score)

    # ================================================================
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
