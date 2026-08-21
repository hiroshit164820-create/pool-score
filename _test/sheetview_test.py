# -*- coding: utf-8 -*-
"""sheetview_test.py — 終わった試合のスコア表を履歴・成績から見る（本人の指示 2026-08-22）

本人の指示:
  「ボウラードの履歴はスコア表そのまま。10フレーム、各投球で何本倒したかを
    履歴から見れるようにしたい。成績を詳しく見るから過去のボウラードの履歴を
    表示できるようにしたい。JPAのスコアシートを保存して履歴から見れるように。
    JPAのスコアシートは試合終了後の結果だけ確認できればいい。」

対象:
  1. ボウラードを終えると、履歴に「スコア表」が出る
  2. 押すと10フレームの表が出て、**試合中に見えていた表と数字が一致する**
  3. 合計・ストライク／スペア／ミスも出る
  4. **1球ごとの記録を空にしても、同じ表が出る**（間引きに耐える）
  5. JPAを終えると履歴に「スコア表」が出て、1点=1マスの升目が出る
  6. JPAの升目の数と埋まり方が、取った点と合っている
  7. スコア表が無い種目（9ボール）には「スコア表」を出さない
  8. 成績の「種目別でさらに詳しく」→ボウラードに1回ごとの記録が並び、押すと表が開く
  9. 閉じる・背景・Escで閉じる
 10. JSエラーが無い

実行: python _test/sheetview_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
if not os.path.isdir(SHOTS):
    os.makedirs(SHOTS)

results = []

# 試合中のスコア表を読み取る（あとで見る表と突き合わせるため）
LIVE_SHEET = """() => {
  const cells = [...document.querySelectorAll('#sheetArea .bowl-frame')];
  return cells.map(c => ({
    no: c.querySelector('.bf-no').textContent,
    marks: [...c.querySelectorAll('.bf-m')].map(m => m.textContent).join('|'),
    score: c.querySelector('.bf-score').textContent
  }));
}"""

VIEW_SHEET = """() => {
  const cells = [...document.querySelectorAll('#sheetViewBody .bowl-frame')];
  return cells.map(c => ({
    no: c.querySelector('.bf-no').textContent,
    marks: [...c.querySelectorAll('.bf-m')].map(m => m.textContent).join('|'),
    score: c.querySelector('.bf-score').textContent
  }));
}"""


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def modal_hidden(pg):
    return pg.locator("#sheetViewModal").get_attribute("hidden") is not None


def sheet_btn(pg, i=0):
    return pg.locator("#historyList .match-card").nth(i).locator(
        "button", has_text="スコア表")


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    # ================= ボウラード =================
    section("1. ボウラードを1試合こなす")
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "bowlard")
    pg.wait_for_timeout(600)
    pg.fill("#inNameA", "たいら")
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)
    # 10フレーム。毎回いろいろな本数を入れて、記号が全部出る組み合わせにする
    pattern = [10, 7, 3, 9, 0, 10, 8, 2, 6, 4, 10, 10, 5, 5, 0, 10, 7, 2, 10, 10, 10]
    for n in pattern:
        btn = pg.locator('#bowlPad .bp-btn[data-pins="%d"]' % n)
        if not btn.count():
            btn = pg.locator("#bowlPad .bp-btn", has_text=str(n)).first
        if btn.count() and btn.is_enabled():
            btn.click()
            pg.wait_for_timeout(120)
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
    pg.wait_for_timeout(400)

    # 試合中のスコア表を開いて、内容を控える
    sheet_toggle = pg.locator("#sheetBtn")
    if sheet_toggle.count() and sheet_toggle.is_visible():
        sheet_toggle.click()
        pg.wait_for_timeout(400)
    live = pg.evaluate(LIVE_SHEET)
    print("   試合中の表 %d フレーム" % len(live))
    check(len(live) == 10, "試合中に10フレームの表が出ている", len(live))

    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)
    else:
        pg.click("#finishBtn")
        pg.wait_for_timeout(500)
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            pg.click("#confirmFinishBtn")
            pg.wait_for_timeout(900)

    section("2. 履歴に「スコア表」が出る")
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    check(sheet_btn(pg).count() == 1, "終わったボウラードに「スコア表」が出る")
    sheet_btn(pg).click()
    pg.wait_for_timeout(700)
    check(not modal_hidden(pg), "スコア表が開く")
    after = pg.evaluate(VIEW_SHEET)
    print("   あとで見る表 %d フレーム" % len(after))
    check(len(after) == 10, "10フレームぶん出る", len(after))
    check(after == live, "試合中の表と数字が一致する",
          {"試合中": live[:3], "あとで": after[:3]})
    body = pg.inner_text("#sheetViewBody")
    check("合計" in body, "合計が出る", body[:80])
    check("ストライク" in body, "ストライク／スペア／ミスが出る", body[:120])
    pg.screenshot(path=os.path.join(SHOTS, "sheetview_bowlard.png"), full_page=False)

    section("3. 閉じられる")
    pg.click("#sheetViewCloseBtn")
    pg.wait_for_timeout(400)
    check(modal_hidden(pg), "「閉じる」で閉じる")
    sheet_btn(pg).click()
    pg.wait_for_timeout(500)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    check(modal_hidden(pg), "Escでも閉じる")

    section("4. 1球ごとの記録を空にしても同じ表が出る")
    # 将来の「古い記録の間引き」に耐えるか。ここが通れば間引いても表は残る
    pg.evaluate("""() => {
      const id = STORE.listMatches()[0].id;
      const m = STORE.loadMatch(id);
      m.events = [];
      STORE.saveMatch(m);
    }""")
    pg.click("#tabHistory")
    pg.wait_for_timeout(600)
    check(sheet_btn(pg).count() == 1, "「スコア表」は残る")
    sheet_btn(pg).click()
    pg.wait_for_timeout(700)
    after2 = pg.evaluate(VIEW_SHEET)
    check(after2 == live, "記録を消しても同じ表が出る",
          {"前": live[:3], "後": after2[:3]})
    pg.click("#sheetViewCloseBtn")
    pg.wait_for_timeout(400)

    # ================= JPA =================
    section("5. JPAを1試合こなす")
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(700)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "いっちょ")
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)
    for _ in range(80):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(70)
    pg.wait_for_timeout(400)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)

    section("6. JPAのスコアシートを履歴から見る")
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    check(sheet_btn(pg).count() == 1, "終わったJPAに「スコア表」が出る")
    sheet_btn(pg).click()
    pg.wait_for_timeout(700)
    check(not modal_hidden(pg), "スコアシートが開く")
    jpa = pg.evaluate("""() => {
      const sides = [...document.querySelectorAll('#sheetViewBody .sheet-side')];
      return sides.map(s => ({
        head: s.querySelector('.sheet-head').textContent,
        cells: s.querySelectorAll('.sheet-cell').length,
        filled: s.querySelectorAll('.sheet-cell.filled').length
      }));
    }""")
    print("   " + str(jpa))
    check(len(jpa) == 2, "2人ぶんの升目が出る", jpa)
    check(all(x["cells"] > 0 for x in jpa), "升目がある", jpa)
    # 取った点のぶんだけ埋まっているか、保存されている値と突き合わせる
    got = pg.evaluate("""() => {
      const s = STORE.sheetOf(STORE.listMatches()[0].id);
      return {A: s.got.A, B: s.got.B, tA: s.targets.A, tB: s.targets.B};
    }""")
    print("   " + str(got))
    check(jpa[0]["filled"] == got["A"] and jpa[1]["filled"] == got["B"],
          "埋まっている升の数が取った点と合う", {"画面": jpa, "記録": got})
    check(jpa[0]["cells"] == got["tA"] and jpa[1]["cells"] == got["tB"],
          "升の数が目標点と合う", {"画面": jpa, "記録": got})
    pg.screenshot(path=os.path.join(SHOTS, "sheetview_jpa.png"), full_page=False)
    pg.click("#sheetViewCloseBtn")
    pg.wait_for_timeout(400)

    section("7. スコア表が無い種目には出さない")
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(600)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "いっちょ")
    helpers.set_goal(pg, 3)
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    for _ in range(10):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(180)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    check(sheet_btn(pg, 0).count() == 0, "9ボールには「スコア表」を出さない")

    section("8. 成績から過去のボウラードを見る")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(500)
    pg.evaluate("""() => {
      const p = STORE.listPlayers().find(x => x.name === 'たいら');
      PLAYERS.openStats(p);
    }""")
    pg.wait_for_timeout(900)
    # 「種目別でさらに詳しく」を開く
    pg.evaluate("""() => {
      document.querySelectorAll('#screenStats details').forEach(d => d.open = true);
    }""")
    pg.wait_for_timeout(500)
    rows = pg.locator(".bowl-hist-row")
    print("   1回ごとの記録 %d件" % rows.count())
    check(rows.count() == 1, "過去のボウラードが並ぶ", rows.count())
    txt = pg.inner_text(".bowl-hist-row")
    check("点" in txt, "スコアが出る", txt)
    rows.first.click()
    pg.wait_for_timeout(800)
    check(not modal_hidden(pg), "押すとスコア表が開く")
    after3 = pg.evaluate(VIEW_SHEET)
    check(after3 == live, "成績から開いても同じ表", {"前": live[:3], "後": after3[:3]})
    pg.screenshot(path=os.path.join(SHOTS, "sheetview_stats.png"), full_page=True)
    pg.click("#sheetViewCloseBtn")
    pg.wait_for_timeout(400)

    section("9. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
