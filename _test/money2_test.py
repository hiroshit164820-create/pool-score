# -*- coding: utf-8 -*-
"""money2_test.py — 追加指示13件の検証（2026-08-20 第2便）

対象:
  A. JPA 8ボールのポイント（3-0 / 2-1 / 2-0）
  B. 5-9 / 5-10 のデザイン変更9件
  C. 全体共通3件（通知の位置・プレイヤー選択・W-Lと獲得スコア）

実行: python _test/money2_test.py
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


def open_money(pg, game_id):
    """ハウスゲームから 5-9 / 5-10 を開く"""
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.open_group(pg, "house")
    pg.wait_for_timeout(200)
    pg.click('.game-pick[data-game="%s"]' % game_id)
    pg.wait_for_timeout(400)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844}, accept_downloads=True)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================= A. JPA 8ボールのポイント =================
    section("A. JPA 8ボールのポイント換算")
    tbl = pg.evaluate("""() => ({
      skunk: jpaTeamPoints8(0, 5),
      reach: jpaTeamPoints8(4, 5),
      plain: jpaTeamPoints8(2, 5),
      reach2: jpaTeamPoints8(1, 2),
      skunk2: jpaTeamPoints8(0, 2)
    })""")
    check(tbl["skunk"] == {"winner": 3, "loser": 0}, "相手0ラックは3-0（スコンク）", tbl["skunk"])
    check(tbl["reach"] == {"winner": 2, "loser": 1}, "相手がリーチまで来たら2-1", tbl["reach"])
    check(tbl["plain"] == {"winner": 2, "loser": 0}, "それ以外は2-0", tbl["plain"])
    check(tbl["reach2"] == {"winner": 2, "loser": 1}, "先取2のときの1ラックはリーチ扱い", tbl["reach2"])
    check(tbl["skunk2"] == {"winner": 3, "loser": 0}, "先取2でも0ラックはスコンク", tbl["skunk2"])

    # 実際に8ボールの試合を終えてポイントが出るか
    helpers.pick_game(pg, "jpa_8ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "タイラ")
    pg.fill("#inNameB", "岸川")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    # Aがスコンクで勝つまで押す
    for _ in range(12):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(180)
    ftxt = pg.inner_text("#finishSummary")
    print("   終了画面: " + ftxt.replace("\n", " / ")[:230])
    check("JPAポイント" in ftxt, "8ボールでもJPAポイントが出る", ftxt[:150])
    check("3P" in ftxt, "スコンクなので勝者3P", ftxt[-200:])
    check("勝敗（W-L）" in ftxt, "W-Lが出る", ftxt[:150])
    check("獲得スコア" in ftxt, "獲得スコアが出る", ftxt[:150])
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(700)

    # ================= C-3. 履歴のW-L =================
    section("C. 履歴のW-Lと獲得スコア")
    wl = pg.eval_on_selector_all(".match-card .mc-wl", "e => e.map(x => x.textContent)")
    check("W" in wl and "L" in wl, "履歴の名前のうしろにW/Lが出る", wl)
    # JPAポイントは 2026-08-21 から専用の行（.mc-jpa）に出す
    jpa_line = pg.eval_on_selector_all(".match-card .mc-jpa", "e => e.map(x => x.textContent)")
    check(len(jpa_line) >= 1, "履歴に獲得ポイントが出る", jpa_line)

    # ================= C-1. 通知が上の帯を塞がない =================
    section("C. 通知が上の帯のボタンを覆わない")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(250)
    pg.fill("#inNameA", "タイラ")
    pg.fill("#inNameB", "岸川")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    pg.click("#panelA")
    pg.wait_for_timeout(250)
    box = pg.evaluate("""() => {
      const t = document.querySelector('.toast');
      if (!t) return null;
      const screen = document.querySelector('section.screen.active');
      const bar = screen.querySelector('.topbar');
      const tr = t.getBoundingClientRect();
      const br_ = bar.getBoundingClientRect();
      const btns = [];
      bar.querySelectorAll('button').forEach(b => {
        const r = b.getBoundingClientRect();
        if (!r.width) return;
        btns.push({id: b.id, hidden: !(r.bottom <= tr.top || r.top >= tr.bottom)});
      });
      return {toastTop: Math.round(tr.top), barBottom: Math.round(br_.bottom), btns: btns};
    }""")
    check(box is not None, "通知が出ている")
    if box:
        check(box["toastTop"] >= box["barBottom"], "通知は帯より下に出る",
              (box["toastTop"], box["barBottom"]))
        blocked = [b["id"] for b in box["btns"] if b["hidden"]]
        check(not blocked, "帯のボタンが1つも覆われていない", blocked)
    pg.screenshot(path=os.path.join(SHOTS, "toast_fixed.png"))
    # 試合を片づける
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(400)

    # ================= C-2. プレイヤー選択（自分＋最近5人＋プルダウン） =================
    section("C. プレイヤー選択（最近5人＋プルダウン）")
    # 選手を8人登録する
    pg.evaluate("""() => {
      const names = ['あさひ','いくみ','うえだ','えみり','おかだ','かとう','きしかわ','くどう'];
      names.forEach(n => STORE.upsertPlayer(n));
      // 最近使った順を作る（新しいほどあと）
      const ps = STORE.listPlayers();
      ['あさひ','いくみ','うえだ','えみり','おかだ','かとう'].forEach((n, i) => {
        const p = ps.find(x => x.name === n);
        if (p) STORE.touchPlayer(p.id, new Date(2026, 7, 20, 10, i));
      });
      const me = STORE.listPlayers().find(x => x.name === 'くどう');
      if (me) STORE.setSelf(me.id);
    }""")
    pg.reload()
    pg.wait_for_timeout(600)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    # A側の欄だけを見る（B側にも同じ並びが出るので、両方数えると倍になる）
    chips = pg.locator("#playerFields .picker").nth(0).locator(".picker-chip .pc-name").all_text_contents()
    print("   ボタン: " + str(chips[:8]))
    check(len(chips) <= 6, "ボタンは6人まで（自分＋最近5人）", len(chips))
    check("くどう" in chips, "自分がボタンに出る", chips)
    check(chips[0] == "くどう", "自分が先頭", chips[:3])
    check("かとう" in chips, "最近使った人がボタンに出る", chips)
    check(pg.locator("#playerFields .picker-select").count() >= 1, "残りはプルダウンに入る")
    opts = pg.locator("#playerFields .picker-select").nth(0).locator("option").all_text_contents()
    print("   プルダウン: " + str(opts))
    names_only = [o for o in opts if "ほかの人" not in o]
    check(names_only == sorted(names_only, key=lambda s: s), "あいうえお順に並ぶ", names_only)
    # プルダウンで選べる
    sel0 = pg.locator("#playerFields .picker-select").nth(0)
    val = sel0.locator("option").evaluate_all("els => els.map(x => x.value)")
    pick = [v for v in val if v][0]
    sel0.select_option(pick)
    pg.wait_for_timeout(400)
    check(pg.input_value("#inNameA") != "", "プルダウンで選ぶと名前欄に入る", pg.input_value("#inNameA"))

    # ================= B. 5-9 / 5-10 =================
    section("B. 5-9 の準備画面")
    open_money(pg, "59")
    check(pg.is_visible("#screenMoneySetup"), "5-9の準備画面が開く")
    mchips = pg.locator("#moneyPlayers .picker").nth(0).locator(".picker-chip .pc-name").all_text_contents()
    check("くどう" in mchips, "自分がボタンに出る", mchips)
    check(pg.locator("#moneyPlayers .picker-select").count() >= 1, "残りはプルダウン")

    # ハンデは既定なし
    onoff = pg.eval_on_selector_all("#moneyHandicaps .money-hc-toggle",
                                    "e => e.map(x => x.querySelector('[data-v=\\'off\\']').getAttribute('aria-pressed'))")
    check(all(v == "true" for v in onoff), "ハンデは既定で「なし」", onoff)
    check(pg.eval_on_selector_all("#moneyHandicaps .bh-chips", "e => e.length") == 0,
          "「なし」のあいだは番号を出さない")
    # 1人目をハンデありに
    pg.locator("#moneyHandicaps .money-hc").nth(0).locator("button", has_text="ハンデあり").click()
    pg.wait_for_timeout(300)
    balls = pg.eval_on_selector_all("#moneyHandicaps .bh-chips button", "e => e.map(x => x.textContent)")
    print("   5-9のハンデ候補: " + str(balls))
    check(balls == ["1", "2", "3", "4", "6", "7", "8"], "5-9は9番以降と5番を出さない", balls)

    # 名前を入れて開始
    pg.locator("#moneyPlayers input.money-name").nth(0).fill("タイラ")
    pg.locator("#moneyPlayers input.money-name").nth(1).fill("岸川")
    pg.wait_for_timeout(200)
    pg.locator("#moneyHandicaps .bh-chips button", has_text="7").first.click()
    pg.wait_for_timeout(250)
    pg.click("#moneyStartBtn")
    pg.wait_for_timeout(500)

    section("B. 5-9 の試合画面")
    check(pg.is_visible("#screenMoneyMatch"), "試合画面が開く")
    check(pg.locator("#moneyBalls").count() == 0, "「落とした球」の欄が無い")
    check(pg.locator("#moneySideChk").count() == 0, "サイドのチェックボックスが無い")
    plus = pg.eval_on_selector_all("#moneyPlus button", "e => e.map(x => x.textContent)")
    minus = pg.eval_on_selector_all("#moneyMinus button", "e => e.map(x => x.textContent)")
    check(plus == ["+1", "+2", "+4", "+8", "+16"], "プラスのボタンが5つ", plus)
    check(minus == ["-1", "-2"], "マイナスのボタンが2つ", minus)
    prow = pg.eval_on_selector("#moneyPlus",
                               "e => new Set(Array.from(e.children).map(c => Math.round(c.getBoundingClientRect().top))).size")
    mrow = pg.eval_on_selector("#moneyMinus",
                               "e => new Set(Array.from(e.children).map(c => Math.round(c.getBoundingClientRect().top))).size")
    check(prow == 1, "プラスは1行に並ぶ", prow)
    check(mrow == 1, "マイナスは1行に並ぶ", mrow)
    check("次のラックへ" in pg.inner_text("#moneyRackBtn"), "「次のラックへ」に変わっている",
          pg.inner_text("#moneyRackBtn"))
    hc = pg.inner_text("#moneyScores")
    check("ハンデ 7番" in hc, "スコアボードにハンデ球の番号が出る", hc.replace("\n", " "))

    # 得点を入れる
    pg.locator("#moneyShooter button", has_text="タイラ").click()
    pg.wait_for_timeout(200)
    pg.locator("#moneyPlus button", has_text="+4").click()
    pg.wait_for_timeout(300)
    sc = pg.inner_text("#moneyScores")
    check("+4" in sc and "-4" in sc, "2人なら+4/-4になる", sc.replace("\n", " "))
    pg.locator("#moneyMinus button", has_text="-1").click()
    pg.wait_for_timeout(300)
    sc2 = pg.inner_text("#moneyScores")
    check("+3" in sc2 and "-3" in sc2, "マイナスも効く", sc2.replace("\n", " "))
    pg.screenshot(path=os.path.join(SHOTS, "money_match.png"), full_page=True)

    section("B. やめると自動で保存される")
    pg.click("#moneyQuitBtn")
    pg.wait_for_timeout(500)
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_money_results') || '[]')")
    check(len(saved) == 1, "1件保存された", len(saved))
    if saved:
        rec = saved[0]
        check(rec["gameId"] == "59", "種目が残る", rec.get("gameId"))
        names = [p["name"] for p in rec["players"]]
        check(names[0] == "タイラ", "得点の高い順に並ぶ", rec["players"])
        check(rec["players"][0]["score"] == 3, "最終結果が残る", rec["players"])
        check("shots" not in rec, "1球ずつの記録は保存しない（最終結果のみ）", list(rec.keys()))
        check(rec["players"][0]["handicapBalls"] == [7], "ハンデ球も残る", rec["players"][0])

    section("B. 5-10 のハンデ候補")
    open_money(pg, "510")
    pg.wait_for_timeout(300)
    pg.locator("#moneyHandicaps .money-hc").nth(0).locator("button", has_text="ハンデあり").click()
    pg.wait_for_timeout(300)
    balls10 = pg.eval_on_selector_all("#moneyHandicaps .bh-chips button", "e => e.map(x => x.textContent)")
    print("   5-10のハンデ候補: " + str(balls10))
    check(balls10 == ["1", "2", "3", "4", "6", "7", "8", "9"], "5-10は10番以降と5番を出さない", balls10)

    section("B. 履歴に記録が出る")
    pg.click("#tabHistory")
    pg.wait_for_timeout(500)
    htxt = pg.inner_text("#historyList")
    check("5-9 / 5-10 の記録" in htxt, "履歴に5-9の欄が出る", htxt[:120])
    check("タイラ" in htxt and "岸川" in htxt, "参加者が出る", htxt[:200])
    mwl = pg.eval_on_selector_all(".money-result .mc-wl", "e => e.map(x => x.textContent)")
    check(mwl[:2] == ["W", "L"], "W-Lが出る", mwl)

    with pg.expect_download() as dl:
        pg.click("#csvHistoryBtn")
    path = os.path.join(SHOTS, "history2.csv")
    dl.value.save_as(path)
    text = io.open(path, "rb").read().decode("utf-8-sig")
    check("5-9 / 5-10 の記録" in text, "CSVにも5-9の記録が入る", text[-200:])
    check("獲得スコア" in text, "獲得スコアの列がある", text[-200:])

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
