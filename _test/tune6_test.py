# -*- coding: utf-8 -*-
"""tune6_test.py — 履歴の種目の絞り込みにハウスゲームを足したことの検証

対象（本人の指示 2026-08-21 / 段階3の残り）:
  1. 履歴の種目の絞り込みに 5-9 / 5-10 / カイルン が出る
  2. カイルンで絞ると、カイルンの記録だけが残る（対戦の記録は消える）
  3. ハウスゲームだけに絞っても「この条件に合う試合はありません」にならない
     （直す前は、対戦の記録が0件になった時点で早く戻っていた）
  4. 対戦の種目で絞ると、ハウスゲームの記録は出ない
  5. 相手の絞り込みにハウスゲームだけに出てくる人も並ぶ
  6. カイルンの記録に「0ラック」が出ない
  7. 見出しが「ハウスゲームの記録」になっている

実行: python _test/tune6_test.py
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


def game_options(pg):
    return pg.eval_on_selector_all(
        "#histGameFilter option", "els => els.map(e => e.value + '|' + e.textContent)")


def opp_options(pg):
    return pg.eval_on_selector_all(
        "#histOppFilter option", "els => els.map(e => e.textContent)")


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ---- 記録を作る：対戦（JPA 9ボール）1件 ----
    section("記録を作る")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    for n in ["たいら", "たかのぶ"]:
        helpers.add_player(pg, n)
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL3").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL3").click()
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
    check(pg.evaluate("() => STORE.listMatches().length") >= 1, "対戦の記録が1件できた")

    # ---- ハウスゲームの記録を直に入れる（5-9 と カイルン）----
    made = pg.evaluate("""() => {
      STORE.saveMoneyResult({
        gameId: 'money_9ball', gameLabel: '5-9',
        players: [{name:'たいら', score:3, handicapBalls:[]},
                  {name:'みなみ', score:-3, handicapBalls:[]}],
        racks: 5,
      });
      STORE.saveMoneyResult({
        gameId: 'kailun', gameLabel: 'カイルン',
        players: [{name:'たいら', score:4, handicapBalls:[]},
                  {name:'ゆうすけ', score:2, handicapBalls:[]}],
        racks: 0,
      });
      return STORE.listMoneyResults().length;
    }""")
    check(made == 2, "ハウスゲームの記録が2件できた", made)

    pg.click("#tabHistory")
    pg.wait_for_timeout(600)

    # ================= 1. 絞り込みの選択肢 =================
    section("1. 種目の絞り込みにハウスゲームが並ぶ")
    opts = game_options(pg)
    joined = " ".join(opts)
    check(any(o.startswith("kailun|") for o in opts), "カイルンが選べる", joined)
    check(any(o.startswith("money_9ball|") for o in opts), "5-9 が選べる", joined)
    check(any(o.startswith("jpa_9ball|") for o in opts), "対戦の種目も残っている", joined)

    # ================= 5. 相手の絞り込み =================
    section("5. 相手の絞り込み")
    names = opp_options(pg)
    check("ゆうすけ" in names, "カイルンにだけ出てくる人も並ぶ", names)
    check("みなみ" in names, "5-9 にだけ出てくる人も並ぶ", names)

    # ================= 2・3・6・7. カイルンで絞る =================
    section("2・3・6・7. カイルンで絞る")
    pg.select_option("#histGameFilter", "kailun")
    pg.wait_for_timeout(500)
    body = pg.inner_text("#historyList")
    check("この条件に合う試合はありません" not in body,
          "「合う試合はありません」にならない", body[:120])
    check("カイルン" in body, "カイルンの記録が出る", body[:160])
    check("ゆうすけ" in body, "カイルンの参加者が出る", body[:160])
    check("たかのぶ" not in body, "対戦の記録は消えている", body[:160])
    check("5-9" not in body.replace("5-9 / 5-10", ""), "5-9 の記録も消えている", body[:160])
    check("ラック" not in body, "カイルンに「0ラック」が出ない", body[:160])
    check("ハウスゲームの記録" in body, "見出しが「ハウスゲームの記録」", body[:160])
    pg.screenshot(path=os.path.join(SHOTS, "tune6_kailun_filter.png"))

    # ================= 5-9 で絞る =================
    section("5-9 で絞る")
    pg.select_option("#histGameFilter", "money_9ball")
    pg.wait_for_timeout(500)
    body = pg.inner_text("#historyList")
    check("みなみ" in body, "5-9 の記録が出る", body[:160])
    check("ゆうすけ" not in body, "カイルンの記録は消えている", body[:160])
    check("5ラック" in body, "5-9 はラック数が出る", body[:160])

    # ================= 4. 対戦の種目で絞る =================
    section("4. 対戦の種目で絞る")
    pg.select_option("#histGameFilter", "jpa_9ball")
    pg.wait_for_timeout(500)
    body = pg.inner_text("#historyList")
    check("たかのぶ" in body, "対戦の記録が出る", body[:160])
    check("ハウスゲームの記録" not in body, "ハウスゲームの見出しが出ない", body[:160])
    check("ゆうすけ" not in body and "みなみ" not in body,
          "ハウスゲームの記録は出ない", body[:160])

    # ================= 相手で絞る =================
    section("相手で絞る")
    pg.select_option("#histGameFilter", "")
    pg.wait_for_timeout(300)
    pg.select_option("#histOppFilter", "ゆうすけ")
    pg.wait_for_timeout(500)
    body = pg.inner_text("#historyList")
    check("この条件に合う試合はありません" not in body,
          "ハウスゲームだけの人でも中身が出る", body[:120])
    check("カイルン" in body, "その人のカイルンの記録が出る", body[:160])
    check("たかのぶ" not in body, "関係ない対戦は出ない", body[:160])

    # ================= 絞り込みを外す =================
    section("絞り込みを外す")
    pg.click("#histFilterClear")
    pg.wait_for_timeout(500)
    body = pg.inner_text("#historyList")
    check("たかのぶ" in body and "ゆうすけ" in body and "みなみ" in body,
          "全部の記録が戻る", body[:200])

    section("エラー")
    check(not errs, "画面のエラーが無い", errs)

    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
