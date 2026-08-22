# -*- coding: utf-8 -*-
"""fix_match_test.py — 試合画面の手直し（本人の指示 2026-08-22）

本人の言葉:
  1.「横向きにすると点数入力したあとの表示が長いので、数字のカウントと
     ボールの透過だけのアクションにして、ボールを連続で押せるようにして」
  2.「スコアシートボタンは押したらぱっと画面に大きく開くようにして。
     現状は縦に狭すぎて見づらい」
  3.「エースを押すとマスワリも増えるので切り離してください。別物です」
  4.「マスワリもエースも押してもスコアボードの点数が増えないようにしてください。
     カウントを記録するのみのボタンとします」
  5.「無効球を押しても試合画面上で今何個あるのかわからないので、
     カウントが表示されるように」
  6.「球を入れたらその人のスコアをタップ」の案内と、
     交代ボタンの下のマスワリ表示を削除

3・4 は flag_jpa_test.py が数え方そのものを見る。ここでは画面の見え方と、
横向きの連続入力、スコアシートの開き方を見る。

実行: python _test/fix_match_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"

PORT = {"width": 390, "height": 844}
LAND = {"width": 844, "height": 390}

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def start(pg, gid, sl=False):
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, gid)
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    if pg.locator("#inNameB").count():
        pg.fill("#inNameB", "あいて")
    if sl:
        pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL7").click()
        pg.wait_for_timeout(150)
        pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)


with sync_playwright() as p:
    br = p.chromium.launch()
    errs = []

    # ================================================================
    section("1. 横向きのローテーション：連続で押せる")
    pg = br.new_page(viewport=LAND)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)
    start(pg, "rotation")

    check(pg.is_visible("#ballGrid"), "盤面が出ている")
    # 押せる大きさ（44px）が保たれているか
    h = pg.eval_on_selector("#ballGrid .ball-btn", "e => e.getBoundingClientRect().height")
    check(h >= 40, "球のボタンの高さが確保されている", h)

    before = pg.inner_text("#scoreA") if pg.is_visible("#scoreA") else "0"
    # 1・2・3番を続けて押す（間はごく短く。通知が出ていると次を押しにくい）
    for b in (1, 2, 3):
        pg.click('#ballGrid .ball-btn[data-ball="%d"]' % b)
        pg.wait_for_timeout(80)
    pg.wait_for_timeout(120)

    shown = pg.eval_on_selector("#scoreA", "e => e.textContent") \
        + "/" + pg.eval_on_selector("#scoreB", "e => e.textContent")
    total = pg.evaluate("""() => {
      const m = STORE.findOngoing();
      return m.events.filter(e => e.t === 'POCKET')
        .reduce((s, e) => s + (e.d.balls || []).length, 0);
    }""")
    check(total == 3, "3球ぶん記録されている", total)
    # 1+2+3 = 6点。数字がその場で増えている（画面を作り直さなくても）
    check("6" in shown, "数字が6点に増えている", shown)

    gone = pg.eval_on_selector_all(
        '#ballGrid .ball-btn.gone', "e => e.map(x => x.getAttribute('data-ball'))")
    check(set(gone) >= {"1", "2", "3"}, "押した球が薄くなっている（透過）", gone)
    dis = pg.eval_on_selector('#ballGrid .ball-btn[data-ball="1"]', "e => e.disabled")
    check(dis, "押した球はもう押せない", dis)

    # 通知（トースト）が出ていないこと。これが数秒残るのが本人の困りごと
    toasts = pg.eval_on_selector_all("#toastArea .toast, .toast", "e => e.length")
    check(toasts == 0, "横向きでは通知が出ない", toasts)

    section("1b. 縦向きは今までどおり（通知が出る）")
    pg2 = br.new_page(viewport=PORT)
    pg2.on("pageerror", lambda e: errs.append(str(e)))
    pg2.goto(URL)
    pg2.wait_for_timeout(600)
    start(pg2, "rotation")
    pg2.click('#ballGrid .ball-btn[data-ball="1"]')
    pg2.wait_for_timeout(250)
    t2 = pg2.eval_on_selector_all("#toastArea .toast, .toast", "e => e.length")
    check(t2 >= 1, "縦向きでは今までどおり通知が出る", t2)

    # ================================================================
    section("2. JPAのスコアシートが画面に重なって大きく開く")
    pg3 = br.new_page(viewport=PORT)
    pg3.on("pageerror", lambda e: errs.append(str(e)))
    pg3.goto(URL)
    pg3.wait_for_timeout(600)
    start(pg3, "jpa_9ball", sl=True)

    check(pg3.is_visible("#sheetBtn"), "スコアシートのボタンがある")
    check(pg3.locator("#sheetModal").count() == 0
          or pg3.eval_on_selector("#sheetModal", "e => e.hidden"),
          "最初は開いていない")
    pg3.click("#sheetBtn")
    pg3.wait_for_timeout(400)
    check(pg3.locator("#sheetModal").count() == 1, "重ねの箱ができる")
    check(pg3.is_visible("#sheetModal"), "重ねて開く")
    inside = pg3.evaluate(
        "() => !!document.querySelector('#sheetModal #sheetArea')")
    check(inside, "スコアシートが重ねの中に入っている")

    box = pg3.eval_on_selector("#sheetArea", "e => e.getBoundingClientRect().height")
    vh = pg3.evaluate("() => window.innerHeight")
    check(box > vh * 0.45, "縦を大きく使っている（画面の45%超）", (box, vh))
    # 升目が読める大きさか
    cell = pg3.eval_on_selector(".sheet-cell", "e => e.getBoundingClientRect().height")
    check(cell >= 26, "升目が潰れていない", cell)

    # 背景をタップすると閉じ、ボタンの文言も戻る
    pg3.eval_on_selector("#sheetModal", "e => e.click()")
    pg3.wait_for_timeout(300)
    check(pg3.eval_on_selector("#sheetModal", "e => e.hidden"), "背景を押すと閉じる")
    check("スコアシート" in (pg3.text_content("#sheetBtn") or ""),
          "ボタンの文言が戻る", pg3.text_content("#sheetBtn"))
    back = pg3.evaluate(
        "() => !!document.querySelector('#screenMatch #sheetArea')")
    check(back, "閉じたら元の場所に戻る")

    # 開いている間は、後ろのボタンを誤って押せない（重ねが受け止める）
    pg3.click("#sheetBtn")
    pg3.wait_for_timeout(300)
    blocked = pg3.evaluate('''() => {
      const b = document.getElementById('quitMatchBtn').getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!(top && top.closest('#sheetModal'));
    }''')
    check(blocked, "開いている間は後ろのボタンを押せない", blocked)
    # 開いたまま試合画面を離れても、他の画面に残らない
    pg3.evaluate("() => MATCH.close()")
    pg3.wait_for_timeout(300)
    check(pg3.eval_on_selector("#sheetModal", "e => e.hidden"),
          "試合画面を離れたら重ねも閉じる")

    section("2b. 横向きでも読める")
    pg4 = br.new_page(viewport=LAND)
    pg4.on("pageerror", lambda e: errs.append(str(e)))
    pg4.goto(URL)
    pg4.wait_for_timeout(600)
    start(pg4, "jpa_9ball", sl=True)
    pg4.click("#sheetBtn")
    pg4.wait_for_timeout(400)
    h4 = pg4.eval_on_selector("#sheetArea", "e => e.getBoundingClientRect().height")
    check(h4 > 200, "横向きでもシートに高さが回る（以前は83px）", h4)
    c4 = pg4.eval_on_selector_all(".sheet-cell", "e => e.length")
    check(c4 > 0, "升目が出ている", c4)

    # ================================================================
    section("5・6. 無効球のカウントと、消したもの")
    pg5 = br.new_page(viewport=PORT)
    pg5.on("pageerror", lambda e: errs.append(str(e)))
    pg5.goto(URL)
    pg5.wait_for_timeout(600)
    start(pg5, "jpa_9ball", sl=True)

    check(not pg5.is_visible("#masuwariInfo"), "交代ボタンの下のマスワリ表示が無い")
    hint = (pg5.text_content("#tapHint") or "").strip()
    check("スコアをタップ" not in hint, "真ん中の案内が消えている", hint)
    check(not pg5.is_visible("#tapHint"), "案内の行そのものが出ていない")

    check(pg5.locator("#deadInfo").count() == 1, "無効球の欄がある")
    check(not pg5.is_visible("#deadInfo"), "0個のうちは出さない")
    pg5.click("#deadBallBtn")
    pg5.wait_for_timeout(350)
    check(pg5.is_visible("#deadInfo"), "押すと出る")
    d1 = pg5.inner_text("#deadInfo")
    check("1" in d1, "1個と読める", d1)
    pg5.click("#deadBallBtn")
    pg5.wait_for_timeout(350)
    d2 = pg5.inner_text("#deadInfo")
    check("2" in d2, "2個に増える", d2)
    btx = pg5.inner_text("#deadBallBtn")
    check("2" in btx, "ボタンにも個数が出る", btx)

    # マスワリを押しても、点も表示も増えない（4の見た目側）
    sc_before = pg5.inner_text("#scoreA")
    who = pg5.inner_text("#breakBannerName").strip()
    sd = "A" if who == "たいら" else "B"
    pg5.locator("#panelFlags" + sd + " button", has_text="マスワリ").click()
    pg5.wait_for_timeout(400)
    check(pg5.inner_text("#scoreA") == sc_before, "マスワリで点が増えない",
          (sc_before, pg5.inner_text("#scoreA")))
    check(not pg5.is_visible("#masuwariInfo"),
          "マスワリを記録しても下の表示は出ない")

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("==== %d/%d 成功 ====" % (len(results) - len(ng), len(results)))
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
