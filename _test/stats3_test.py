# -*- coding: utf-8 -*-
"""stats3_test.py — 成績を「一般種目」と「JPA」に分ける／パートナー別
（本人の指示 2026-08-21 / 段階6）

対象:
  1. 総合の勝敗はこれまでどおり出る
  2. 「一般種目とJPAの内訳」が出て、一般種目とJPAの勝敗が別々に読める
  3. 内訳の合計が総合と合う
  4. ダブルスで組んだ相手が「パートナー別」に出て、勝敗と勝率が読める
  5. ダブルスをしていない人にはパートナー別を出さない
  6. JPAをしていない人にはJPAの行を出さない

実行: python _test/stats3_test.py
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
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def finish_by(pg, side):
    """side が勝つまでスコアを押し、終了まで進める"""
    for _ in range(40):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        panel = "#panel" + side
        if pg.eval_on_selector(panel, "e => e.disabled"):
            break
        pg.click(panel)
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)


def open_detail(pg, name):
    pg.click("#tabStats")
    pg.wait_for_timeout(600)
    # 一覧から名前を押す
    pg.locator("#statsBody .match-card", has_text=name).first.click()
    pg.wait_for_timeout(600)
    # 2026-08-21・D でカードを既定で閉じるようにしたので、読む前に全部開く
    pg.evaluate("""() => {
      document.querySelectorAll('#statsBody details').forEach(d => { d.open = true; });
    }""")
    pg.wait_for_timeout(250)
    return pg.inner_text("#statsBody")


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    section("試合を3つ作る")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    for n in ["たいら", "たかのぶ", "みなみ", "ゆうすけ"]:
        helpers.add_player(pg, n)

    # (1) 一般種目（9ボール）: たいらの勝ち
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    finish_by(pg, "A")

    # (2) JPA 9ボール: たいらの負け
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(400)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL3").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL3").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    finish_by(pg, "B")

    # (3) 9ボールダブルス: たいら＋みなみ の勝ち
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball_doubles")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameA2", "みなみ")
    pg.fill("#inNameB", "たかのぶ")
    pg.fill("#inNameB2", "ゆうすけ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    finish_by(pg, "A")

    made = pg.evaluate("() => STORE.listMatches().filter(m => m.finished).length")
    check(made == 3, "終わった試合が3つできた", made)

    # ================= 中身を直に確かめる =================
    section("集計の中身")
    st = pg.evaluate("""() => {
      const p = STORE.listPlayers().find(x => x.name === 'たいら');
      return p ? STORE.playerStats(p.id) : null;
    }""")
    check(st and st["matches"] == 3, "3試合ぶん数えている", st and st["matches"])
    check(st["general"]["matches"] == 2, "一般種目は2試合（9ボールとダブルス）",
          st["general"])
    check(st["general"]["wins"] == 2 and st["general"]["losses"] == 0,
          "一般種目は2勝0敗", st["general"])
    check(st["jpa"]["matches"] == 1 and st["jpa"]["losses"] == 1,
          "JPAは1試合1敗", st["jpa"])
    check(st["general"]["matches"] + st["jpa"]["matches"] == st["matches"],
          "内訳の合計が総合と合う",
          str(st["general"]["matches"]) + "+" + str(st["jpa"]["matches"])
          + " vs " + str(st["matches"]))
    check(st["general"]["wins"] + st["jpa"]["wins"] == st["wins"],
          "勝ちの合計も総合と合う")
    check(list(st["partners"].keys()) == ["みなみ"], "パートナーはみなみだけ",
          st["partners"])
    check(st["partners"]["みなみ"]["wins"] == 1 and st["partners"]["みなみ"]["matches"] == 1,
          "みなみと組んで1試合1勝", st["partners"])

    # ================= 画面で確かめる =================
    section("画面に出る")
    text = open_detail(pg, "たいら")
    check("成績（総合）" in text, "総合の表がある", text[:200])
    check("W-L" in text and "勝率" in text, "総合の勝敗と勝率が出る")
    check("一般種目とJPAの内訳" in text, "内訳の表がある", text[:400])
    check("一般種目" in text and "JPA" in text, "一般種目とJPAの行がある")
    check("2勝0敗" in text.replace(" ", ""), "一般種目が2勝0敗と読める",
          text[:600])
    check("0勝1敗" in text.replace(" ", ""), "JPAが0勝1敗と読める", text[:600])
    check("パートナー別" in text, "パートナー別の表がある", text[:600])
    check("みなみ" in text, "組んだ相手の名前が出る")
    pg.screenshot(path=os.path.join(SHOTS, "stats3_taira.png"), full_page=True)

    # ================= 出さない場合 =================
    section("当てはまらない人には出さない")
    text2 = open_detail(pg, "ゆうすけ")
    check("パートナー別" in text2, "ゆうすけにもパートナー別が出る（たかのぶと組んだ）",
          text2[:400])
    check("たかのぶ" in text2, "相方の名前が出る")
    # ゆうすけはJPAをしていないので、JPAの行は出さない
    check("一般種目とJPAの内訳" in text2, "内訳の表は出る")
    body2 = text2[text2.find("一般種目とJPAの内訳"):]
    body2 = body2[:body2.find("パートナー別") if body2.find("パートナー別") > 0 else len(body2)]
    check("JPA" not in body2.replace("一般種目とJPAの内訳", ""),
          "JPAをしていない人にJPAの行は出さない", body2[:200])

    text3 = open_detail(pg, "たかのぶ")
    check("一般種目とJPAの内訳" in text3, "たかのぶにも内訳が出る")

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
