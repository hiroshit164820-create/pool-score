# -*- coding: utf-8 -*-
"""detail_test.py — 「種目別でさらに詳しく」カード（本人の指示 2026-08-21 / 段階7）

対象:
  1. カードが出る／既定は閉じている／押すと開く
  2. 一般種目（9ボール）の項目がそろう
  3. ローテーションは点数別の勝敗・勝率と、Aハイラン／Bハイラン
  4. 14-1 はハイラン
  5. ボウラードは平均スコア（過去10/30/50）・最高スコア・累計
  6. JPA 9ボールはポイント・SL別・あがりまでのイニング
  7. JPA 9ボールダブルスは点の項目を出さない
  8. ハウスゲーム（カイルンの最大連続得点・5-9のマスワリ／得点履歴）
  9. 記録が無い人にはカードを出さない

実行: python _test/detail_test.py
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


def finish_by(pg, side):
    for _ in range(40):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        panel = "#panel" + side
        if pg.eval_on_selector(panel, "e => e.disabled"):
            break
        pg.click(panel)
        pg.wait_for_timeout(110)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)


def setup_game(pg, gid):
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, gid)
    pg.wait_for_timeout(450)
    # 成績の「1ラックあたりの平均イニング数」を見るので、数える設定で作る
    # （既定は「数えない」になった。本人の指示 2026-08-21）
    helpers.set_innings(pg, True)


def open_detail(pg, name):
    pg.click("#tabStats")
    pg.wait_for_timeout(600)
    pg.locator("#statsBody .match-card", has_text=name).first.click()
    pg.wait_for_timeout(600)


def card_text(pg):
    """カードの中身を全部読む。

    2026-08-21・D で種目ごとのカードに切り分け、中は閉じた状態で出すように
    したので、読む前に全部開く（記録の無い種目もグレーで並ぶ）。
    """
    pg.evaluate("""() => {
      document.querySelectorAll('.detail-card details').forEach(d => { d.open = true; });
    }""")
    pg.wait_for_timeout(200)
    return pg.inner_text(".detail-card")


def seg_text(pg, name):
    """種目名で1つのカードを取り出して、その中身だけ読む"""
    return pg.evaluate("""(name) => {
      const cards = [...document.querySelectorAll('.detail-card .game-card')];
      const c = cards.find(x => {
        const t = x.querySelector('.dc-game-name');
        return t && t.textContent.trim() === name;
      });
      if (!c) return null;
      c.open = true;
      return c.innerText;
    }""", name)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    section("記録を作る")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    for n in ["たいら", "たかのぶ", "みなみ"]:
        helpers.add_player(pg, n)

    # (1) 9ボール: たいらの勝ち
    setup_game(pg, "9ball")
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    finish_by(pg, "A")

    # (2) ローテーション 120点: たいらがブレイクから撞き切り（Aハイラン）
    setup_game(pg, "rotation")
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.locator("#goalArea .chip", has_text="120点").first.click()
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    for n in range(1, 16):
        b = pg.locator("#ballGrid button[data-ball='%d']" % n)
        if b.count() and not b.first.is_disabled():
            b.first.click()
            pg.wait_for_timeout(90)
    pg.wait_for_timeout(500)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)

    # (3) 14-1: たいらの勝ち
    setup_game(pg, "straight")
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    # いちばん短い50点先取にする（球を1個ずつ押すため、長いと時間がかかる）
    pg.locator("#goalArea .chip", has_text="50点先取").first.click()
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    for _ in range(200):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        hit = False
        for n in range(1, 16):
            b = pg.locator("#ballGrid button[data-ball='%d']" % n)
            if b.count() and not b.first.is_disabled():
                b.first.click()
                pg.wait_for_timeout(50)
                hit = True
                break
        if not hit:
            break
    pg.wait_for_timeout(500)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(800)
    else:
        # 終わらなかったときは中断して次へ（成績には数えない）
        pg.click("#finishBtn")
        pg.wait_for_timeout(500)
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            pg.click("#confirmFinishBtn")
            pg.wait_for_timeout(800)

    # (4) ボウラード
    setup_game(pg, "bowlard")
    pg.fill("#inNameA", "たいら")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    for _ in range(40):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        b = pg.locator("#bowlPad button").last
        if not b.count() or b.is_disabled():
            break
        b.click()
        pg.wait_for_timeout(90)
    pg.wait_for_timeout(500)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)

    # (5) JPA 9ボール: たいらの勝ち（相手SL5）
    setup_game(pg, "jpa_9ball")
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL5").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    finish_by(pg, "A")

    # (6) JPA 9ボールダブルス
    setup_game(pg, "jpa_9ball_doubles")
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameA2", "みなみ")
    pg.fill("#inNameB", "たかのぶ")
    pg.fill("#inNameB2", "ゆうすけ")
    fields = pg.locator("#goalArea .field")
    for i in range(min(4, fields.count())):
        c = fields.nth(i).locator(".chip", has_text="SL4")
        if c.count():
            c.first.click()
            pg.wait_for_timeout(120)
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    finish_by(pg, "A")

    # (7) ハウスゲームの記録を直に入れる（カイルン・5-9）
    made = pg.evaluate("""() => {
      STORE.saveMoneyResult({gameId:'kailun', gameLabel:'カイルン', racks:0,
        players:[{name:'たいら', score:5, handicapBalls:[], maxRun:3},
                 {name:'みなみ', score:2, handicapBalls:[], maxRun:1}]});
      STORE.saveMoneyResult({gameId:'59', gameLabel:'5-9', racks:4,
        players:[{name:'たいら', score:6, handicapBalls:[], masuwari:2, breakAce:1},
                 {name:'みなみ', score:-6, handicapBalls:[], masuwari:0, breakAce:0}]});
      STORE.saveMoneyResult({gameId:'59', gameLabel:'5-9', racks:2,
        players:[{name:'たいら', score:-3, handicapBalls:[], masuwari:0, breakAce:0},
                 {name:'みなみ', score:3, handicapBalls:[], masuwari:1, breakAce:0}]});
      return STORE.listMoneyResults().length;
    }""")
    check(made == 3, "ハウスゲームの記録が3件できた", made)
    done = pg.evaluate("() => STORE.listMatches().filter(m => m.finished).length")
    check(done == 6, "終わった試合が6つできた", done)

    # ================= 1. カード =================
    section("1. カードの開閉")
    open_detail(pg, "たいら")
    card = pg.locator(".detail-card")
    check(card.count() == 1, "カードが1つ出る", card.count())
    check(pg.eval_on_selector(".detail-card", "e => !e.open"), "既定は閉じている")
    summ = pg.locator(".detail-card > summary")
    check((summ.text_content() or "").strip().startswith("種目別でさらに詳しく"),
          "見出しが「種目別でさらに詳しく」", summ.text_content())
    box = summ.bounding_box()
    check(box and box["height"] >= 44, "見出しが44px以上", box)
    summ.click()
    pg.wait_for_timeout(400)
    check(pg.eval_on_selector(".detail-card", "e => e.open"), "押すと開く")
    txt = card_text(pg)
    pg.screenshot(path=os.path.join(SHOTS, "detail_card.png"), full_page=True)

    # ================= 2. 一般種目 =================
    section("2. 9ボール")
    for k in ["勝敗数", "勝率", "マスワリ数／率", "ブレイクエース",
              "1ラックあたりの平均セーフティ数", "1試合あたりの平均セーフティ数",
              "1ラックあたりの平均イニング数", "ショットクロック平均タイム",
              "1試合あたりのエクステンション使用回数"]:
        check(k in txt, "「" + k + "」がある")
    check("9ボール" in txt, "種目名が出る")

    # ================= 3. ローテーション =================
    section("3. ローテーション")
    check("120点の勝敗数" in txt, "点数別の勝敗数がある", txt[:200])
    check("120点の勝率" in txt, "点数別の勝率がある")
    check("Aハイラン数／率" in txt, "Aハイランがある")
    check("Bハイラン数／率" in txt, "Bハイランがある")
    # 項目名の欄が潰れて縦に割れていないこと（本人の指摘で直した箇所）
    narrow = pg.evaluate("""() => [...document.querySelectorAll('.detail-card .stat-key')]
      .filter(e => e.getBoundingClientRect().width < 60)
      .map(e => e.textContent.slice(0, 20))""")
    check(not narrow, "項目名の欄が潰れていない", narrow)
    detail = pg.evaluate("""() => {
      const p = STORE.listPlayers().find(x => x.name === 'たいら');
      return STORE.gameDetail(p.id);
    }""")
    rot = detail["byGame"].get("rotation")
    check(rot and rot["aHighRun"] == 1, "Aハイランが1回と数えられる", rot and rot["aHighRun"])
    check(rot and rot["bHighRun"] == 0, "Bハイランは0回", rot and rot["bHighRun"])

    # ================= 4. 14-1 =================
    section("4. 14-1")
    check("14-1" in txt, "種目名が出る")
    check("ハイラン" in txt, "ハイランがある")

    # ================= 5. ボウラード =================
    section("5. ボウラード")
    for k in ["平均スコア（過去10回）", "平均スコア（過去30回）", "平均スコア（過去50回）",
              "最高スコア", "累計ストライク数", "累計スペア数", "累計ミス数"]:
        check(k in txt, "「" + k + "」がある")

    # ================= 6. JPA =================
    section("6. JPA 9ボール")
    for k in ["累計獲得ポイント数", "1試合あたりの平均獲得ポイント数",
              "1試合あたりの平均獲得ポイント率", "あがりまでの最小イニング数",
              "あがりまでの最大イニング数", "対戦相手のスキルレベル平均"]:
        check(k in txt, "「" + k + "」がある")
    check("相手SL5 の勝敗数／勝率" in txt, "相手のSL別が出る", txt[:300])
    jpa = detail["byGame"].get("jpa_9ball")
    check(jpa and jpa["oppSlCount"] == 1 and jpa["oppSlSum"] == 5,
          "相手のSLを5として数えている", jpa and (jpa["oppSlSum"], jpa["oppSlCount"]))

    # ================= 7. JPAダブルス =================
    section("7. JPA 9ボールダブルス")
    dbl = detail["byGame"].get("jpa_9ball_doubles")
    check(dbl and dbl["matches"] == 1, "ダブルスも1試合ぶん数えている", dbl and dbl["matches"])
    # ダブルスの節だけを取り出して見る。
    # 文字列を頭から切ると、後ろに続く別の種目の節まで入ってしまう
    seg = seg_text(pg, "JPA 9ボールダブルス")
    check(seg is not None, "ダブルスの節がある", txt[:300])
    seg = seg or ""
    check("累計獲得ポイント数" not in seg, "ダブルスにポイントの行は出さない", seg[:200])
    check("対戦相手のスキルレベル平均" not in seg, "ダブルスにSL平均は出さない", seg[:200])
    check("マスワリ数／率" in seg, "ダブルスにもマスワリは出す", seg[:200])

    # ================= 8. ハウスゲーム =================
    section("8. ハウスゲーム")
    check("カイルン" in txt, "カイルンの節がある")
    check("最大連続得点" in txt, "最大連続得点がある")
    check("獲得得点の履歴（新しい順）" in txt, "得点の履歴がある")
    house = detail["byHouse"]
    check(house.get("kailun", {}).get("maxRun") == 3, "カイルンの最大連続得点が3",
          house.get("kailun"))
    check(house.get("59", {}).get("masuwari") == 2, "5-9のマスワリが2回",
          house.get("59"))
    check(house.get("59", {}).get("breakAce") == 1, "5-9のブレイクエースが1回",
          house.get("59"))
    check(house.get("59", {}).get("plays") == 2, "5-9は2回ぶん",
          house.get("59"))
    check("5-9" in txt, "5-9の節がある")
    # 5-9 / 5-10 はブレイクエースを入力する手立てが無く常に0になるため、行ごと消した
    # （本人の指示 2026-08-21）
    seg9 = seg_text(pg, "5-9")
    check(seg9 is not None, "5-9の節を取り出せる", txt[:300])
    seg9 = seg9 or ""
    check("ブレイクエース" not in seg9, "5-9にブレイクエースの行は出さない", seg9[:300])
    check("マスワリ数／率" in seg9, "5-9のマスワリの行は残る", seg9[:300])

    # ================= 9. 記録の無い人 =================
    section("9. 記録の無い人")
    pg.evaluate("() => STORE.upsertPlayer('まだ記録なし')")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    open_detail(pg, "まだ記録なし")
    # 2026-08-21・D で「まだ記録がない種目も表示する」に変えたので、
    # 記録が1件も無い人でもカードは出る（中身は全部グレーの「記録なし」）
    check(pg.locator(".detail-card").count() == 1, "カードは出す",
          pg.locator(".detail-card").count())
    pg.eval_on_selector(".detail-card", "e => { e.open = true; }")
    pg.wait_for_timeout(200)
    empt = pg.eval_on_selector_all(".detail-card .game-card",
                                   "e => e.map(x => x.classList.contains('is-empty'))")
    check(len(empt) >= 12 and all(empt), "全部の種目がグレーの「記録なし」", empt)

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
