# -*- coding: utf-8 -*-
"""stats4_test.py — 成績管理の作り直し（本人の指示 2026-08-21・D）＋ホーム5件（E）

対象:
  1. ホームの「種目ごとの成績を見る」ボタンが無い
  2. 成績ページの冒頭に「自分の成績」「他選手の成績」の1行がある
  3. 「自分の成績」でくわしい成績が出る（ホームから押したときと同じもの）
  4. くわしい成績の並びが 総合 → 内訳 → 対戦相手別 → パートナー別 → 種目別
  5. 1〜4のカードは既定で閉じている
  6. 総合成績から 獲得スコア・イニング数・1試合あたりのイニング数・JPA獲得ポイント が消えている
  7. パートナー別に マスワリ回数／率 が出る
  8. 対戦相手別・パートナー別は直近5人まで。それ以上は「ほかN人を見る」で出る
  9. 「種目別」カード（旧）が無い
 10. 種目別でさらに詳しくは、記録の無い種目もグレーで出し、並びは種目選択と同じ
 11. 一般種目に「対戦クラス別の勝敗数・勝率」が出る
 12. ホームの直近の試合が5件（E）

実行: python _test/stats4_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOTS, exist_ok=True)

PORT = {"width": 390, "height": 844}

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


def play(pg, gid, a, b, a2=None, b2=None):
    pg.click("#tabSetup")
    pg.wait_for_timeout(350)
    helpers.pick_game(pg, gid)
    pg.wait_for_timeout(400)
    pg.fill("#inNameA", a)
    pg.fill("#inNameB", b)
    if a2:
        pg.fill("#inNameA2", a2)
    if b2:
        pg.fill("#inNameB2", b2)
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    finish_by(pg, "A")


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport=PORT)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ---- 下ごしらえ: 自分＋クラス付きの相手を7人ぶん作って試合を積む ----
    section("下ごしらえ")
    made = pg.evaluate("""() => {
      const me = STORE.upsertPlayer('たいら');
      STORE.setSelf(me.id);
      const names = [['あさひ','Be'],['いずみ','C'],['うみ','B'],['えいた','A'],
                     ['おとは','SA'],['かえで','P'],['きりの','C']];
      names.forEach(function (n) { STORE.upsertPlayer(n[0], null, {cls: n[1]}); });
      return STORE.listPlayers().length;
    }""")
    check(made == 8, "選手を8人（自分＋7人）作った", made)

    for opp in ["あさひ", "いずみ", "うみ", "えいた", "おとは", "かえで"]:
        play(pg, "9ball", "たいら", opp)
    # ダブルスも1試合（パートナー別に出す）
    play(pg, "9ball_doubles", "たいら", "えいた", "きりの", "おとは")
    done = pg.evaluate("() => STORE.listMatches().filter(m => m.finished).length")
    check(done == 7, "終わった試合が7つできた", done)

    # ================= 1. ホームのボタン =================
    section("1. ホームの「種目ごとの成績を見る」を消した")
    pg.click("#tabHome")
    pg.wait_for_timeout(600)
    btns = pg.eval_on_selector_all("#homeBody button", "e => e.map(x => x.textContent)")
    check(not any("種目ごとの成績" in b for b in btns),
          "ホームに「種目ごとの成績を見る」が無い", btns)

    # ================= 12. ホームの直近の試合は5件（E）=================
    section("12. ホームの直近の試合は5件")
    rows = pg.eval_on_selector_all("#homeBody .home-row", "e => e.length")
    check(rows == 5, "直近の試合が5件出る", rows)

    # ================= 2〜3. 成績ページの冒頭 =================
    section("2. 成績ページの冒頭のボタン")
    pg.click("#tabStats")
    pg.wait_for_timeout(700)
    sw = pg.eval_on_selector_all(".stats-switch button", "e => e.map(x => x.textContent.trim())")
    check(sw == ["自分の成績", "他選手の成績"], "1行に2つのボタンが並ぶ", sw)
    hs = pg.eval_on_selector_all(".stats-switch button",
                                 "e => e.map(x => Math.round(x.getBoundingClientRect().height))")
    check(hs and min(hs) >= 44, "どちらも44px以上", hs)
    sameLine = pg.eval_on_selector(".stats-switch", """e => {
      const b = [...e.querySelectorAll('button')].map(x => x.getBoundingClientRect());
      return Math.abs(b[0].top - b[1].top) < 2;
    }""")
    check(sameLine, "2つが同じ行にある", sameLine)

    section("3. 「自分の成績」でくわしい成績が出る")
    pg.click('.stats-switch button:text-is("自分の成績")')
    pg.wait_for_timeout(700)
    head = pg.text_content("#statsBody h2") or ""
    check("たいら" in head, "自分の成績が開く", head)

    # ================= 4〜5. カードの並びと開閉 =================
    section("4. カードの並び")
    titles = pg.eval_on_selector_all(
        "#statsBody > details > summary",
        "e => e.map(x => x.textContent.replace(/[▼▲]/g, '').trim())")
    want = ["成績（総合）", "一般種目とJPAの内訳", "対戦相手別", "パートナー別",
            "種目別でさらに詳しく"]
    check(titles[:5] == want, "上から 総合→内訳→対戦相手別→パートナー別→種目別", titles)
    check("種目別" not in [t for t in titles if t != "種目別でさらに詳しく"],
          "旧「種目別」カードは無い", titles)

    section("5. 既定で閉じている")
    opens = pg.eval_on_selector_all("#statsBody > details", "e => e.map(x => x.open)")
    check(not any(opens), "どのカードも閉じた状態で出る", opens)

    # ================= 6. 総合成績の項目 =================
    section("6. 総合成績から外した項目")
    pg.eval_on_selector_all("#statsBody > details", "e => e.forEach(x => { x.open = true; })")
    pg.wait_for_timeout(300)
    total = pg.evaluate("""() => {
      const d = [...document.querySelectorAll('#statsBody > details')]
        .find(x => x.querySelector('summary').textContent.indexOf('総合') >= 0);
      return d ? d.innerText : null;
    }""")
    total = total or ""
    for k in ["試合数", "W-L", "勝率", "ラック取得率", "マスワリ", "ブレイクエース",
              "セーフティ", "ファウル"]:
        check(k in total, "総合に「" + k + "」がある")
    for k in ["獲得スコア", "イニング数", "1試合あたりのイニング数", "JPA獲得ポイント"]:
        check(k not in total, "総合から「" + k + "」を外した", total[:200])

    # ================= 7〜8. 対戦相手別・パートナー別 =================
    section("7. パートナー別のマスワリ")
    part = pg.evaluate("""() => {
      const d = [...document.querySelectorAll('#statsBody > details')]
        .find(x => x.querySelector('summary').textContent.indexOf('パートナー別') >= 0);
      return d ? d.innerText : null;
    }""")
    part = part or ""
    check("きりの" in part, "組んだ相手が出る", part[:200])
    check("マスワリ" in part, "マスワリ回数／率が出る", part[:200])
    check("勝" in part and "勝率" in part, "勝敗数と勝率が出る", part[:200])

    section("8. 直近5人＋ほかN人")
    opp5 = pg.evaluate("""() => {
      const d = [...document.querySelectorAll('#statsBody > details')]
        .find(x => x.querySelector('summary').textContent.indexOf('対戦相手別') >= 0);
      if (!d) return null;
      const head = [...d.children].filter(c => c.classList.contains('stat-row')).length;
      const more = d.querySelector('.fold-more');
      return {head: head, more: more ? more.querySelector('summary').textContent : null,
              hidden: more ? !more.open : null,
              rest: more ? more.querySelectorAll('.stat-row').length : 0};
    }""")
    check(opp5 and opp5["head"] == 5, "まず5人ぶん出る", opp5)
    check(opp5 and opp5["more"] and "ほか" in opp5["more"], "「ほかN人を見る」がある", opp5)
    check(opp5 and opp5["hidden"], "残りは閉じたままで出ない", opp5)
    check(opp5 and opp5["rest"] >= 1, "開くと残りが出る", opp5)

    # ================= 10. 種目別でさらに詳しく =================
    section("10. 種目別でさらに詳しく")
    games = pg.evaluate("""() => {
      const d = [...document.querySelectorAll('#statsBody > details')]
        .find(x => x.querySelector('summary').textContent.indexOf('種目別でさらに詳しく') >= 0);
      if (!d) return null;
      return [...d.querySelectorAll('.game-card')].map(c => ({
        name: c.querySelector('.dc-game-name').textContent.trim(),
        empty: c.classList.contains('is-empty'),
      }));
    }""")
    check(games and len(games) >= 14, "全種目ぶんのカードが出る", games and len(games))
    check(games and games[0]["name"] == "9ボール", "上が9ボール", games and games[0])
    check(games and games[-1]["name"] == "5-10", "最下部が5-10", games and games[-1])
    check(games and any(g["empty"] for g in games), "記録の無い種目はグレー",
          [g for g in (games or []) if g["empty"]][:3])
    check(games and not [g for g in games if g["name"] == "9ボール"][0]["empty"],
          "記録のある種目はグレーにしない")
    order = pg.evaluate("() => SETUP.gameOrder()")
    check(order[0] == "9ball" and order[-1] == "510",
          "並び順は種目選択と同じ出どころ", [order[0], order[-1]])

    # ================= 11. 対戦クラス別 =================
    section("11. 対戦クラス別の勝敗数・勝率")
    nine = pg.evaluate("""() => {
      const cards = [...document.querySelectorAll('.detail-card .game-card')];
      const c = cards.find(x => x.querySelector('.dc-game-name').textContent.trim() === '9ボール');
      if (!c) return null;
      c.open = true;
      return c.innerText;
    }""")
    nine = nine or ""
    check("対戦クラス" in nine, "9ボールに対戦クラス別の行がある", nine[:300])
    for c in ["Be", "C", "B", "A", "SA", "P"]:
        check("対戦クラス " + c + " の勝敗数・勝率" in nine,
              "クラス " + c + " の行がある", nine[:400])
    detail = pg.evaluate("() => STORE.gameDetail(STORE.getSelfId()).byGame['9ball'].byClass")
    check(detail and detail.get("P", {}).get("wins") == 1,
          "クラスPの相手に1勝と数えている", detail)
    pg.screenshot(path=os.path.join(SHOTS, "stats4.png"), full_page=True)

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("==== %d/%d 成功 ====" % (len(results) - len(ng), len(results)))
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
