# -*- coding: utf-8 -*-
"""session_test.py — 中断と再開・戻るボタン・ボールセット・ボウラードの検証

対象:
  1. 試合を中断して続きから再開できる
  2. どこからでも戻れるボタン
  3. ボールセットの選択と盤面の色
  4. ボウラードのスコア表
  5. ダブルタップ拡大の抑止

実行: python _test/session_test.py
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
    print("\n== " + name + " ==")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("1 中断と再開")
    check(pg.locator("#resumeCard").get_attribute("hidden") is not None,
          "中断中の試合が無ければ再開カードは出ない")

    helpers.pick_game(pg, "9ball")
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    helpers.set_goal(pg, 5)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    check(pg.text_content("#scoreA") == "2", "2ラック取った", pg.text_content("#scoreA"))

    # アプリを閉じて開き直す想定
    pg.reload()
    pg.wait_for_timeout(800)
    check(pg.is_visible("#screenSetup"), "起動すると設定画面が出る")
    check(pg.is_visible("#resumeCard"), "中断中の試合が最初の画面に出る")
    info = pg.text_content("#resumeInfo") or ""
    check("山田" in info and "佐藤" in info, "誰の試合か分かる", info[:60])
    check("9ボール" in info, "種目が分かる", info[:60])
    check("2" in info, "そこまでのスコアが分かる", info[:60])

    pg.click("#resumeBtn")
    pg.wait_for_timeout(600)
    check(pg.is_visible("#screenMatch"), "続きから再開できる")
    check(pg.text_content("#scoreA") == "2", "スコアが残っている", pg.text_content("#scoreA"))

    # 続きを記録できる
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    check(pg.text_content("#scoreA") == "3", "再開後も記録できる", pg.text_content("#scoreA"))

    # 中断すると設定画面に戻り、また再開できる
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenSetup"), "中断すると設定画面に戻る")
    check(pg.is_visible("#resumeCard"), "中断した試合がまた出る")
    pg.screenshot(path=os.path.join(SHOTS, "82_resume.png"), full_page=True)

    # ================================================================
    section("2 どこからでも戻れるボタン")
    pg.click("#toPlayersBtn2")
    pg.wait_for_timeout(400)
    check(pg.is_visible("#globalBackBtn"), "選手一覧で戻るボタンが出る")
    pg.click("#globalBackBtn")
    pg.wait_for_timeout(400)
    check(pg.is_visible("#screenSetup"), "1つ前に戻れる")

    # 履歴からも戻れる
    pg.click("#toHistoryBtn")
    pg.wait_for_timeout(400)
    check(pg.is_visible("#globalBackBtn"), "履歴でも戻るボタンが出る")
    pg.click("#globalBackBtn")
    pg.wait_for_timeout(400)
    check(pg.is_visible("#screenSetup"), "履歴からも戻れる")

    # 試合中は出さない（誤って抜けないようにするため）
    pg.click("#resumeBtn")
    pg.wait_for_timeout(600)
    check(pg.locator("#globalBackBtn").get_attribute("hidden") is not None,
          "試合中は戻るボタンを出さない（誤操作を防ぐ）")
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(400)

    # ================================================================
    section("3 ボールセットの選択")
    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(300)
    check(pg.is_visible("#ballSetSection"), "ローテーションでボールセットを選べる")
    sets = pg.locator(".ballset-chip").count()
    check(sets == 4, "4種類から選べる", sets)
    labels = pg.locator(".ballset-chip .bs-name").all_text_contents()
    check(any("プラチナム" in x for x in labels), "プラチナムがある", labels)
    check(any("チタニウム" in x for x in labels), "チタニウムがある", labels)
    check(any("ブラック" in x for x in labels), "アラミス ブラックがある", labels)

    # 9ボールでは出さない（盤面を使わないため）
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(250)
    check(pg.locator("#ballSetSection").get_attribute("hidden") is not None,
          "盤面を使わない種目では出さない")

    # プラチナムを選ぶと盤面の色が変わる
    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(250)
    pg.click('.ballset-chip[data-set="platinum"]')
    pg.wait_for_timeout(250)
    pg.fill("#inNameA", "田中")
    pg.fill("#inNameB", "鈴木")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)

    def ball_bg(n):
        return pg.evaluate(
            "(n) => getComputedStyle(document.querySelector('#ballGrid .ball-btn[data-ball=\"' + n + '\"]')).backgroundColor",
            str(n))

    # プラチナムは7番がターコイズ（通常は茶）、6番がグレー（通常は緑）
    c7 = ball_bg(7)
    check(c7 == "rgb(63, 184, 184)", "7番がターコイズになる", c7)
    c6 = ball_bg(6)
    check(c6 == "rgb(185, 181, 173)", "6番がグレーになる", c6)

    # 番号が読める（色地の上に白い丸で置いている）
    check(pg.locator("#ballGrid .bb-num").count() == 15, "全部の球に番号が付く",
          pg.locator("#ballGrid .bb-num").count())
    pg.screenshot(path=os.path.join(SHOTS, "81_platinum.png"))

    # 選んだセットは試合に保存される
    saved = pg.evaluate("""() => {
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
      return m.options.ballSet;
    }""")
    check(saved == "platinum", "使ったボールが記録に残る", saved)

    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(400)

    # ================================================================
    section("4 ボウラード")
    helpers.pick_game(pg, "bowlard")
    pg.wait_for_timeout(300)
    check(pg.locator("#inNameB").count() == 0, "1人用なので相手の欄を出さない")
    check(pg.locator("#goalArea .goal-picker").count() == 0, "先取点の入力も出さない")

    pg.fill("#inNameA", "山田")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    check(pg.is_visible("#sheetArea"), "スコア表が出る")
    check(pg.locator(".bowl-frame").count() == 10, "10フレームある",
          pg.locator(".bowl-frame").count())
    check(pg.is_visible("#bowlPad"), "投球の入力が出る")

    # 最初は0〜10個から選べる
    btns = pg.locator("#bowlPad .bp-btn").count()
    check(btns == 11, "0〜10個から選べる", btns)

    # ストライクを1回
    pg.click('#bowlPad .bp-btn[data-pins="10"]')
    pg.wait_for_timeout(400)
    marks = pg.locator(".bowl-frame").nth(0).text_content() or ""
    check("X" in marks, "ストライクがXで表示される", marks)

    # 次は3個 → 残り7個までしか押せない
    pg.click('#bowlPad .bp-btn[data-pins="3"]')
    pg.wait_for_timeout(400)
    btns2 = pg.locator("#bowlPad .bp-btn").count()
    check(btns2 == 8, "3個入れた後は0〜7個しか押せない", btns2)

    pg.click('#bowlPad .bp-btn[data-pins="4"]')
    pg.wait_for_timeout(400)
    # 1F = 10+3+4 = 17
    f1 = pg.locator(".bowl-frame").nth(0).locator(".bf-score").text_content() or ""
    check(f1 == "17", "ストライクのボーナスが入る（10+3+4=17）", f1)
    total = pg.text_content(".bowl-total") or ""
    check("24" in total, "2フレーム目まで24点", total)
    # スコア欄にもボウリング式の合計が出る（落球数の合計ではない）
    check(pg.text_content("#scoreA") == "24", "スコア欄にボーナス込みの合計が出る",
          pg.text_content("#scoreA"))
    # 相手側はパネルの枠（panelWrapB）ごと隠す。
    # マスワリのボタンをパネル内に置いたため、枠が付いた
    check(not pg.locator("#panelB").is_visible(),
          "1人用なので相手のスコア欄は出さない")
    check(pg.locator("#turnBtn").get_attribute("hidden") is not None,
          "1人用なので交代ボタンも出さない")
    pg.screenshot(path=os.path.join(SHOTS, "83_bowlard.png"), full_page=False)

    # ================================================================
    section("5 ダブルタップ拡大の抑止")
    vp = pg.get_attribute('meta[name="viewport"]', "content") or ""
    check("user-scalable=no" in vp, "拡大を止める指定がある", vp)
    ta = pg.evaluate(
        "() => getComputedStyle(document.querySelector('#bowlPad .bp-btn')).touchAction")
    check(ta == "manipulation", "ボタンにダブルタップ拡大の抑止が効いている", ta)

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
