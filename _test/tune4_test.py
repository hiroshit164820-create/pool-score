# -*- coding: utf-8 -*-
"""tune4_test.py — 2026-08-21 の指示の検証（カイルン以外）

カイルンの5件は kailun_test.py が見る。ここではそれ以外を確かめる。

対象:
  1. 配置図: 台が潰れない（どの画面幅でもラシャが縦：横＝2：1）
  2. 配置図: ラシャがグレー rgb(125,125,125)
  3. 配置図: ポイント（ダイヤ）がレール（茶色）の上にある
  4. ローテーション: スコアボードに現在の得点が出る
  5. 説明文がスマホ表示で2行以上にならない
  6. 番号がどのセットでも「円形・白地・黒枠・黒文字」
  7. アラミス ブラックの9番以降が「真ん中が色・上下が黒」
  8. 勝利条件に「セット数」があり、5セットまで選べる／セット制が動く
  9. ボウラードの結果がイニングではなくストライク／スペア／ミス
 10. 点数のプルダウンに30点以下が無い
 11. 横向きにするとAが左・Bが右に並ぶ（縦向きは今までどおり上下）

実行: python _test/tune4_test.py
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


# 実際の行数を数える（余白の影響を受けないよう Range の矩形で見る）
LINES_JS = """() => {
  function lineCount(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    const rects = [...r.getClientRects()].filter(x => x.width > 0 && x.height > 0);
    if (!rects.length) return 0;
    return new Set(rects.map(x => Math.round(x.top))).size;
  }
  const sel = '.hint, .tap-hint, .btn-sub, .note, .gp-note, .li-sub, .bg-who,'
            + ' .sp-note, .jpa-result, .bp-who, p';
  const out = [];
  ['section.screen.active ', '.modal:not([hidden]) '].forEach(sc => {
    document.querySelectorAll(sc + sel).forEach(el => {
      if (!el.getBoundingClientRect().height || !el.textContent.trim()) return;
      if (lineCount(el) >= 2) out.push(el.textContent.trim().replace(/\\s+/g, ' '));
    });
  });
  return out;
}"""

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================= 1〜3 配置図 =================
    section("1〜3. 配置図（潰れ・ラシャの色・ポイントの位置）")
    pg.click("#tabLayout")
    pg.wait_for_timeout(500)
    for n in ["0", "1", "9"]:
        pg.click(".tray-ball[data-ball='%s']" % n)
    pg.wait_for_timeout(300)

    geo = pg.evaluate("""() => {
      const t = document.getElementById('poolTable');
      const r = t.getBoundingClientRect();
      const cs = getComputedStyle(t);
      const rail = parseFloat(cs.borderTopWidth);
      const feltW = r.width - rail * 2;
      const feltH = r.height - rail * 2;
      return {w: Math.round(r.width), rail: rail,
              ratio: +(feltH / feltW).toFixed(2), bg: cs.backgroundColor};
    }""")
    check(abs(geo["ratio"] - 2) < 0.03, "ラシャが縦：横＝2：1", geo)
    check(geo["w"] >= 200, "台が潰れていない（幅200px以上）", geo)
    check(geo["bg"] == "rgb(125, 125, 125)", "ラシャがグレー", geo["bg"])

    dots = pg.evaluate("""() => {
      const t = document.getElementById('poolTable').getBoundingClientRect();
      const rail = parseFloat(getComputedStyle(document.getElementById('poolTable')).borderTopWidth);
      // ラシャ（内側）の範囲
      const inner = {l: t.left + rail, r: t.right - rail, t: t.top + rail, b: t.bottom - rail};
      let onRail = 0, onFelt = 0;
      document.querySelectorAll('.pt-dot').forEach(d => {
        const r = d.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const insideFelt = cx > inner.l && cx < inner.r && cy > inner.t && cy < inner.b;
        if (insideFelt) onFelt++; else onRail++;
      });
      return {onRail: onRail, onFelt: onFelt};
    }""")
    check(dots["onFelt"] == 0 and dots["onRail"] == 18,
          "ポイント18個すべてがレールの上にある", dots)
    pg.screenshot(path=os.path.join(SHOTS, "tune4_layout.png"))

    # 幅を変えても比率が崩れないか（実機で潰れた件）
    bad = []
    for w, h in [(280, 640), (320, 568), (360, 640), (412, 915), (768, 1024)]:
        pg.set_viewport_size({"width": w, "height": h})
        pg.wait_for_timeout(250)
        g = pg.evaluate("""() => {
          const t = document.getElementById('poolTable');
          const r = t.getBoundingClientRect();
          const rail = parseFloat(getComputedStyle(t).borderTopWidth);
          return +((r.height - rail * 2) / (r.width - rail * 2)).toFixed(2);
        }""")
        if abs(g - 2) > 0.03:
            bad.append((w, h, g))
    check(not bad, "画面幅を変えても比率が崩れない", bad)
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(250)

    # ================= 4 ローテーション =================
    section("4. ローテーションのスコアが出る")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    pg.click('#ballGrid .ball-btn[data-ball="3"]')
    pg.wait_for_timeout(300)
    sb = pg.evaluate("""() => {
      const s = document.querySelector('#screenMatch .scoreboard').getBoundingClientRect();
      const a = document.getElementById('scoreA').getBoundingClientRect();
      const b = document.getElementById('scoreB').getBoundingClientRect();
      return {h: Math.round(s.height), aVisible: a.height > 10 && a.width > 3,
              bVisible: b.height > 10 && b.width > 3,
              inside: a.bottom <= s.bottom + 1 && b.bottom <= s.bottom + 1};
    }""")
    check(sb["h"] > 90, "スコアボードが潰れていない", sb)
    check(sb["aVisible"] and sb["bVisible"], "両方の得点が見えている", sb)
    check(sb["inside"], "得点がスコアボードの中に収まっている", sb)
    check(pg.inner_text("#scoreA") == "3", "得点が入っている", pg.inner_text("#scoreA"))
    pg.screenshot(path=os.path.join(SHOTS, "tune4_rotation.png"))

    # ================= 6 番号の見た目 =================
    section("6. 番号は円形・白地・黒枠・黒文字")
    num = pg.eval_on_selector("#ballGrid .bb-num", """e => {
      const s = getComputedStyle(e);
      return {bg: s.backgroundColor, color: s.color, radius: s.borderTopLeftRadius,
              border: s.borderTopColor, clip: s.clipPath};
    }""")
    check(num["bg"] == "rgb(255, 255, 255)", "白地", num["bg"])
    check(num["color"] == "rgb(17, 17, 17)", "黒文字", num["color"])
    check(num["border"] == "rgb(17, 17, 17)", "黒い枠線", num["border"])
    check(num["radius"] == "50%", "円形", num["radius"])
    check(num["clip"] in ("none", ""), "三角・菱形の切り抜きが無い", num["clip"])
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(400)

    # ================= 7 アラミス ブラック =================
    section("7. アラミス ブラックのストライプ")
    ap = pg.evaluate("""() => {
      const a = ballAppearance('aramith_black', 11);
      const s = ballAppearance('standard', 11);
      return {black: a, standard: s};
    }""")
    check(ap["black"]["base"].lower() == "#141414",
          "地（上下）が黒", ap["black"]["base"])
    check(ap["black"]["band"].lower() != "#141414",
          "帯（真ん中）が色", ap["black"]["band"])
    check(ap["standard"]["band"] and ap["black"]["band"],
          "通常セットと同じく真ん中が帯", (ap["standard"]["band"], ap["black"]["band"]))

    # ================= 8 セット数 =================
    section("8. セット数")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(300)
    sets = pg.locator('#goalArea .sets-chips .chip').all_text_contents()
    check(sets == ["1セット", "2セット", "3セット", "4セット", "5セット"],
          "1〜5セットのボタンが5つ並ぶ", sets)
    one_row = pg.evaluate("""() => {
      const c = [...document.querySelectorAll('#goalArea .sets-chips .chip')];
      if (!c.length) return false;
      const tops = new Set(c.map(x => Math.round(x.getBoundingClientRect().top)));
      return tops.size === 1;
    }""")
    check(one_row, "5つとも1行に並ぶ")
    order = pg.evaluate("""() => {
      const fields = [...document.querySelectorAll('#goalArea .field')];
      const goal = fields.findIndex(f => /先取で勝ちか/.test(f.textContent));
      const sets = fields.findIndex(f => f.querySelector('.sets-chips'));
      return {goal: goal, sets: sets};
    }""")
    check(order["sets"] > order["goal"] >= 0, "ラック数の下にある", order)
    check(pg.get_attribute('#goalArea .sets-chips .chip', "aria-pressed") == "true",
          "既定は1セット")

    # 3セット先取で動くか（3先×3セット）
    pg.click('#goalArea .sets-chips .chip:text-is("3セット")')
    pg.wait_for_timeout(250)
    helpers.set_goal(pg, 3)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    check("セット 0-0" in pg.inner_text("#matchSubtitle"),
          "帯にセットの状況が出る", pg.inner_text("#matchSubtitle"))
    for _ in range(3):
        pg.click("#panelA")
        pg.wait_for_timeout(180)
    pg.wait_for_timeout(300)
    st = pg.inner_text("#matchSubtitle")
    check("セット 1-0" in st, "3ラック取ると1セット取る", st)
    check(pg.inner_text("#scoreA") == "0", "セットが変わると得点は0に戻る",
          pg.inner_text("#scoreA"))
    check(pg.eval_on_selector("#finishModal", "e => e.hidden"),
          "1セット取っただけでは試合は終わらない")
    for _ in range(6):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(180)
    pg.wait_for_timeout(400)
    check(not pg.eval_on_selector("#finishModal", "e => e.hidden"),
          "3セット取ると試合が終わる")
    ftxt = pg.inner_text("#finishSummary")
    check("セット" in ftxt and "3" in ftxt, "結果にセットの数が出る", ftxt[:200])
    pg.screenshot(path=os.path.join(SHOTS, "tune4_sets.png"))
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(600)

    # ================= 9 ボウラード =================
    section("9. ボウラードの結果")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "bowlard")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    # 10フレーム、毎回10本（オールストライク）
    for _ in range(14):
        btn = pg.locator('#bowlPad button:text-is("10")')
        if not btn.count() or pg.locator("#bowlPad").is_hidden():
            break
        btn.first.click()
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(400)
    if pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#finishBtn")
        pg.wait_for_timeout(500)
    ftxt = pg.inner_text("#finishSummary")
    check("ストライク" in ftxt, "結果にストライクの数が出る", ftxt[:200])
    check("スペア" in ftxt, "結果にスペアの数が出る", ftxt[:200])
    check("ミス" in ftxt, "結果にミスの数が出る", ftxt[:200])
    check("イニング" not in ftxt, "イニング数は出さない", ftxt[:200])
    pg.screenshot(path=os.path.join(SHOTS, "tune4_bowlard.png"))
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(600)
    hist = pg.inner_text("#screenHistory") if pg.locator("#screenHistory").count() else ""
    check("ストライク" in hist, "履歴にも残る", hist[:200])

    # ================= 10 プルダウン =================
    section("10. 点数のプルダウン")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "straight")
    pg.wait_for_timeout(300)
    opts = pg.eval_on_selector_all("#goalArea select.goal-more option",
                                   "els => els.map(e => e.value).filter(Boolean).map(Number)")
    check(opts and min(opts) >= 40, "30点以下が無い", sorted(opts)[:6])

    # ================= 5 説明文 =================
    section("5. 説明文が2行以上にならない")
    多行 = []
    for gid in ["9ball", "10ball", "8ball", "rotation", "straight", "bowlard",
                "jpa_9ball", "jpa_8ball"]:
        helpers.pick_game(pg, gid)
        pg.wait_for_timeout(300)
        多行 += pg.evaluate(LINES_JS)
        try:
            helpers.set_handicap_mode(pg, True)
            pg.wait_for_timeout(250)
            多行 += pg.evaluate(LINES_JS)
            helpers.set_handicap_mode(pg, False)
            pg.wait_for_timeout(200)
        except Exception:
            pass
    for tab in ["#tabPlayers", "#tabStats", "#tabHistory", "#tabLayout", "#tabHome"]:
        if pg.locator(tab).count():
            pg.click(tab)
            pg.wait_for_timeout(400)
            多行 += pg.evaluate(LINES_JS)
    多行 = sorted(set(多行))
    check(not 多行, "2行以上の説明文が無い", 多行[:5])

    # ================= 11 横向き =================
    section("11. 横向きでAが左・Bが右")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)

    port = pg.evaluate("""() => {
      const a = document.getElementById('panelA').getBoundingClientRect();
      const b = document.getElementById('panelB').getBoundingClientRect();
      return {stacked: b.top > a.bottom - 1};
    }""")
    check(port["stacked"], "縦向きは今までどおり上下", port)

    pg.set_viewport_size({"width": 844, "height": 390})
    pg.wait_for_timeout(400)
    land = pg.evaluate("""() => {
      const a = document.getElementById('panelA').getBoundingClientRect();
      const b = document.getElementById('panelB').getBoundingClientRect();
      const va = document.getElementById('scoreA').getBoundingClientRect();
      const sc = document.getElementById('screenMatch');
      return {sideBySide: Math.abs(a.top - b.top) < 8 && b.left > a.left,
              scoreInside: va.right <= a.right + 1,
              fits: sc.scrollHeight <= sc.clientHeight + 1,
              bottomVisible: document.querySelector('.bottom-bar')
                .getBoundingClientRect().bottom <= window.innerHeight + 1,
              noSideScroll: document.documentElement.scrollWidth <= window.innerWidth};
    }""")
    check(land["sideBySide"], "横向きはAが左・Bが右", land)
    check(land["scoreInside"], "スコアが枠からはみ出していない", land)
    check(land["fits"] and land["bottomVisible"], "横向きでも1画面に収まる", land)
    check(land["noSideScroll"], "横スクロールが出ない", land)
    pg.screenshot(path=os.path.join(SHOTS, "tune4_landscape.png"))

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
