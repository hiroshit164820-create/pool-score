# -*- coding: utf-8 -*-
"""kailun_test.py — カイルンの検証（複数人対応版）

カイルンは NBA 競技規程に章が無いハウスゲーム。
2026-08-21 の指示で「3人以上でも遊べる」「交代のボタンは1つ」
「成功のボタンは押すたびに表示が変わる」「スコアをタッチして加減点」
「1回の手順で／ミスしたときの選択は削除」に作り直した。
A/B2サイド前提の engine には人数を増やせないため、
5-9 / 5-10 と同じく専用画面（js/ui_kailun.js）で持っている。

対象:
  1. 種目一覧に出る／選ぶと専用の設定画面へ行く
  2. 3人以上を登録できる
  3. 「1回の手順で」「ミスしたとき」の選択が無い（反則の扱いは残す）
  4. 成功のボタンが押すたびに変わり、3段階で1点になる
  5. 交代のボタンは1つだけ／成功のボタンがいちばん大きい
  6. 交代すると段階が最初に戻り、次の人へ回る
  7. スコアをタップで+1、長押しで-1
  8. 反則の扱い（自分-1／他の人+1）が効く
  9. 元に戻せる
 10. 勝ちが出て、記録が残る

実行: python _test/kailun_test.py
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


def ok_text(pg):
    return (pg.text_content(".kl-ok .kl-ok-text") or "").strip()


def who(pg):
    return (pg.text_content(".kl-who-name") or "").strip()


def step_no(pg):
    return (pg.text_content(".kl-who-step") or "").strip()


def score_of(pg, name):
    return pg.evaluate("""(nm) => {
      const el = [...document.querySelectorAll('#kailunScores .kl-score')]
        .find(b => b.querySelector('.kl-name').textContent.trim() === nm);
      return el ? el.querySelector('.kl-val').textContent.trim() : null;
    }""", name)


def start_game(pg, names, penalty=None, goal=None):
    """カイルンを人数ぶんの名前で始める"""
    # カイルンの画面にいるときは種目一覧が出ていないので、設定画面へ戻す
    pg.evaluate("() => UI.showScreen('screenSetup')")
    pg.wait_for_timeout(250)
    helpers.pick_game(pg, "kailun")
    pg.wait_for_timeout(400)
    while pg.locator("#kailunPlayers input[type=text]").count() < len(names):
        pg.click("#kailunAddBtn")
        pg.wait_for_timeout(150)
    ins = pg.locator("#kailunPlayers input[type=text]")
    for i, n in enumerate(names):
        ins.nth(i).fill(n)
    pg.wait_for_timeout(150)
    if penalty:
        pg.click('#kailunPenalty .chip:text-is("%s")' % penalty)
        pg.wait_for_timeout(150)
    if goal:
        pg.click('#kailunGoal .chip:text-is("%d点先取")' % goal)
        pg.wait_for_timeout(150)
    pg.click("#kailunStartBtn")
    pg.wait_for_timeout(400)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================= 1 =================
    section("1. 種目一覧と専用画面")
    labels = helpers.all_game_labels(pg)
    check("カイルン" in labels, "種目一覧にカイルンがある", labels)
    helpers.pick_game(pg, "kailun")
    pg.wait_for_timeout(400)
    now = pg.evaluate("() => document.querySelector('section.screen.active').id")
    check(now == "screenKailunSetup", "選ぶとカイルンの設定画面へ行く", now)

    # ================= 2 =================
    section("2. 3人以上を登録できる")
    check(pg.locator("#kailunPlayers input[type=text]").count() == 2, "はじめは2人ぶん")
    pg.click("#kailunAddBtn")
    pg.wait_for_timeout(200)
    check(pg.locator("#kailunPlayers input[type=text]").count() == 3, "人を増やせる")
    for _ in range(5):
        if not pg.locator("#kailunAddBtn").is_disabled():
            pg.click("#kailunAddBtn")
            pg.wait_for_timeout(120)
    n_max = pg.locator("#kailunPlayers input[type=text]").count()
    check(n_max == 6, "6人まで増やせる", n_max)
    check(pg.locator("#kailunAddBtn").is_disabled(), "6人でそれ以上は増やせない")

    # ================= 3 =================
    section("3. 削除した選択が無い")
    body = pg.inner_text("#screenKailunSetup")
    check("1回の手番で" not in body and "1回の手順で" not in body,
          "「1回の手順で」の選択が無い", body[:200])
    check("ミスしたとき" not in body, "「ミスしたとき」の選択が無い", body[:200])
    check("反則のとき" in body, "「反則のとき」は残っている")
    pg.screenshot(path=os.path.join(SHOTS, "kailun_setup.png"), full_page=True)

    # ================= 4・5 =================
    section("4/5. 成功のボタンと段階")
    start_game(pg, ["たいら", "たかのぶ", "みなみ"])
    check(pg.evaluate("() => document.querySelector('section.screen.active').id")
          == "screenKailunMatch", "試合画面へ行く")
    check(who(pg) == "たいら", "1人目から始まる", who(pg))
    check(step_no(pg) == "1 / 3段目", "最初は1段目", step_no(pg))
    check(ok_text(pg) == "赤→黄 or 黄→赤", "1段目の表示", ok_text(pg))

    pg.click(".kl-ok")
    pg.wait_for_timeout(250)
    check(ok_text(pg) == "赤→赤", "押すと2段目の表示に変わる", ok_text(pg))
    check(score_of(pg, "たいら") == "0", "途中では点にならない", score_of(pg, "たいら"))

    pg.click(".kl-ok")
    pg.wait_for_timeout(250)
    check(ok_text(pg) == "全部（1点）", "3段目の表示", ok_text(pg))

    pg.click(".kl-ok")
    pg.wait_for_timeout(250)
    check(score_of(pg, "たいら") == "1", "3段目を成功で1点", score_of(pg, "たいら"))
    check(ok_text(pg) == "赤→黄 or 黄→赤", "点が入ると1段目の表示に戻る", ok_text(pg))
    check(who(pg) == "たいら", "点を取っても続けて撞ける", who(pg))

    # ボタンの数と大きさ
    subs = pg.locator("#kailunPad .kl-sub").all_text_contents()
    check(subs.count("交代") == 1, "交代のボタンは1つだけ", subs)
    size = pg.evaluate("""() => {
      const ok = document.querySelector('.kl-ok').getBoundingClientRect();
      const sub = document.querySelector('.kl-sub').getBoundingClientRect();
      return {ok: Math.round(ok.width * ok.height), sub: Math.round(sub.width * sub.height)};
    }""")
    check(size["ok"] > size["sub"] * 2, "成功のボタンがいちばん大きい", size)
    pg.screenshot(path=os.path.join(SHOTS, "kailun_match.png"))

    # ================= 6 =================
    section("6. 交代")
    pg.click(".kl-ok")
    pg.wait_for_timeout(200)
    check(step_no(pg) == "2 / 3段目", "2段目まで進む", step_no(pg))
    pg.click('#kailunPad .kl-sub:text-is("交代")')
    pg.wait_for_timeout(250)
    check(who(pg) == "たかのぶ", "次の人に回る", who(pg))
    check(step_no(pg) == "1 / 3段目", "交代すると1段目に戻る", step_no(pg))
    pg.click('#kailunPad .kl-sub:text-is("交代")')
    pg.wait_for_timeout(250)
    check(who(pg) == "みなみ", "3人目にも回る", who(pg))
    pg.click('#kailunPad .kl-sub:text-is("交代")')
    pg.wait_for_timeout(250)
    check(who(pg) == "たいら", "3人目の次は1人目に戻る", who(pg))

    # ================= 7 =================
    section("7. スコアをタップして加減点")
    before = score_of(pg, "みなみ")
    pg.click('#kailunScores .kl-score:has(.kl-name:text-is("みなみ"))')
    pg.wait_for_timeout(250)
    check(score_of(pg, "みなみ") == str(int(before) + 1), "タップで1点入る",
          score_of(pg, "みなみ"))
    # 通知が出ている間は画面が下にずれる（帯の下に場所を空けて出す作りのため）。
    # 消えてから位置を測らないと、押している最中にボタンが動いて長押しが外れる
    pg.wait_for_timeout(1500)
    box = pg.locator('#kailunScores .kl-score:has(.kl-name:text-is("みなみ"))')
    b = box.bounding_box()
    pg.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    pg.mouse.down()
    pg.wait_for_timeout(900)
    pg.mouse.up()
    pg.wait_for_timeout(250)
    check(score_of(pg, "みなみ") == before, "長押しで1点戻る", score_of(pg, "みなみ"))

    # ================= 8 =================
    section("8. 反則の扱い")
    start_game(pg, ["山田", "佐藤"], penalty="自分が-1点")
    pg.click('#kailunPad .kl-sub:text-is("反則")')
    pg.wait_for_timeout(250)
    check(score_of(pg, "山田") == "-1", "自分が1点減る", score_of(pg, "山田"))
    check(score_of(pg, "佐藤") == "0", "相手は変わらない", score_of(pg, "佐藤"))
    check(who(pg) == "佐藤", "反則すると交代する", who(pg))

    start_game(pg, ["山田", "佐藤", "鈴木"], penalty="他の人に+1点")
    pg.click('#kailunPad .kl-sub:text-is("反則")')
    pg.wait_for_timeout(250)
    check(score_of(pg, "山田") == "0", "自分は変わらない", score_of(pg, "山田"))
    check(score_of(pg, "佐藤") == "1" and score_of(pg, "鈴木") == "1",
          "他の人が全員1点もらう",
          (score_of(pg, "佐藤"), score_of(pg, "鈴木")))

    # ================= 9 =================
    section("9. 元に戻す")
    pg.click("#kailunUndoBtn")
    pg.wait_for_timeout(250)
    check(score_of(pg, "佐藤") == "0", "反則を取り消せる", score_of(pg, "佐藤"))
    check(who(pg) == "山田", "手番も戻る", who(pg))

    # ================= 10 =================
    section("10. 勝ちと記録")
    start_game(pg, ["優勝", "次点"], goal=3)
    for _ in range(9):  # 3段階×3回＝3点
        if pg.locator(".kl-ok").count() == 0:
            break
        pg.click(".kl-ok")
        pg.wait_for_timeout(140)
    check(score_of(pg, "優勝") == "3", "3点取れる", score_of(pg, "優勝"))
    check(pg.locator(".kl-win").count() == 1, "勝ちが出る")
    pg.click(".kl-finish")
    pg.wait_for_timeout(600)
    saved = pg.evaluate("""() => {
      const all = JSON.parse(localStorage.getItem('pool_money_results') || '[]');
      const k = all.filter(m => m.gameId === 'kailun');
      return k.length ? {n: k.length, top: k[0].players[0]} : null;
    }""")
    check(saved and saved["top"]["name"] == "優勝" and saved["top"]["score"] == 3,
          "記録が残る", saved)

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
