# -*- coding: utf-8 -*-
"""bh_score_test.py — ボールハンデありの試合でスコアが入るか（本人の指摘 2026-08-23）

症状:
  ボールハンデありの試合でスコアを押しても点数が変わらず、
  記録だけが積み上がる。

原因:
  ui_match.js の pickBallToPocket が、ハンデのある側は「得点になる球」を
  選ぶのに、ハンデが無い側は盤面の最若番（1番）を落としていた。
  ハンデが無い側はキーボール（9番など）だけが得点になるため、
  9ボールで8回・10ボールで9回押すまで1点も入らなかった（実測）。

確かめること:
  1. ハンデのある側は1タップで1点（元から動いていた）
  2. ハンデが無い側も1タップで1点（ここが壊れていた）
  3. 記録される球が「実際に得点になる球」であること
  4. ハンデを使わない球単位の種目（JPA・14-1）は1番から順のまま

実行: python _test/bh_score_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


SCORE = """() => ({
  A: parseInt((document.getElementById('scoreA')||{}).textContent || '0', 10),
  B: parseInt((document.getElementById('scoreB')||{}).textContent || '0', 10),
})"""

POCKETS = """() => {
  const m = STORE.findOngoing();
  const mm = m ? STORE.loadMatch(m.id) : null;
  return mm ? mm.events.filter(e => e.t === 'POCKET' && !e.voided)
      .map(e => e.side + ':' + (e.d.balls || []).join(',')) : [];
}"""


def taps_until_point(pg, side, limit=16):
    """その側を押し続けて、点が1増えるまでの回数を返す"""
    before = pg.evaluate(SCORE)[side]
    for i in range(1, limit + 1):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            return "試合が終わった"
        pg.click("#panel" + side)
        pg.wait_for_timeout(180)
        if pg.evaluate(SCORE)[side] > before:
            return i
    return "%d回押しても入らない" % limit


def open_handicap_match(pg, game_id, chip):
    helpers.goto_setup(pg)
    helpers.pick_game(pg, game_id)
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "いっちょ")
    helpers.set_handicap_mode(pg, True)
    pg.wait_for_timeout(400)
    # 2つめの欄（B側）にハンデを付ける
    pg.click('#ballHandicapArea .field:nth-of-type(2) .chip:text-is("%s")' % chip)
    pg.wait_for_timeout(400)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)


errs = []

with sync_playwright() as p:
    br = p.chromium.launch()

    # ============ 9ボール / 10ボール ============
    for game_id, label, chip, key in [
        ("9ball", "9ボール", "7番以上", "9"),
        ("10ball", "10ボール", "8番以上", "10"),
    ]:
        section("%s（Bに「%s」）" % (label, chip))
        pg = br.new_page(viewport={"width": 430, "height": 932})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("dialog", lambda d: d.accept(""))
        pg.goto(URL)
        pg.wait_for_timeout(900)
        open_handicap_match(pg, game_id, chip)

        bh = pg.evaluate("""() => {
          const m = STORE.findOngoing();
          return STORE.loadMatch(m.id).goal.ballHandicap;
        }""")
        check(bh and bh["B"] and bh["B"]["scoringBalls"],
              "下ごしらえ: Bにハンデが付いている", bh)

        n = taps_until_point(pg, "B")
        check(n == 1, "%s ハンデのある側は1タップで1点" % label, n)

        n = taps_until_point(pg, "A")
        check(n == 1, "%s ハンデの無い側も1タップで1点" % label, n)

        pk = pg.evaluate(POCKETS)
        # ハンデの無い側が落とすのはキーボールだけ。
        # 1番から順に消していた頃は A:1 A:2 ... が並んでいた
        a_balls = [x.split(":")[1] for x in pk if x.startswith("A:")]
        check(a_balls == [key],
              "%s ハンデの無い側が落とすのはキーボールだけ" % label, a_balls)
        check(not errs, "JSエラーが出ない", errs)
        pg.close()

        # ---- 1ラック最大1点（本人の確認 2026-08-27） ----
        # ハンデ球を入れた時点でラックが終わるので、
        # 同じラックで8番・9番と続けて点を重ねることはない。
        # 以前は7番で1点入ってもラックが続き、最大3点入っていた
        pg = br.new_page(viewport={"width": 430, "height": 932})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("dialog", lambda d: d.accept(""))
        pg.goto(URL)
        pg.wait_for_timeout(900)
        open_handicap_match(pg, game_id, chip)
        for i in range(1, 3):
            pg.click("#panelB")
            pg.wait_for_timeout(350)
            st = pg.evaluate("""() => {
              const m = STORE.findOngoing();
              const mm = m ? STORE.loadMatch(m.id) : null;
              const ev = mm ? mm.events : [];
              return {
                点: parseInt((document.getElementById('scoreB')||{}).textContent||'0', 10),
                ラック: ev.filter(e => e.t === 'RACK_START').length,
                球: ev.filter(e => e.t === 'POCKET').map(e => e.d.balls.join(',')),
              };
            }""")
            check(st["点"] == i,
                  "%s ハンデ球%d回で%d点（1ラック1点）" % (label, i, i), st)
            check(st["ラック"] == i + 1,
                  "%s ハンデ球を入れるたびにラックが終わる" % label, st)
            # 同じ球（ハンデの下限）だけが並ぶ＝毎回あたらしいラックの1球目
            check(len(set(st["球"])) == 1,
                  "%s 同じラックで点を重ねていない" % label, st["球"])
        pg.close()

    # ============ ハンデを使わない球単位の種目（壊していないこと） ============
    section("ハンデを使わない種目は1番から順のまま")
    for game_id, label, goal_chip in [
        ("jpa_9ball", "JPA 9ボール", None),
        ("straight", "14-1", "50点先取"),
    ]:
        pg = br.new_page(viewport={"width": 430, "height": 932})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("dialog", lambda d: d.accept(""))
        pg.goto(URL)
        pg.wait_for_timeout(900)
        helpers.goto_setup(pg)
        helpers.pick_game(pg, game_id)
        pg.wait_for_timeout(500)
        pg.fill("#inNameA", "たいら")
        pg.fill("#inNameB", "いっちょ")
        if goal_chip:
            pg.locator("#goalArea .chip", has_text=goal_chip).first.click()
            pg.wait_for_timeout(300)
        pg.click("#startMatchBtn")
        pg.wait_for_timeout(800)
        for _ in range(4):
            pg.click("#panelA")
            pg.wait_for_timeout(170)
        pk = [x.split(":")[1] for x in pg.evaluate(POCKETS) if x.startswith("A:")]
        check(pk == ["1", "2", "3", "4"], "%s は1番から順に落ちる" % label, pk)
        pg.close()

    check(not errs, "JSエラーが出ない（全体）", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "-" * 50)
print("合計 %d件 / NG %d件" % (len(results), len(ng)))
sys.exit(1 if ng else 0)
