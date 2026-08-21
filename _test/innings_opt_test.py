# -*- coding: utf-8 -*-
"""innings_opt_test.py — 一般種目でイニングを数えるかを選べるようにする

本人の指示（2026-08-21）:
  「一般種目ルール選択時にイニングをカウントするか選択できるようにして」

対象:
  1. 一般種目（9/10/8ボール・ダブルス・ローテーション・14-1）の設定に選択欄が出る
  2. JPA・ボウラードには出ない（JPAは公式スコアシートの土台なので切れない）
  3. 既定は「数える」＝それまでの動きと同じ
  4. 「数えない」で始めると、試合中の帯にイニングが出ない
  5. 「数えない」ではスコア修正のイニング調整も出ない
  6. 「数えない」で終えると、試合結果にイニングの行が出ない
  7. 履歴にもイニングが出ない
  8. 「数える」で始めれば今までどおり出る
  9. 開始前の確認に「イニング 数える／数えない」が出る

実行: python _test/innings_opt_test.py
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


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


FIELD = """() => {
  const f = [...document.querySelectorAll('#goalArea .field')]
    .find(x => (x.querySelector('label') || {}).textContent === 'イニング');
  if (!f) return null;
  return {btns: [...f.querySelectorAll('button')].map(b => ({
            t: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true'})),
          hint: (f.querySelector('.hint') || {}).textContent};
}"""


def pick_innings(pg, on):
    """イニングの「数える／数えない」を選ぶ"""
    label = "数える" if on else "数えない"
    f = pg.locator("#goalArea .field").filter(has_text="イニング").first
    f.locator("button", has_text=label).first.click()
    pg.wait_for_timeout(400)


def start(pg, gid, count):
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, gid)
    pg.wait_for_timeout(600)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "あいて")
    pg.wait_for_timeout(300)
    pick_innings(pg, count)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================= 1. 選択欄が出る種目 =================
    section("1. 一般種目には選択欄が出る")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    for gid in ["9ball", "10ball", "8ball", "rotation", "straight"]:
        helpers.pick_game(pg, gid)
        pg.wait_for_timeout(600)
        f = pg.evaluate(FIELD)
        check(f is not None, gid + " に選択欄がある", f)
        if f:
            check([b["t"] for b in f["btns"]] == ["数える", "数えない"],
                  gid + " の選択肢が2つ", f["btns"])
            check(f["btns"][0]["on"] and not f["btns"][1]["on"],
                  gid + " の既定は「数える」", f["btns"])

    section("2. ダブルスにも出る")
    helpers.pick_game(pg, "9ball_doubles")
    pg.wait_for_timeout(600)
    check(pg.evaluate(FIELD) is not None, "9ボールダブルスに選択欄がある")

    section("3. JPA・ボウラードには出ない")
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(600)
    check(pg.evaluate(FIELD) is None, "JPA 9ボールには出ない（常に数える）")
    helpers.pick_game(pg, "bowlard")
    pg.wait_for_timeout(600)
    check(pg.evaluate(FIELD) is None, "ボウラードには出ない（1人でやる種目）")

    # ================= 4. 「数えない」で始める =================
    section("4. 「数えない」で始めた試合")
    start(pg, "9ball", False)
    check(pg.is_visible("#screenMatch"), "試合が始まる")
    check(pg.evaluate("() => STORE.findOngoing().options.countInnings") is False,
          "記録に「数えない」が残る")
    check(not pg.is_visible("#inningInfo"), "試合中の帯にイニングが出ない")
    check(pg.is_visible("#rackInfo"), "ラック数はいままでどおり出る")

    section("5. スコア修正にイニング調整が出ない")
    pg.click("#panelA")
    pg.wait_for_timeout(400)
    pg.click("#reviseBtn")
    pg.wait_for_timeout(500)
    check(pg.eval_on_selector("#reviseInning", "e => e.hidden"),
          "イニングの増減が隠れている")
    pg.click("#closeReviseBtn")
    pg.wait_for_timeout(400)

    section("6. 試合結果にイニングの行が出ない")
    for _ in range(12):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(220)
    pg.wait_for_timeout(500)
    body = pg.inner_text("#finishModal")
    print("   " + body.replace("\n", " / ")[:200])
    check("イニング" not in body, "確認の画面にイニングが無い", body[:200])
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(900)

    section("7. 履歴にもイニングが出ない")
    pg.click("#tabHistory")
    pg.wait_for_timeout(800)
    hist = pg.inner_text("#historyList")
    check("イニング" not in hist, "履歴にイニングが出ない", hist[:200])
    check(pg.evaluate("() => STORE.listMatches()[0].innings") is None,
          "索引のイニングが空になっている")
    check(pg.evaluate("() => STORE.listMatches()[0].countInnings") is False,
          "索引に「数えない」が残る")

    # ================= 8. 「数える」で始める =================
    section("8. 「数える」なら今までどおり")
    start(pg, "9ball", True)
    check(pg.evaluate("() => STORE.findOngoing().options.countInnings") is True,
          "記録に「数える」が残る")
    check(pg.is_visible("#inningInfo"), "試合中の帯にイニングが出る")
    check("イニング" in (pg.inner_text("#inningInfo") or ""), "文言が入っている")
    pg.click("#reviseBtn")
    pg.wait_for_timeout(500)
    check(not pg.eval_on_selector("#reviseInning", "e => e.hidden"),
          "スコア修正でイニングを直せる")
    pg.click("#closeReviseBtn")
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, "innings_on.png"), full_page=True)

    section("9. 開始前の確認に出る")
    # 試合中は下部タブが隠れるので、記録を消してから読み込み直す
    pg.evaluate("() => { const m = STORE.findOngoing(); if (m) STORE.deleteMatch(m.id); }")
    pg.goto(URL)
    pg.wait_for_timeout(800)
    pg.click("#tabSetup")
    pg.wait_for_timeout(600)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(600)
    sm = pg.inner_text("#startSummary")
    check("イニング" in sm and "数える" in sm, "「イニング 数える」が出る", sm[:250])
    pick_innings(pg, False)
    sm2 = pg.inner_text("#startSummary")
    check("数えない" in sm2, "切り替えると「数えない」に変わる", sm2[:250])

    section("10. 種目を変えると既定に戻る")
    helpers.pick_game(pg, "8ball")
    pg.wait_for_timeout(600)
    f = pg.evaluate(FIELD)
    check(f and f["btns"][0]["on"], "別の種目に移ると「数える」に戻る", f)

    # ================= 11. 横向きでも壊れない =================
    section("11. 横向きで「数えない」")
    # 横向きはラック数とイニング数を上の帯へ移す作り。
    # 隠したイニングが帯に空の場所を作らないことを確かめる
    pl = br.new_page(viewport={"width": 844, "height": 390})
    e2 = []
    pl.on("pageerror", lambda e: e2.append(str(e)))
    pl.goto(URL)
    pl.wait_for_timeout(700)
    start(pl, "9ball", False)
    r = pl.evaluate("""() => {
      const inn = document.getElementById('inningInfo');
      const rack = document.getElementById('rackInfo');
      const bar = document.querySelector('#screenMatch .topbar');
      const sb = document.querySelector('#screenMatch .scoreboard');
      const bb = document.querySelector('#screenMatch .bottom-bar');
      const h = window.innerHeight;
      return {innHidden: inn.hidden,
              innW: Math.round(inn.getBoundingClientRect().width),
              rackShown: !rack.hidden,
              rackInBar: !!rack.closest('#screenMatch .topbar'),
              sbH: Math.round(sb.getBoundingClientRect().height),
              barOver: Math.round(bb.getBoundingClientRect().bottom - h)};
    }""")
    print("   " + str(r))
    check(r["innHidden"], "横向きでもイニングが隠れている", r)
    check(r["innW"] == 0, "隠れた欄が場所を取っていない", r)
    check(r["rackShown"] and r["rackInBar"], "ラック数は帯に出ている", r)
    check(r["barOver"] <= 0, "下の帯が画面内に収まっている", r)
    check(not e2, "横向きでJSエラーなし", e2[:3])
    pl.screenshot(path=os.path.join(SHOTS, "innings_off_land.png"))
    pl.close()

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
