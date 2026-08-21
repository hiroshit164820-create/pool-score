# -*- coding: utf-8 -*-
"""新機能の検証（JPA・3先・プレーヤー登録・スタッツ・チェスクロック・ターン交代）

実行: python _test/features_test.py
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
    print("\n── " + name + " ──")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(400)

    # ================= 勝利条件 =================
    section("よく使う勝利条件は3〜7先のボタン")
    labels = pg.locator("#goalArea .goal-picker .chip").all_text_contents()
    check(labels == ["3先", "4先", "5先", "6先", "7先"],
          "9ボールに3〜7先のボタンが並ぶ", labels)
    helpers.set_goal(pg, 3)
    check(helpers.goal_value(pg) == 3, "3先を押すと3になる", helpers.goal_value(pg))

    helpers.pick_game(pg, "10ball")
    pg.wait_for_timeout(200)
    labels10 = pg.locator("#goalArea .goal-picker .chip").all_text_contents()
    check("3先" in labels10, "10ボールにも3先がある", labels10)

    # ================= JPA =================
    section("JPAルール")
    games = helpers.all_game_labels(pg)
    check(any("JPA" in g for g in games), "JPA種目が選べる", games)
    check("JPA 9ボール" in games, "JPA 9ボールがある")
    check("JPA 8ボール" in games, "JPA 8ボールがある")

    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(300)
    goal_text = pg.text_content("#goalArea") or ""
    check("スキルレベル" in goal_text, "スキルレベルを選ぶUIになる")

    # SL7 vs SL5 → 55点 vs 38点（JPA公式表）
    chips = pg.locator("#goalArea .field").nth(0).locator(".chip")
    chips.nth(6).click()  # SL7
    pg.wait_for_timeout(200)
    chips2 = pg.locator("#goalArea .field").nth(1).locator(".chip")
    chips2.nth(4).click()  # SL5
    pg.wait_for_timeout(250)
    res = pg.text_content(".jpa-result") or ""
    check("55" in res and "38" in res, "SL7→55点 / SL5→38点（公式表どおり）", res)

    # JPA 8ボールは対戦表から先取ゲーム数
    helpers.pick_game(pg, "jpa_8ball")
    pg.wait_for_timeout(300)
    sl8 = pg.locator("#goalArea .field").nth(0).locator(".chip").all_text_contents()
    check(sl8 == ["SL2", "SL3", "SL4", "SL5", "SL6", "SL7"], "8ボールはSL2〜7", sl8)
    pg.locator("#goalArea .field").nth(0).locator(".chip").nth(5).click()  # SL7
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip").nth(0).click()  # SL2
    pg.wait_for_timeout(250)
    res8 = pg.text_content(".jpa-result") or ""
    check("7" in res8 and "2" in res8, "SL7 vs SL2 → 7先 vs 2先", res8)
    pg.screenshot(path=os.path.join(SHOTS, "40_jpa.png"), full_page=True)

    # ================= プレーヤー登録 =================
    section("プレーヤー登録")
    pg.click("#toPlayersBtn2")
    pg.wait_for_timeout(300)
    check(pg.is_visible("#screenPlayers"), "プレーヤー画面が開く")

    for name in ["山田", "佐藤", "鈴木"]:
        helpers.add_player(pg, name)
    check(pg.locator("#playerList .match-card").count() == 3, "3人登録された",
          pg.locator("#playerList .match-card").count())

    # 重複登録は弾かれる
    helpers.add_player(pg, "山田")
    check(pg.locator("#playerList .match-card").count() == 3, "同じ名前は重複登録されない")
    pg.screenshot(path=os.path.join(SHOTS, "41_players.png"), full_page=True)

    # ================= プレーヤー選択 =================
    section("試合作成で登録名を選べる")
    # 選手一覧の「新しい試合」は本人の指示（2026-08-20）で撤去したので下部タブを使う
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(250)
    pickers = pg.locator("#playerFields .picker .chip").all_text_contents()
    check("山田" in pickers, "登録した名前が選択肢に出る", pickers)
    helpers.pick_player(pg, 0, "山田")
    check(pg.input_value("#inNameA") == "山田", "押すと名前欄に入る", pg.input_value("#inNameA"))
    helpers.pick_player(pg, 1, "佐藤")

    # ================= チェスクロック =================
    section("チェスクロック")
    types = pg.locator("#clockTypeToggle button").all_text_contents()
    check(len(types) == 3, "時計は3択（使わない／ショット／チェス）", types)

    pg.click('#clockTypeToggle button[data-v="chess"]')
    pg.wait_for_timeout(250)
    check(pg.is_visible("#ccMinutes"), "チェスクロックの設定が出る")
    check(not pg.is_visible("#scSeconds"), "ショットクロックの設定は隠れる")

    pg.fill("#ccMinutes", "10")
    pg.fill("#ccWarn", "30")
    helpers.set_goal(pg, 3)
    pg.wait_for_timeout(150)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)

    check(pg.is_visible("#chessClockBar"), "試合画面にチェスクロックが出る")
    check(not pg.is_visible("#shotClockBar"), "ショットクロックは出ない")
    # 開始直後は1秒動いていることがあるので、10:00か9:59なら合格にする
    check(pg.text_content("#ccTimeA") in ("10:00", "9:59"),
          "Aの持ち時間が10:00", pg.text_content("#ccTimeA"))
    check(pg.text_content("#ccNameA") == "山田", "名前が出る", pg.text_content("#ccNameA"))

    active = pg.evaluate("() => document.querySelector('#ccSideA').classList.contains('active')")
    check(active, "先攻側の時計が動いている")

    # 時間が減るか
    t0 = pg.text_content("#ccTimeA")
    pg.wait_for_timeout(2200)
    t1 = pg.text_content("#ccTimeA")
    check(t0 != t1, "時間が減っている", t0 + " → " + t1)
    b_time = pg.text_content("#ccTimeB")
    check(b_time == "10:00", "相手の時計は減っていない", b_time)

    # ================= ターン交代 =================
    section("ターン交代ボタン")
    check(pg.is_visible("#turnBtn"), "交代ボタンが出ている")
    check("佐藤" in (pg.text_content("#turnBtn") or ""), "次の人の名前が出る", pg.text_content("#turnBtn"))

    pg.click("#turnBtn")
    pg.wait_for_timeout(500)
    activeB = pg.evaluate("() => document.querySelector('#ccSideB').classList.contains('active')")
    check(activeB, "交代でBの時計が動き出す")
    check("山田" in (pg.text_content("#turnBtn") or ""), "ボタンの表示が入れ替わる", pg.text_content("#turnBtn"))

    a_stopped = pg.text_content("#ccTimeA")
    pg.wait_for_timeout(1500)
    check(pg.text_content("#ccTimeA") == a_stopped, "交代後、Aの時計は止まっている")
    pg.screenshot(path=os.path.join(SHOTS, "42_chess.png"), full_page=True)

    # 一時停止
    pg.click("#ccPauseBtn")
    pg.wait_for_timeout(300)
    paused = pg.text_content("#ccTimeB")
    pg.wait_for_timeout(1500)
    check(pg.text_content("#ccTimeB") == paused, "一時停止中は減らない")
    pg.click("#ccPauseBtn")
    pg.wait_for_timeout(300)

    # ================= スタッツ =================
    section("プレーヤー別スタッツ")
    # 試合を終わらせる（3先なのでAが3回タップ）
    for _ in range(3):
        pg.click("#panelA")
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(300)
    if pg.is_visible("#confirmFinishBtn"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(500)

    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    card = pg.locator("#playerList .match-card").filter(has_text="山田").first
    txt = card.text_content() or ""
    check("1勝" in txt, "山田に1勝が記録される", txt[:60])

    pg.click("#tabStats")
    pg.wait_for_timeout(400)
    check(pg.is_visible("#screenStats"), "成績画面が開く")
    stats_txt = pg.text_content("#statsBody") or ""
    check("山田" in stats_txt and "佐藤" in stats_txt, "登録者が並ぶ")

    # 個人詳細
    pg.locator("#statsBody .match-card").filter(has_text="山田").first.click()
    pg.wait_for_timeout(400)
    detail = pg.text_content("#statsBody") or ""
    check("勝率" in detail, "勝率が出る")
    check("ラック取得率" in detail, "ラック取得率が出る")
    check("マスワリ" in detail, "マスワリが出る")
    check("対戦相手別" in detail, "対戦相手別の成績が出る")
    check("佐藤" in detail, "対戦相手の名前が出る")
    pg.screenshot(path=os.path.join(SHOTS, "43_stats.png"), full_page=True)

    # ================= ショットクロックの平均タイム =================
    section("ショットクロックの平均タイム")
    pg.click("#backFromStatsBtn")
    pg.wait_for_timeout(300)
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_player(pg, 0, "鈴木")
    helpers.pick_player(pg, 1, "佐藤")
    pg.click('#clockTypeToggle button[data-v="shot"]')
    pg.wait_for_timeout(200)
    pg.fill("#scSeconds", "60")
    helpers.set_goal(pg, 3)
    pg.wait_for_timeout(150)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)

    # 数秒おきに交代して、ショット時間を記録させる
    for _ in range(3):
        pg.wait_for_timeout(1600)
        pg.click("#turnBtn")
        pg.wait_for_timeout(300)
    for _ in range(3):
        pg.click("#panelA")
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(300)
    if pg.is_visible("#confirmFinishBtn"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(500)

    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    pg.click("#tabStats")
    pg.wait_for_timeout(300)
    pg.locator("#statsBody .match-card").filter(has_text="鈴木").first.click()
    pg.wait_for_timeout(400)
    d2 = pg.text_content("#statsBody") or ""
    check("平均タイム" in d2, "平均タイムの項目が出る")
    has_sec = "秒" in d2
    check(has_sec, "平均タイムに秒数が入っている", d2[:200] if not has_sec else "")
    pg.screenshot(path=os.path.join(SHOTS, "44_avgtime.png"), full_page=True)

    # ================= エラー =================
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
