# -*- coding: utf-8 -*-
"""stage3_test.py — 段階3（選手・成績）の指示

本人の指示（2026-08-21・26件のうち段階3）:
  1. 「種目ごとの成績」は削除する
  2. 他選手の成績ページに自分を表示しない
  3. 登録ボタンを上の帯に置く
  4. 選手一覧の「戻る」を削除
  5. 自分のバッジは名前の右側に置く
  6. 自分バッジを短くする
  7. 自分の勝敗も他の人と同じくカード右上に出す

実行: python _test/stage3_test.py
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


def add_self(pg, name):
    """上の帯の「自分を登録」から自分を登録する"""
    pg.click("#toggleSelfBtn")
    pg.wait_for_timeout(200)
    pg.fill("#newPlayerName", name)
    pg.wait_for_timeout(120)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(300)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================= 1. 種目ごとの成績の削除 =================
    section("1. 種目ごとの成績を削除した")
    check(pg.locator("#screenGameStats").count() == 0, "画面そのものが無い")
    check(pg.evaluate("() => typeof GAMESTATS") == "undefined",
          "GAMESTATS が読み込まれていない", pg.evaluate("() => typeof GAMESTATS"))
    check(pg.evaluate("""() => [...document.scripts]
            .some(s => (s.src || '').indexOf('ui_gamestats') >= 0)""") is False,
          "script タグも消えている")

    # ================= 2. 選手一覧の上の帯 =================
    section("2. 登録ボタンは上の帯／戻るは無い")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(500)
    check(pg.locator("#backFromPlayersBtn").count() == 0, "「戻る」が無い")
    bar = pg.locator("#screenPlayers .topbar")
    check(bar.locator("#toggleSelfBtn").count() == 1, "上の帯に「自分を登録」がある")
    check(bar.locator("#toggleAddPlayerBtn").count() == 1, "上の帯に「選手を登録」がある")
    check(pg.locator("#screenPlayers .list .add-player-head").count() == 0,
          "本文にはもう登録ボタンが無い")
    for bid in ("#toggleSelfBtn", "#toggleAddPlayerBtn"):
        bb = pg.locator(bid).bounding_box()
        check(bb and bb["height"] >= 44, "押せる高さ44px以上 " + bid, bb)
    # 帯からはみ出していないこと
    barbox = bar.bounding_box()
    ab = pg.locator("#toggleAddPlayerBtn").bounding_box()
    check(ab["x"] + ab["width"] <= barbox["x"] + barbox["width"] + 1,
          "帯からはみ出さない", (ab, barbox))

    section("3. 上の帯のボタンで登録できる")
    add_self(pg, "たいら")
    check(pg.evaluate("() => !!STORE.getSelf()"), "自分が登録された")
    check(pg.evaluate("() => STORE.getSelf().name") == "たいら", "名前が入る")
    helpers.add_player(pg, "岸川")
    helpers.add_player(pg, "佐藤")
    pg.wait_for_timeout(300)
    check(pg.evaluate("() => STORE.listPlayers().length") == 3, "3人になった")

    # ================= 4〜6. 自分のバッジ =================
    section("4. 自分バッジは名前の右・短い")
    info = pg.evaluate("""() => {
      const cards = [...document.querySelectorAll('#playerList .player-card')];
      const self = cards.find(c => c.classList.contains('is-self'));
      const other = cards.find(c => !c.classList.contains('is-self'));
      const b = self.querySelector('.self-badge');
      const nm = self.querySelector('.pc-name-text');
      const sc = self.querySelector('.mc-score');
      const osc = other.querySelector('.mc-score');
      const r = e => { const x = e.getBoundingClientRect();
        return {l: Math.round(x.left), r: Math.round(x.right), t: Math.round(x.top)}; };
      return {text: b.textContent, inName: !!b.closest('.pc-name'),
              badge: r(b), name: r(nm), score: r(sc), oscore: r(osc),
              scoreText: sc.textContent, oscoreText: osc.textContent};
    }""")
    print("   " + str(info))
    check(info["badge"]["l"] >= info["name"]["r"] - 1, "バッジが名前より右にある", info)
    check(info["inName"], "名前の欄の中に入っている（行の直下ではない）")
    check(len(info["text"].strip()) <= 2, "バッジの字が短い", info["text"])

    section("5. 自分の勝敗も他と同じ位置に出る")
    check(info["score"]["r"] == info["oscore"]["r"],
          "自分の札の右端が他の人と同じ", (info["score"], info["oscore"]))
    check(info["scoreText"].strip() != "", "自分の札にも文字が出ている", info["scoreText"])
    check(info["scoreText"] == info["oscoreText"],
          "記録の無い状態では他の人と同じ文言", (info["scoreText"], info["oscoreText"]))
    pg.screenshot(path=os.path.join(SHOTS, "stage3_players.png"), full_page=True)

    # ================= 7. 他選手の成績に自分を出さない =================
    section("6. 他選手の成績に自分は出ない")
    pg.click("#tabStats")
    pg.wait_for_timeout(700)
    check(pg.locator(".stats-bygame").count() == 0,
          "「種目ごとの成績を見る」のボタンが無い")
    names = pg.eval_on_selector_all("#statsBody .stats-card .pc-name-text",
                                    "e => e.map(x => x.textContent.trim())")
    print("   一覧: " + str(names))
    check("たいら" not in names, "自分（たいら）が一覧に出ない", names)
    check("岸川" in names and "佐藤" in names, "他の選手は出る", names)
    check(len(names) == 2, "自分を除いた2人だけ", names)

    section("7. 自分の成績は「自分の成績」から見られる")
    pg.locator(".stats-switch button", has_text="自分の成績").click()
    pg.wait_for_timeout(600)
    head = pg.inner_text("#statsBody .stats-head")
    check("たいら" in head, "自分の成績が開く", head)
    pg.locator(".stats-switch button", has_text="他選手の成績").click()
    pg.wait_for_timeout(600)
    check(pg.locator("#statsBody .stats-card").count() == 2, "他選手の一覧に戻る")

    section("8. 自分しかいないとき")
    pg.evaluate("""() => {
      const ps = STORE.listPlayers();
      const me = STORE.getSelf();
      ps.filter(p => p.id !== me.id).forEach(p => STORE.deletePlayer(p.id));
    }""")
    pg.click("#tabHome")
    pg.wait_for_timeout(300)
    pg.click("#tabStats")
    pg.wait_for_timeout(700)
    body = pg.inner_text("#statsBody")
    check("自分のほかに登録された選手がいません" in body, "断り書きが出る", body[:120])
    check(pg.locator(".stats-switch").count() == 1, "切り替えの行は残る")

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
