# -*- coding: utf-8 -*-
"""land_test.py — 横向きのスコアボードの作り直し（本人の指示 2026-08-21 / 段階5）

対象:
  1. マスワリ・エース・セーフティが各プレーヤーのパネルの脇にある（縦横とも）
  2. 3つとも「押すと1回ぶん増える」カウント式になっている
  3. ブレイクしていない側のマスワリ・エースは押せない（回数は読める）
  4. セーフティは両側とも押せて、押した側だけ数字が増える
  5. マスワリを押すとスコアも増える（今までどおり）
  6. 横向き: スコアの枠が大きく、数字も大きい（正方形に近い）
  7. 横向き: ラック数・イニング数が上の帯にある
  8. ブレイク権はパネルの中の BREAK の札で示す（帯は縦横とも出さない）
  9. 縦向きに戻すとラック数が元の場所へ戻る
 10. 横スクロールが出ない／画面からはみ出さない
 11. 押せる大きさ（44px以上）を守っている

実行: python _test/land_test.py
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

PORT = {"width": 390, "height": 844}
LAND = {"width": 844, "height": 390}

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def flag_labels(pg, side):
    return pg.eval_on_selector_all(
        "#panelFlags" + side + " button .sf-name", "e => e.map(x => x.textContent)")


def flag_count(pg, side, label):
    return pg.evaluate(
        """(a) => {
          const b = [...document.querySelectorAll('#panelFlags' + a.side + ' button')]
            .find(x => (x.querySelector('.sf-name') || {}).textContent === a.label);
          return b ? (b.querySelector('.sf-count') || {}).textContent : null;
        }""", {"side": side, "label": label})


def flag_btn(pg, side, label):
    return pg.locator("#panelFlags" + side + " button").filter(
        has=pg.locator(".sf-name", has_text=label)).first


def start_match(pg):
    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    for n in ["たいら", "たかのぶ"]:
        helpers.add_player(pg, n)
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport=PORT)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)
    start_match(pg)
    check(not pg.eval_on_selector("#screenMatch", "e => e.hidden"), "試合が始まる")

    # ================= 1・2. 各サイドに3つ =================
    section("1・2. 各プレーヤーの側に3つ並ぶ（縦向き）")
    for sd in ["A", "B"]:
        labels = flag_labels(pg, sd)
        check(labels == ["マスワリ", "ブレイクエース", "セーフティ"],
              sd + "側に3つ並ぶ", labels)
    check(pg.eval_on_selector_all("#panelFlagsA button .sf-count", "e => e.length") == 3,
          "3つとも回数の欄がある")
    check(pg.eval_on_selector_all("#flagButtons button", "e => e.length") == 0,
          "下のまとめ欄にはボタンが残っていない",
          pg.eval_on_selector_all("#flagButtons button", "e => e.textContent"))

    # ================= 11. 押せる大きさ =================
    section("11. 押せる大きさ")
    small = pg.eval_on_selector_all(
        ".panel-flags button",
        "e => e.filter(x => x.getBoundingClientRect().height < 44)"
        ".map(x => x.textContent + ':' + Math.round(x.getBoundingClientRect().height))")
    check(not small, "44px未満のボタンが無い（縦向き）", small)

    # ================= 3. ブレイクしていない側 =================
    section("3. ブレイクしていない側は押せない")
    breaker = pg.evaluate("() => document.getElementById('breakMarkA').textContent"
                          " === 'BREAK' ? 'A' : 'B'")
    other = "B" if breaker == "A" else "A"
    for lab in ["マスワリ", "ブレイクエース"]:
        check(not flag_btn(pg, breaker, lab).is_disabled(),
              "ブレイク側の「" + lab + "」は押せる")
        check(flag_btn(pg, other, lab).is_disabled(),
              "反対側の「" + lab + "」は押せない")
    check(flag_count(pg, other, "マスワリ") == "0", "押せない側も回数は読める",
          flag_count(pg, other, "マスワリ"))

    # ================= 4. セーフティ =================
    section("4. セーフティ")
    check(not flag_btn(pg, "A", "セーフティ").is_disabled(), "A側は押せる")
    check(not flag_btn(pg, "B", "セーフティ").is_disabled(), "B側も押せる")
    flag_btn(pg, "A", "セーフティ").click()
    pg.wait_for_timeout(500)
    check(flag_count(pg, "A", "セーフティ") == "1", "押した側が1になる",
          flag_count(pg, "A", "セーフティ"))
    check(flag_count(pg, "B", "セーフティ") == "0", "反対側は0のまま",
          flag_count(pg, "B", "セーフティ"))

    # ================= 5. マスワリでスコアが増える =================
    section("5. マスワリを押すとスコアが増える")
    before = pg.text_content("#score" + breaker)
    flag_btn(pg, breaker, "マスワリ").click()
    pg.wait_for_timeout(700)
    after = pg.text_content("#score" + breaker)
    check(int(after) == int(before) + 1, "スコアが1増える", before + " -> " + after)
    # 回数はどちらかの側で1になっている（ブレイク権が入れ替わるため側を特定しない）
    n_all = (flag_count(pg, "A", "マスワリ") or "0") + (flag_count(pg, "B", "マスワリ") or "0")
    check("1" in n_all, "マスワリの回数が1になる", n_all)

    # ================= 横向きへ =================
    section("6. 横向き: スコアの枠と数字")
    pg.set_viewport_size(LAND)
    pg.wait_for_timeout(800)
    box = pg.eval_on_selector("#panelA", "e => { const r = e.getBoundingClientRect();"
                              " return {w: Math.round(r.width), h: Math.round(r.height)}; }")
    check(box["h"] >= 140, "枠の高さが140px以上（前は60px）", box)
    ratio = box["h"] / float(box["w"]) if box["w"] else 0
    check(ratio >= 0.45, "縦横の比が正方形に近づいている（0.45以上）",
          str(box) + " ratio=" + str(round(ratio, 2)))
    fs = pg.eval_on_selector("#scoreA", "e => parseFloat(getComputedStyle(e).fontSize)")
    check(fs >= 44, "数字が44px以上", fs)
    pg.screenshot(path=os.path.join(SHOTS, "land_scoreboard.png"))

    section("横向き: 記録のボタンはスコアの外側")
    # 2026-08-21 の指示で「外側に置く」に変えた。
    # 内側（2つのスコアの間）に置くと数字と重なって読めないため
    pos = pg.evaluate("""() => {
      const pa = document.getElementById('panelA').getBoundingClientRect();
      const fa = document.getElementById('panelFlagsA').getBoundingClientRect();
      const pb = document.getElementById('panelB').getBoundingClientRect();
      const fb = document.getElementById('panelFlagsB').getBoundingClientRect();
      return {aOut: fa.right <= pa.left + 2, bOut: fb.left >= pb.right - 2,
              fa: Math.round(fa.right), pa: Math.round(pa.left),
              fb: Math.round(fb.left), pb: Math.round(pb.right)};
    }""")
    check(pos["aOut"], "A側のボタンがスコアの左（外側）にある", pos)
    check(pos["bOut"], "B側のボタンがスコアの右（外側）にある", pos)
    labels_l = flag_labels(pg, "A")
    check(labels_l == ["マスワリ", "ブレイクエース", "セーフティ"],
          "横向きでも3つ並ぶ", labels_l)
    small_l = pg.eval_on_selector_all(
        ".panel-flags button",
        "e => e.filter(x => x.getBoundingClientRect().height < 44)"
        ".map(x => x.textContent + ':' + Math.round(x.getBoundingClientRect().height))")
    check(not small_l, "44px未満のボタンが無い（横向き）", small_l)

    # ================= 7. ラック数・イニング数 =================
    section("7. 横向き: ラック数は上の帯")
    inbar = pg.eval_on_selector(
        "#rackInfo", "e => !!e.closest('#screenMatch .topbar')")
    check(inbar, "ラック数が上の帯にある")
    check(pg.eval_on_selector("#inningInfo", "e => !!e.closest('#screenMatch .topbar')"),
          "イニング数も同じ帯にある")
    check(pg.is_visible("#rackInfo"), "ラック数が見えている")

    # ================= 8. ブレイクの帯 =================
    section("8. 横向き: ブレイクの帯")
    shown = pg.eval_on_selector(
        "#breakBanner", "e => getComputedStyle(e).display !== 'none'")
    check(not shown, "ブレイクの帯は出さない")
    mark = pg.eval_on_selector_all(".score-panel .breakmark",
                                   "e => e.map(x => x.textContent)")
    check("BREAK" in mark, "パネルの中に BREAK の札が出ている", mark)

    # ================= 10. はみ出し =================
    section("10. 画面からはみ出さない")
    check(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"),
          "横スクロールが出ない",
          pg.evaluate("() => document.documentElement.scrollWidth + '/' + window.innerWidth"))
    over = pg.evaluate("""() => {
      const ids = ['panelA','panelB','panelFlagsA','panelFlagsB','turnBtn'];
      return ids.filter(id => { const e = document.getElementById(id);
        if (!e || e.hidden) return false;
        const r = e.getBoundingClientRect();
        return r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1; });
    }""")
    check(not over, "主なボタンが画面の外に出ていない", over)

    # ================= 9. 縦向きに戻す =================
    section("9. 縦向きに戻す")
    pg.set_viewport_size(PORT)
    pg.wait_for_timeout(800)
    check(not pg.eval_on_selector("#rackInfo", "e => !!e.closest('#screenMatch .topbar')"),
          "ラック数が元の場所へ戻る")
    check(pg.eval_on_selector("#rackInfo", "e => !!e.closest('.match-info')"),
          "ラック情報の行に戻っている")
    # ブレイクの帯は 2026-08-20 の指示で縦横とも出していない。
    # ブレイク権はパネルの中の BREAK の札で示す
    check(not pg.eval_on_selector("#breakBanner",
                                  "e => getComputedStyle(e).display !== 'none'"),
          "縦向きでもブレイクの帯は出さない")
    check("BREAK" in pg.eval_on_selector_all(".score-panel .breakmark",
                                             "e => e.map(x => x.textContent)"),
          "縦向きでもパネルの BREAK の札で分かる")

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
