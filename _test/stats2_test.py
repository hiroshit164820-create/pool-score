# -*- coding: utf-8 -*-
"""stats2_test.py — JPA・成績・履歴の指示14件の検証（2026-08-20）

対象:
  16. イニング数・セーフティ数の合計を記録・表示（試合中／結果／履歴）
  17. JPAスコアシートが開閉式（既定は閉じ）
  18. JPA9ボールで手動で次のラックへ進める＋シートに区切りが残る
  19. ラックの区切りが明るいオレンジ枠＋斜線
  20. マスワリの自動記録と合計表示（出るまでは非表示）
  21. JPA独自の得点換算表でのポイント表示
  22. 履歴のJPA試合で名前のうしろにSL
  23/24. 種目ごとの成績は削除済み（入口も画面も無いことを確かめる）
  26. 履歴を種目・対戦相手で絞れる
  27. 進行中マークが名前と同じ行の右
  28. 操作ボタンが1行に収まる
  29. 表計算（CSV）への書き出し

実行: python _test/stats2_test.py
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


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ===================== JPA 9ボールの試合 =====================
    section("17/18/19/20/21 JPA 9ボール")
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "タイラ")
    pg.fill("#inNameB", "岸川")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL3").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL5").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)

    # --- 17 スコアシートの開閉 ---
    # 2026-08-21 に開閉ボタンを下の帯（#sheetBtn）へ移した（本人の指示）
    check(pg.is_visible("#sheetBtn"), "スコアシートの開閉ボタンがある")
    check(pg.eval_on_selector("#sheetBtn", "e => e.getAttribute('aria-pressed')") == "false",
          "既定は閉じている")
    check(pg.eval_on_selector_all(".sheet-grid", "e => e.length") == 0, "閉じているとマス目が出ない")
    pg.click("#sheetBtn")
    pg.wait_for_timeout(400)
    check(pg.eval_on_selector_all(".sheet-grid", "e => e.length") == 2, "押すと開く")
    pg.click("#sheetBtn")
    pg.wait_for_timeout(200)
    check(pg.eval_on_selector_all(".sheet-grid", "e => e.length") == 0, "もう一度押すと閉じる")

    # --- 16 試合中の表示 ---
    check(pg.is_visible("#inningInfo"), "試合中にイニング数が出ている")
    # セーフティ数は指示どおり試合結果・成績・履歴に出す。
    # 試合中の帯に足すと3行に折り返し、下の操作ボタンが画面外へ出るため置いていない
    check(pg.locator("#safetyInfo").count() == 0, "試合中の帯にはセーフティを置かない")
    check(not pg.is_visible("#masuwariInfo"), "マスワリは出るまで非表示")

    # --- 18 手動で次のラックへ ---
    check(pg.is_visible("#nextRackBtn"), "「次のラックへ」ボタンがある")
    rack_before = pg.inner_text("#rackInfo")
    # JPA 9ボールはスコア欄のタップで球1個ぶんを記録する
    who = pg.inner_text("#breakBannerName").strip()
    panel = "#panelA" if who == "タイラ" else "#panelB"
    pg.click(panel)
    pg.wait_for_timeout(250)
    pg.click("#nextRackBtn")
    pg.wait_for_timeout(300)
    rack_after = pg.inner_text("#rackInfo")
    check(rack_before != rack_after, "手動でラックが進む", (rack_before, rack_after))

    pg.click("#sheetBtn")
    pg.wait_for_timeout(250)
    check(pg.eval_on_selector_all(".sheet-cell.rack-end", "e => e.length") >= 1,
          "スコアシートに区切りの印が残る")

    # --- 19 区切りの見た目 ---
    style = pg.eval_on_selector(".sheet-cell.rack-end",
                                "e => ({shadow: getComputedStyle(e).boxShadow,"
                                " img: getComputedStyle(e).backgroundImage})")
    check("255, 140, 26" in style["shadow"], "明るいオレンジの枠", style["shadow"])
    check("repeating-linear-gradient" in style["img"], "斜線が入っている", style["img"][:60])
    pg.click("#sheetBtn")
    pg.wait_for_timeout(150)

    # --- 20 マスワリの自動記録 ---
    # いまブレイクしている側が、一度も交代せずに9番まで入れればマスワリ
    who2 = pg.inner_text("#breakBannerName").strip()
    panel2 = "#panelA" if who2 == "タイラ" else "#panelB"
    for _ in range(9):
        if pg.eval_on_selector(panel2, "e => e.disabled"):
            break
        pg.click(panel2)
        pg.wait_for_timeout(140)
    pg.wait_for_timeout(400)
    masu_visible = pg.is_visible("#masuwariInfo")
    masu_text = pg.inner_text("#masuwariInfo") if masu_visible else ""
    check(masu_visible, "マスワリが出たら合計が表示される", masu_text)
    check("マスワリ" in masu_text, "合計が読める", masu_text)

    # 決着まで進める
    for _ in range(60):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        cur = pg.inner_text("#breakBannerName").strip()
        pn = "#panelA" if cur == "タイラ" else "#panelB"
        if pg.eval_on_selector(pn, "e => e.disabled"):
            break
        pg.click(pn)
        pg.wait_for_timeout(110)
    pg.wait_for_timeout(400)

    check(not pg.eval_on_selector("#finishModal", "e => e.hidden"), "決着して終了画面が出る")
    ftxt = pg.inner_text("#finishSummary")
    print("   終了画面: " + ftxt.replace("\n", " / ")[:220])
    check("イニング数" in ftxt, "結果にイニング数が出る", ftxt[:100])
    check("セーフティ数" in ftxt, "結果にセーフティ数が出る", ftxt[:100])
    # 見出しは1行に収めるため「JPAポイント」に短くした（本人の指示 2026-08-20 第3便）
    check("JPAポイント" in ftxt, "結果にJPAポイントが出る（得点換算表）", ftxt[:180])
    check("勝敗（W-L）" in ftxt, "結果にW-Lが出る", ftxt[:180])
    check("獲得スコア" in ftxt, "結果に獲得スコアが出る", ftxt[:180])
    if "JPAポイント" in ftxt:
        tail = ftxt.split("JPAポイント")[1]
        check("P" in tail, "ポイントの数字が入っている", tail[:60])
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(700)

    # ===================== 履歴 =====================
    section("22/26/27/28 履歴")
    check(pg.is_visible("#screenHistory"), "履歴が開く")
    sls = pg.eval_on_selector_all(".match-card .mc-sl", "e => e.map(x => x.textContent)")
    check(len(sls) >= 2, "JPAの試合で名前のうしろにSLが出る", sls)
    stats_line = pg.eval_on_selector_all(".match-card .mc-stats", "e => e.map(x => x.textContent)")
    check(any("イニング" in s for s in stats_line), "履歴にイニング数が出る", stats_line)
    # JPAポイントは 2026-08-21 から専用の行（.mc-jpa）に、「P」を付けずに出す
    jpa_line = pg.eval_on_selector_all(".match-card .mc-jpa", "e => e.map(x => x.textContent)")
    check(len(jpa_line) >= 1, "履歴にJPAポイントが出る", jpa_line)
    check(not any("P" in s.replace("JPAポイント", "") for s in jpa_line),
          "JPAポイントに「P」を付けない", jpa_line)

    foot_rows = pg.eval_on_selector(".match-card .mc-foot",
                                    "e => new Set(Array.from(e.children)"
                                    ".map(c => Math.round(c.getBoundingClientRect().top))).size")
    check(foot_rows == 1, "操作ボタンが1行に収まっている", foot_rows)

    # 決着した試合は名前のうしろのW/Lで分かるようにした（第2便）。
    # 進行中の印だけが右端のバッジとして残る
    wl_in_main = pg.eval_on_selector_all(".match-card .mc-main .mc-wl", "e => e.map(x => x.textContent)")
    check("W" in wl_in_main and "L" in wl_in_main, "勝敗が名前と同じ行にW/Lで出る", wl_in_main)

    check(pg.is_visible("#histGameFilter"), "種目の絞り込みがある")
    check(pg.is_visible("#histOppFilter"), "対戦相手の絞り込みがある")
    opts = pg.eval_on_selector_all("#histOppFilter option", "e => e.map(x => x.value)")
    check("岸川" in opts, "記録に出てくる相手が選べる", opts)
    pg.select_option("#histOppFilter", "岸川")
    pg.wait_for_timeout(300)
    check(pg.eval_on_selector_all(".match-card", "e => e.length") == 1, "絞り込みが効く")
    pg.click("#histFilterClear")
    pg.wait_for_timeout(300)
    check(pg.eval_on_selector("#histOppFilter", "e => e.value") == "", "絞り込みを外せる")

    # --- 29 CSV ---
    section("29 表計算への書き出し")
    with pg.expect_download() as dl:
        pg.click("#csvHistoryBtn")
    path = os.path.join(SHOTS, "history.csv")
    dl.value.save_as(path)
    raw = io.open(path, "rb").read()
    check(raw[:3] == b"\xef\xbb\xbf", "ExcelでもBOM付きUTF-8で開ける")
    text = raw.decode("utf-8-sig")
    head = text.split("\r\n")[0]
    check("イニング数" in head and "セーフティA" in head and "JPAポイントA" in head,
          "見出しに必要な列がある", head)
    check("タイラ" in text and "岸川" in text, "中身が入っている", text[:150])

    # ===================== 種目ごとの成績（削除済み） =====================
    section("23/24 種目ごとの成績は削除した")
    # 本人の指示（2026-08-21・段階3）で画面ごと削除した。
    # 入口も画面も残っていないことだけ確かめる
    pg.click("#tabHome")
    pg.wait_for_timeout(400)
    btns = pg.eval_on_selector_all("#homeBody button", "e => e.map(x => x.textContent)")
    check(not any("種目ごとの成績" in b for b in btns),
          "ホームに「種目ごとの成績を見る」は置かない", btns)
    # 「新しい試合を始める」は本人の指示（2026-08-21）で削除した
    check(pg.eval_on_selector_all("#homeBody .home-new", "e => e.length") == 0,
          "「新しい試合を始める」は置かない")
    check(pg.locator("#screenGameStats").count() == 0, "種目ごとの成績の画面が無い")
    check(pg.evaluate("() => typeof GAMESTATS") == "undefined",
          "GAMESTATS が読み込まれていない")

    # ===================== 25 ダブルスのパートナーごとの成績 =====================
    section("25 パートナーごとの成績（ダブルス）")
    # 「自分」を指定する。パートナーは自分以外のメンバーとして数えるため必要。
    # タイラは先ほどの試合ですでに登録済みなので、カードの「⋯」から自分にする
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    card = pg.locator("#playerList .match-card").filter(has_text="タイラ").first
    card.locator("button", has_text="⋯").click()
    pg.wait_for_timeout(250)
    card.locator("button", has_text="この人を自分にする").click()
    pg.wait_for_timeout(400)
    self_ok = pg.evaluate("() => !!(STORE.getSelf() && STORE.getSelf().name === 'タイラ')")
    check(self_ok, "既存の選手（タイラ）を自分に指定できる")

    # 9ボールダブルスを1試合。タイラ・岸川 の組で戦う
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball_doubles")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "タイラ")
    pg.fill("#inNameA2", "岸川")
    pg.fill("#inNameB", "佐藤")
    pg.fill("#inNameB2", "鈴木")
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    for _ in range(3):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(400)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)

    # 種目ごとの成績を消したので、パートナー別は個人の成績ページで確かめる
    pg.click("#tabStats")
    pg.wait_for_timeout(700)
    pg.locator(".stats-switch button", has_text="自分の成績").click()
    pg.wait_for_timeout(600)
    pg.eval_on_selector_all("#statsBody details", "e => e.forEach(x => x.open = true)")
    pg.wait_for_timeout(300)
    body2 = pg.inner_text("#statsBody")
    check("パートナー別" in body2, "パートナー別の見出しが出る", body2[-300:])
    part = body2.split("パートナー別")[-1].split("種目別")[0]
    check("岸川" in part, "組んだ相手（岸川）が出る", part[:200])
    check("佐藤" not in part, "相手チームの人はパートナーに混ざらない", part[:200])
    check("タイラ" not in part, "自分自身はパートナーに出ない", part[:200])
    pg.screenshot(path=os.path.join(SHOTS, "stats_partner.png"), full_page=True)

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
