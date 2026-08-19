# -*- coding: utf-8 -*-
"""slice2_test.py — スライス2（先取点・マスワリ即記録）の検証

対象（本人指示16件のうち）:
  9.  マスワリ・ブレイクエースを押すとスコアが増える（予約式をやめる）
  10. ローテーションの目標点を120/180/240/300から選ぶ

実行: python _test/slice2_test.py
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


RACK_WINS = """() => {
  const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
  const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
  return m.events.filter(e => e.t === 'RACK_WIN' && !e.voided)
    .map(e => ({side: e.side, masuwari: !!e.d.masuwari, breakAce: !!e.d.breakAce}));
}"""

TARGETS = """() => {
  const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
  const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
  return m.goal.targets;
}"""

BREAKER = """() => {
  const a = document.getElementById('breakMarkA').textContent.trim();
  return a ? 'A' : 'B';
}"""


def start_9ball(pg, break_type=None, goal=5):
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    helpers.set_goal(pg, goal)
    if break_type:
        pg.click('#breakTypeToggle button[data-v="%s"]' % break_type)
        pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("指示10: ローテーションの目標点")
    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(300)
    choices = [c.strip() for c in pg.locator("#goalArea .goal-choices .chip").all_text_contents()]
    check(choices == ["120点", "180点", "240点", "300点"],
          "目標点は120/180/240/300から選ぶ", choices)
    check("61点" not in choices, "61点は入れない（公式規程に無いため）", choices)

    pressed = [c.strip() for c in
               pg.locator('#goalArea .goal-choices .chip[aria-pressed="true"]').all_text_contents()]
    check(pressed == ["120点"], "既定は120点（JAPA B級・女子級と一致）", pressed)

    pg.click('#goalArea .goal-choices .chip:text-is("240点")')
    pg.wait_for_timeout(250)
    pressed = [c.strip() for c in
               pg.locator('#goalArea .goal-choices .chip[aria-pressed="true"]').all_text_contents()]
    check(pressed == ["240点"], "選び直せる", pressed)

    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    t = pg.evaluate(TARGETS)
    check(t["A"] == 240 and t["B"] == 240, "選んだ240点が目標として保存される", t)
    pg.screenshot(path=os.path.join(SHOTS, "slice2_rotation_goal.png"))

    # 61点では終わらない（1ラック=120点なので、61点は途中でしかない）
    for n in range(1, 16):
        btn = pg.locator('#ballGrid .ball-btn[data-ball="%d"]' % n)
        if btn.count() and not btn.is_disabled():
            btn.click()
            pg.wait_for_timeout(70)
    score = int(pg.text_content("#scoreA") or "0")
    check(score >= 61, "1ラック取り切ると61点を超える", score)
    check(not pg.is_visible("#finishModal"), "61点や120点では終わらない（目標は240点）", score)

    # ================================================================
    section("指示9: マスワリを押すとスコアが増える")
    pg.evaluate("() => localStorage.clear()")
    pg.goto(URL)
    pg.wait_for_timeout(500)
    start_9ball(pg, break_type="winner")

    before = pg.text_content("#scoreA") + "-" + pg.text_content("#scoreB")
    check(before == "0-0", "開始時は0-0", before)

    # マスワリはブレイク権のある側のパネル内に出る（置き場所で誰の記録かを示す）
    breaker = pg.evaluate(BREAKER)
    check(pg.locator("#panelFlags" + breaker + " button").count() >= 1,
          "ブレイク側のパネル内にマスワリのボタンがある")
    other = "B" if breaker == "A" else "A"
    check(pg.locator("#panelFlags" + other).get_attribute("hidden") is not None,
          "ブレイク権の無い側には出さない")
    pg.click('#panelFlags' + breaker + ' button:text-is("マスワリ")')
    pg.wait_for_timeout(500)
    after = pg.text_content("#score" + breaker)
    check(after == "1", "押した時点でブレイク側のスコアが増える", after)

    wins = pg.evaluate(RACK_WINS)
    check(len(wins) == 1, "ラック取得が1回だけ記録される", wins)
    check(wins[0]["side"] == breaker, "ブレイクした側の取得になる", wins)
    check(wins[0]["masuwari"] is True, "マスワリとして記録される", wins)

    pg.click("#undoBtn")
    pg.wait_for_timeout(500)
    check(pg.text_content("#score" + breaker) == "0", "取り消しで元に戻る",
          pg.text_content("#score" + breaker))
    check(len(pg.evaluate(RACK_WINS)) == 0, "記録も消える")

    # ================================================================
    section("指示9: ブレイクエースも同じ")
    breaker = pg.evaluate(BREAKER)
    pg.click('#panelFlags' + breaker + ' button:text-is("ブレイクエース")')
    pg.wait_for_timeout(500)
    check(pg.text_content("#score" + breaker) == "1", "押した時点でスコアが増える",
          pg.text_content("#score" + breaker))
    wins = pg.evaluate(RACK_WINS)
    check(wins[0]["breakAce"] is True, "ブレイクエースとして記録される", wins)
    check(wins[0]["masuwari"] is False, "マスワリは立たない", wins)

    # ================================================================
    section("指示9: 交互ブレイクだと記録される側が入れ替わる")
    pg.evaluate("() => localStorage.clear()")
    pg.goto(URL)
    pg.wait_for_timeout(500)
    start_9ball(pg, break_type="alternate")
    for _ in range(4):
        if pg.is_visible("#finishModal"):
            break
        brk = pg.evaluate(BREAKER)
        pg.click('#panelFlags' + brk + ' button:text-is("マスワリ")')
        pg.wait_for_timeout(450)
    sides = [w["side"] for w in pg.evaluate(RACK_WINS)]
    check(sides == ["A", "B", "A", "B"], "交互ブレイクでは記録される側が入れ替わる", sides)
    check(pg.text_content("#scoreA") == "2" and pg.text_content("#scoreB") == "2",
          "スコアも2-2になる",
          pg.text_content("#scoreA") + "-" + pg.text_content("#scoreB"))

    # ================================================================
    section("セーフティは人ごとの回数カウント（ラック取得ではないため）")
    safety = pg.locator('.safety-btn')
    if safety.count():
        sa = pg.text_content("#scoreA")
        sb = pg.text_content("#scoreB")
        check(safety.count() == 2, "セーフティは左右2つに分かれている", safety.count())
        before = pg.locator('.safety-btn').nth(0).locator('.sf-count').text_content()
        safety.nth(0).click()
        pg.wait_for_timeout(400)
        after = pg.locator('.safety-btn').nth(0).locator('.sf-count').text_content()
        check(int(after) == int(before) + 1, "押すとその人の回数が増える", (before, after))
        other_n = pg.locator('.safety-btn').nth(1).locator('.sf-count').text_content()
        check(int(other_n) == 0, "相手の回数は増えない", other_n)
        check(pg.text_content("#scoreA") == sa and pg.text_content("#scoreB") == sb,
              "セーフティを押してもスコアは増えない",
              pg.text_content("#scoreA") + "-" + pg.text_content("#scoreB"))

    # ================================================================
    section("成績のマスワリ率が壊れていない")
    pg.evaluate("() => localStorage.clear()")
    pg.goto(URL)
    pg.wait_for_timeout(500)
    start_9ball(pg, break_type="winner", goal=3)
    for _ in range(3):
        if pg.is_visible("#finishModal"):
            break
        brk = pg.evaluate(BREAKER)
        pg.click('#panelFlags' + brk + ' button:text-is("マスワリ")')
        pg.wait_for_timeout(450)
    if pg.is_visible("#finishModal"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(600)
    stats = pg.evaluate("""() => {
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
      return m.result ? m.result.perSide : null;
    }""")
    check(stats is not None, "結果が保存される")
    if stats:
        check(stats["A"]["masuwari"] == 3, "マスワリ3回が成績に残る", stats["A"]["masuwari"])
        check(stats["A"]["breaks"] >= 3, "ブレイク数も数えられている", stats["A"]["breaks"])

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
