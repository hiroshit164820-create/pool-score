# -*- coding: utf-8 -*-
"""tune5_test.py — 2026-08-21（2便目）の指示のうち、実装済みぶんの検証

対象:
  1. カイルン: 選んだ名前が見える／横スクロールが出ない
  2. JPA 9ボールダブルス: 2人のSLを縦横で見る表から先取点が決まる
  3. ホーム: 「新しい試合を始める」が無い／中断中のカードに×がある
  4. 種目ページ: 中断中のカードに×がある
  5. 選手ページ: 「選手を登録」になっている
  6. 種目名: 14-1に「（ストレートプール）」が付く
  7. 履歴: 開始と終了の時刻が出る
  8. 履歴: 種目名が太字で大きい
  9. 履歴: W-Lがスコアの左右にある
 10. 履歴: JPAポイントに「P」が付かない／スコアと列がそろう
 11. 履歴: ボウラードは獲得スコア・ストライク・スペア・ミス・経過時間
 12. 履歴: 上下のボタンが消えている

実行: python _test/tune5_test.py
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


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================= 5. 選手ページ =================
    section("5. 選手ページの文言")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    lbl = pg.text_content("#toggleAddPlayerBtn") or ""
    # 上の帯に移したぶん字数を詰めた（本人の指示 2026-08-21・段階3）
    check("選手を登録" in lbl, "「選手を登録」になっている", lbl)
    for n in ["たいら", "たかのぶ", "みなみ"]:
        helpers.add_player(pg, n)
    pg.wait_for_timeout(300)

    # ================= 1. カイルン =================
    section("1. カイルンの人選び")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "kailun")
    pg.wait_for_timeout(500)
    check(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"),
          "横スクロールが出ない",
          pg.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]"))
    sel = pg.locator("#kailunPlayers select").first
    sel.select_option("たかのぶ")
    pg.wait_for_timeout(400)
    inp = pg.locator("#kailunPlayers input[type=text]").first
    check(inp.input_value() == "たかのぶ", "選んだ名前が入る", inp.input_value())
    w = pg.evaluate("""() => {
      const i = document.querySelector('#kailunPlayers input[type=text]');
      return Math.round(i.getBoundingClientRect().width);
    }""")
    check(w >= 180, "名前の欄が読める幅（180px以上）ある", w)
    pg.screenshot(path=os.path.join(SHOTS, "tune5_kailun.png"), full_page=True)

    # ================= 2. JPA 9ボールダブルス =================
    section("2. JPA 9ボールダブルスの表")
    tbl = pg.evaluate("""() => {
      const bad = [];
      for (let a = 1; a <= 9; a++) {
        for (let b = 1; b <= 9; b++) {
          const x = (JPA_DOUBLES_9BALL[a] || {})[b];
          const y = (JPA_DOUBLES_9BALL[b] || {})[a];
          if (x !== y) bad.push(['非対称', a, b]);
          if (a + b <= 15 && x === undefined) bad.push(['欠け', a, b]);
          if (a + b > 15 && x !== undefined) bad.push(['余分', a, b]);
        }
      }
      return {bad: bad, sample: jpaDoubles9BallTarget(4, 6)};
    }""")
    check(not tbl["bad"], "表が対称で、合計15までが埋まっている", tbl["bad"][:4])
    check(tbl["sample"] == 24, "自分SL4・パートナーSL6は24点先取（表の例）", tbl["sample"])

    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "jpa_9ball_doubles")
    pg.wait_for_timeout(400)
    fs = pg.locator("#goalArea .field")
    check(fs.count() >= 4, "SLを1人ずつ選べる（4列ある）", fs.count())
    fs.nth(0).locator('.chip:text-is("SL4")').click()
    pg.wait_for_timeout(150)
    fs.nth(1).locator('.chip:text-is("SL6")').click()
    pg.wait_for_timeout(150)
    fs.nth(2).locator('.chip:text-is("SL5")').click()
    pg.wait_for_timeout(150)
    fs.nth(3).locator('.chip:text-is("SL5")').click()
    pg.wait_for_timeout(300)
    res = pg.text_content(".jpa-result") or ""
    check("24点" in res, "SL4+6 は24点先取になる", res)
    fs = pg.locator("#goalArea .field")
    fs.nth(0).locator('.chip:text-is("SL7")').click()
    pg.wait_for_timeout(150)
    fs.nth(1).locator('.chip:text-is("SL9")').click()
    pg.wait_for_timeout(300)
    body = pg.inner_text("#goalArea")
    check("表にありません" in body, "合計16以上は組めないと分かる", body[-80:])

    # ================= 6. 種目名 =================
    section("6. 14-1の種目名")
    labels = helpers.all_game_labels(pg)
    check(any("ストレートプール" in x for x in labels),
          "14-1に「（ストレートプール）」が付く", labels)

    # ================= 試合を作る =================
    section("試合を2つ作る（履歴の確認用）")
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL3").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL5").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    for _ in range(60):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        cur = pg.inner_text("#breakBannerName").strip()
        pn = "#panelA" if cur == "たいら" else "#panelB"
        if pg.eval_on_selector(pn, "e => e.disabled"):
            break
        pg.click(pn)
        pg.wait_for_timeout(90)
    pg.wait_for_timeout(400)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(600)

    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "bowlard")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    for _ in range(14):
        b = pg.locator('#bowlPad button:text-is("10")')
        if not b.count() or pg.locator("#bowlPad").is_hidden():
            break
        b.first.click()
        pg.wait_for_timeout(110)
    pg.wait_for_timeout(400)
    if pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#finishBtn")
        pg.wait_for_timeout(500)
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(700)

    # ================= 7〜12. 履歴 =================
    section("7〜12. 履歴")
    pg.click("#tabHistory")
    pg.wait_for_timeout(600)

    check(pg.locator("#exportBtn").count() == 0, "上の「書き出し」が無い")
    check(pg.locator("#backFromHistoryBtn").count() == 0, "上の「戻る」が無い")
    check(pg.locator("#newMatchBtn").count() == 0, "下の「新しい試合」が無い")
    check(pg.locator("#toPlayersBtn").count() == 0, "下の「プレーヤー」が無い")
    check(pg.locator("#importBtn").count() == 0, "下の「読み込み」が無い")
    check(pg.locator("#screenHistory .bottom-bar").count() == 0, "下の帯ごと無い")

    times = pg.eval_on_selector_all(".match-card .mc-time", "e => e.map(x => x.textContent)")
    check(len(times) >= 2 and all("開始" in t for t in times), "開始の時刻が出る", times[:2])
    check(all("終了" in t for t in times), "終了の時刻も出る", times[:2])

    gsize = pg.eval_on_selector(".match-card .mc-game", """e => {
      const s = getComputedStyle(e);
      return {size: parseFloat(s.fontSize), weight: parseInt(s.fontWeight, 10)};
    }""")
    check(gsize["size"] >= 15, "種目名が15px以上", gsize)
    check(gsize["weight"] >= 800, "種目名が太字", gsize)

    # W-L はスコアの左右
    wl = pg.evaluate("""() => {
      const sc = document.querySelector('.match-card .mc-score');
      if (!sc) return null;
      const kids = [...sc.children].map(c => c.className);
      return kids;
    }""")
    check(wl and len(wl) == 3 and "mc-wl" in wl[0] and "mc-num" in wl[1] and "mc-wl" in wl[2],
          "W-Lがスコアの左右にある", wl)

    jpa = pg.eval_on_selector_all(".match-card .mc-jpa .mc-num",
                                  "e => e.map(x => x.textContent)")
    check(len(jpa) >= 1, "JPAポイントの行がある", jpa)
    check(all("P" not in t for t in jpa), "JPAポイントに「P」を付けない", jpa)
    aligned = pg.evaluate("""() => {
      const s = document.querySelector('.match-card .mc-num');
      const j = document.querySelector('.match-card .mc-jpa .mc-num');
      if (!s || !j) return null;
      const a = s.getBoundingClientRect(), b = j.getBoundingClientRect();
      return Math.abs(a.left - b.left) < 2 && Math.abs(a.width - b.width) < 2;
    }""")
    check(aligned, "上のスコアと列がそろっている", aligned)

    solo = pg.eval_on_selector_all(".match-card .mc-solo-stats",
                                   "e => e.map(x => x.textContent)")
    check(len(solo) == 1, "ボウラードだけ1人用の書き方になる", solo)
    t = solo[0] if solo else ""
    for word in ["獲得スコア", "ストライク", "スペア", "ミス", "経過"]:
        check(word in t, "ボウラードに「" + word + "」が出る", t)
    check("イニング" not in t, "ボウラードにイニングは出さない", t)
    pg.screenshot(path=os.path.join(SHOTS, "tune5_history.png"), full_page=True)

    # ================= 3・4. 中断中の試合の × =================
    section("3/4. 中断中の試合を閉じる×")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "みなみ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(600)

    check(pg.locator("#resumeCloseBtn").count() == 1, "種目ページの中断カードに×がある")
    pg.click("#tabHome")
    pg.wait_for_timeout(500)
    check(pg.eval_on_selector_all("#homeBody .home-new", "e => e.length") == 0,
          "ホームに「新しい試合を始める」が無い")
    check(pg.locator("#homeBody .hc-close").count() == 1, "ホームの中断カードに×がある")

    before = pg.evaluate("() => STORE.listMatches().filter(m => !m.finished).length")
    pg.click("#homeBody .hc-close")
    pg.wait_for_timeout(500)
    after = pg.evaluate("() => STORE.listMatches().filter(m => !m.finished).length")
    check(after == before - 1, "×で中断中の試合が閉じる", (before, after))
    check(pg.locator("#homeBody .hc-close").count() == 0, "カードも消える")
    hist = pg.evaluate("() => STORE.listMatches().length")
    check(hist == 2, "記録は保存されない（確定済みの2件のまま）", hist)

    check(not errs, "画面のエラーが出ていない", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("成功 %d / %d" % (len(results) - len(ng), len(results)))
if ng:
    for _, label, detail in ng:
        print("  NG: " + label + (("  -> " + str(detail)) if detail else ""))
    sys.exit(1)
print("すべて成功しました")
