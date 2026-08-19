# -*- coding: utf-8 -*-
"""tabbar_test.py — 下部タブとホーム（個人ダッシュボード）の検証（本人指示12・13・15）

対象:
  12. 左下の固定「戻る」をやめ、下部タブにまとめる
  13. タブの中身（ホーム／種目／選手／成績／履歴）
  15. 選手登録と選手一覧が1画面にまとまっている

実行: python _test/tabbar_test.py
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


def play(pg, a, bname, winner, goal=2):
    """1試合して決着まで進める"""
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", a)
    pg.fill("#inNameB", bname)
    helpers.set_goal(pg, goal)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    for _ in range(goal):
        pg.click("#panel" + winner)
        pg.wait_for_timeout(400)
        if pg.is_visible("#finishModal"):
            break
    if pg.is_visible("#finishModal"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 375, "height": 667})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================================================================
    section("12. 固定の戻るボタンをやめ、タブにまとめる")
    check(pg.locator("#globalBackBtn").count() == 0, "左下の固定戻るボタンは無い")
    check(pg.is_visible("#tabBar"), "下部タブが出る")
    check(pg.locator("#tabBack").count() == 1, "タブの中に戻るボタンがある")

    # 起動直後は戻り先が無いので押せない（押しても何も起きないと不安になる）
    check(pg.is_disabled("#tabBack"), "戻り先が無いときは押せない")

    # ================================================================
    section("13. タブの中身")
    labels = [t.strip() for t in pg.locator(".tab-btn .tb-label").all_text_contents()]
    # 「配置」は練習配置（指示16）。あとから足したタブ
    check(labels == ["戻る", "ホーム", "種目", "選手", "成績", "配置", "履歴"],
          "タブは 戻る／ホーム／種目／選手／成績／配置／履歴", labels)

    # タップ目標の大きさ（台の脇で押せること）
    small = pg.evaluate("""() => {
      return Array.from(document.querySelectorAll('.tab-btn'))
        .filter(b => b.getBoundingClientRect().height < 44)
        .map(b => b.textContent.trim());
    }""")
    check(len(small) == 0, "タブのボタンが全て44px以上", small)

    # 各タブが開く
    for tab, screen, name in [
        ("#tabHome", "#screenHome", "ホーム"),
        ("#tabSetup", "#screenSetup", "種目"),
        ("#tabPlayers", "#screenPlayers", "選手"),
        ("#tabStats", "#screenStats", "成績"),
        ("#tabHistory", "#screenHistory", "履歴"),
    ]:
        pg.click(tab)
        pg.wait_for_timeout(450)
        check(pg.is_visible(screen), name + "タブで" + name + "の画面が開く")

    # いまの画面のタブに印が付く
    pg.click("#tabHome")
    pg.wait_for_timeout(450)
    pressed = pg.evaluate("""() => Array.from(document.querySelectorAll('.tab-btn'))
      .filter(b => b.getAttribute('aria-pressed') === 'true')
      .map(b => b.textContent.trim().replace(/\\s+/g, ''))""")
    check(len(pressed) == 1 and "ホーム" in pressed[0], "いまの画面のタブに印が付く", pressed)

    # ================================================================
    section("13. ホーム（個人ダッシュボード）の中身")
    # 記録が無いときの案内
    body = pg.text_content("#homeBody") or ""
    check("まだ記録がありません" in body, "記録が無いときは案内を出す", body[:40])
    check(pg.locator(".home-new").count() == 1, "記録が無くても試合を始められる")

    # 記録を作る
    play(pg, "山田", "佐藤", "A")
    play(pg, "山田", "鈴木", "A")
    play(pg, "山田", "佐藤", "B")

    pg.click("#tabHome")
    pg.wait_for_timeout(600)
    titles = pg.locator(".home-card .hc-title").all_text_contents()
    check(any("成績" in t for t in titles), "自分の成績が出る", titles)
    check(any("直近の試合" in t for t in titles), "直近の試合が出る", titles)

    vals = pg.locator(".home-stat .hs-val").all_text_contents()
    lbls = pg.locator(".home-stat .hs-label").all_text_contents()
    check(lbls == ["勝率", "勝ち", "負け", "試合"], "勝率・勝ち・負け・試合数を出す", lbls)
    check(vals[0] == "67%", "勝率が正しい（2勝1敗＝67%）", vals)
    check(vals[1] == "2" and vals[2] == "1" and vals[3] == "3",
          "勝敗数が正しい", vals)

    rows = pg.locator(".home-row .hr-names").all_text_contents()
    check(len(rows) == 3, "直近の試合が並ぶ", rows)

    # ================================================================
    section("13. 中断した試合はホームの先頭に出る")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "田中")
    helpers.set_goal(pg, 5)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    pg.click("#panelA")
    pg.wait_for_timeout(400)

    pg.evaluate("() => HOME.open()")
    pg.wait_for_timeout(600)
    first = pg.locator(".home-card").first
    check("中断している試合" in (first.text_content() or ""),
          "中断した試合がいちばん上に出る", (first.text_content() or "")[:30])
    check(pg.locator(".home-card.resume").count() == 1, "中断の札が目立つ形で出る")

    # 続きから記録できる
    pg.click('.home-card.resume button:text-is("続きから記録する")')
    pg.wait_for_timeout(700)
    check(pg.is_visible("#screenMatch"), "続きから記録できる")
    check(pg.text_content("#scoreA") == "1", "中断前のスコアが残っている",
          pg.text_content("#scoreA"))

    # ================================================================
    section("12. 試合中はタブを出さない（誤操作を防ぐ）")
    check(pg.locator("#tabBar").get_attribute("hidden") is not None,
          "試合中はタブが出ない")
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#tabBar"), "試合を抜けるとタブが戻る")

    # ================================================================
    section("15. 選手登録と選手一覧が1画面にまとまっている")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenPlayers"), "選手の画面が開く")
    check(pg.locator("#toggleAddPlayerBtn").count() == 1, "同じ画面に登録フォームがある")
    check(pg.locator("#playersList").count() == 1 or pg.locator(".list").count() >= 1,
          "同じ画面に一覧がある")
    # 登録フォームは畳んであり、一覧が主役
    check(pg.locator("#addPlayerBody").get_attribute("hidden") is not None,
          "登録フォームは畳んである（一覧を主役にする）")
    helpers.open_add_player(pg)
    check(pg.locator("#addPlayerBody").get_attribute("hidden") is None,
          "押すと登録フォームが開く")
    pg.screenshot(path=os.path.join(SHOTS, "tabbar_players.png"))

    # ================================================================
    section("タブが内容を隠さない")
    pg.click("#tabHistory")
    pg.wait_for_timeout(500)
    # 下までスクロールしたときに、最後の項目がタブに隠れずに読めること。
    # （スクロールできること自体は問題ない。読めない状態が問題）
    d = pg.evaluate("""() => {
      window.scrollTo(0, document.body.scrollHeight);
      const bar = document.getElementById('tabBar').getBoundingClientRect();
      const cards = Array.from(document.querySelectorAll('.match-card'));
      if (!cards.length) return { hidden: false, n: 0 };
      const r = cards[cards.length - 1].getBoundingClientRect();
      return { hidden: r.bottom > bar.top + 1, n: cards.length,
               gap: Math.round(bar.top - r.bottom) };
    }""")
    check(not d["hidden"], "下までスクロールすれば最後の記録もタブに隠れず読める", d)
    check(d["n"] > 0, "履歴に記録が並んでいる", d)

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
