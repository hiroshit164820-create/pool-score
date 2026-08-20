# -*- coding: utf-8 -*-
"""slice1_test.py — スライス1（表示の修正）の検証

対象（本人指示16件のうち）:
  1. ダブルスで選んだ人を塗りつぶして白文字にする
  2. スコア表のテキストが重ならない（マスと文字を読める大きさに）
  3. スコアの数字がカードの真ん中寄りにある
  4. ターン交代の点線が地の色と区別できる
  6. 種目のルール説明が選んだ種目のすぐ下に出る
  7. 標準ボールに「パラジウム」が付く
  8. 1人目に選んだ人が2人目の候補から消える

実行: python _test/slice1_test.py
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


def rgb(page, sel, prop):
    return page.eval_on_selector(sel, "(e,p)=>getComputedStyle(e)[p]", prop)


def to_rgb(s):
    """'rgb(11, 99, 214)' -> (11,99,214)"""
    nums = [int(x) for x in __import__("re").findall(r"\d+", s or "")[:3]]
    return tuple(nums) if len(nums) == 3 else None


def luminance(c):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


SECOND_CANDIDATES_JS = """() => {
    const inp = document.getElementById('inNameA2');
    const w = inp.closest('.member-row').nextElementSibling;
    return Array.from(w.querySelectorAll('.picker-chip .pc-name')).map(e => e.textContent);
}"""

PICK_SECOND_JS = """(name) => {
    const inp = document.getElementById('inNameA2');
    const w = inp.closest('.member-row').nextElementSibling;
    const c = Array.from(w.querySelectorAll('.picker-chip'))
        .find(e => e.textContent.indexOf(name) >= 0);
    if (c) c.click();
}"""

TEAM_B_CANDIDATES_JS = """() => {
    const f = document.getElementById('inNameB').closest('.team-field');
    return Array.from(f.querySelectorAll('.picker-chip .pc-name')).map(e => e.textContent);
}"""

PICK_TEAM_B_JS = """(name) => {
    const f = document.getElementById('inNameB').closest('.team-field');
    const row = document.getElementById('inNameB').closest('.member-row');
    const w = row.nextElementSibling;
    const c = Array.from(w.querySelectorAll('.picker-chip'))
        .find(e => e.textContent.indexOf(name) >= 0);
    if (c) c.click();
}"""

PICK_TEAM_B2_JS = """(name) => {
    const inp = document.getElementById('inNameB2');
    if (!inp) return;
    const w = inp.closest('.member-row').nextElementSibling;
    const c = Array.from(w.querySelectorAll('.picker-chip'))
        .find(e => e.textContent.indexOf(name) >= 0);
    if (c) c.click();
}"""

INK_JS = """() => getComputedStyle(document.documentElement).getPropertyValue('--ink')"""

SCORE_POS_JS = """() => {
    const p = document.getElementById('panelA');
    const v = document.getElementById('scoreA');
    const pr = p.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    return { center: ((vr.top + vr.height / 2) - pr.top) / pr.height, panelH: pr.height };
}"""

CELL_BOX_JS = """() => {
    const c = document.querySelector('.sheet-cell');
    const r = c.getBoundingClientRect();
    const st = getComputedStyle(c);
    return { w: r.width, h: r.height, fs: parseFloat(st.fontSize) };
}"""

OVERFLOW_JS = """() => {
    const cells = Array.from(document.querySelectorAll('.sheet-cell'));
    let bad = 0;
    cells.forEach(c => { if (c.scrollWidth > c.clientWidth + 1) bad++; });
    return bad;
}"""

CROSS_JS = """() => {
    const grid = document.querySelectorAll('.sheet-grid')[0];
    const cells = Array.from(grid.children);
    let bad = 0;
    for (let i = 1; i < cells.length; i++) {
        const a = cells[i - 1].getBoundingClientRect();
        const b = cells[i].getBoundingClientRect();
        const sameRow = Math.abs(a.top - b.top) < 2;
        if (sameRow && b.left < a.right - 0.5) bad++;
    }
    return bad;
}"""


def hex_rgb(h):
    """'#1a1408' -> (26,20,8)"""
    h = (h or "").strip().lstrip("#")
    if len(h) != 6:
        return None
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))



with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("指示7: 標準ボールに「パラジウム」が付く")
    label = pg.evaluate("() => BALL_SETS.standard.label")
    check("パラジウム" in label, "標準ボールの名前にパラジウムが入る", label)
    check("標準" in label, "「標準」も残っている（探せなくならないように）", label)

    # ================================================================
    section("指示2(0820): 種目のルール説明を出さない")
    # 本人指示（2026-08-20）でルール説明は全種目で削除した。
    # 以前は「選んだ種目の直下に出る」ことを検査していた項目を、
    # 「どの種目を選んでも出ない」に反転させて残している。
    for gid in ("rotation", "9ball", "10ball"):
        helpers.pick_game(pg, gid)
        pg.wait_for_timeout(200)
        check(
            pg.locator("#gameNote").count() == 0,
            "%s でルール説明の要素が無い" % gid,
            pg.locator("#gameNote").count(),
        )
    # カイルン（ハウス設定を持つ種目）でも出さない
    if helpers.pick_game(pg, "kailun") is not False:
        pg.wait_for_timeout(200)
        check(pg.locator("#gameNote").count() == 0, "カイルンでもルール説明が無い")

    # ================================================================
    section("指示1・8: ダブルスの選択表示と候補の除外")
    # 選手を4人登録する
    pg.evaluate("() => PLAYERS.open()")
    pg.wait_for_timeout(300)
    for nm in ["あきら", "いすず", "うたの", "えいじ"]:
        helpers.add_player(pg, nm)
    pg.click("#tabSetup")  # 選手一覧の「新しい試合」は撤去したので下部タブから
    pg.wait_for_timeout(300)

    helpers.pick_game(pg, "9ball_doubles")
    pg.wait_for_timeout(250)
    total = pg.locator(".team-field:has(#inNameA) .picker-chip").count()
    check(total == 4, "チームAの候補に4人出る", total)

    pg.click('.team-field:has(#inNameA) .picker-chip:has-text("あきら")')
    pg.wait_for_timeout(350)
    check((pg.input_value("#inNameA") or "") == "あきら", "1人目の欄に名前が入る",
          pg.input_value("#inNameA"))

    chosen = ".team-field:has(#inNameA) .picker-chip.is-chosen"
    check(pg.locator(chosen).count() == 1, "選んだ人だけが塗られる",
          pg.locator(chosen).count())
    check((pg.text_content(chosen) or "").strip().startswith("あきら"),
          "塗られているのが選んだ本人", pg.text_content(chosen))
    fg = to_rgb(rgb(pg, chosen, "color"))
    bgA = to_rgb(rgb(pg, chosen, "backgroundColor"))
    check(fg == (255, 255, 255), "文字が白", fg)
    check(bgA is not None and bgA != (255, 255, 255), "背景が塗りつぶされている", bgA)
    check(contrast(fg, bgA) >= 4.5, "白文字と地色のコントラストが4.5:1以上",
          round(contrast(fg, bgA), 2))

    names2 = pg.locator(".team-field:has(#inNameA) #inNameA2").count()
    check(names2 == 1, "2人目の欄が出る", names2)
    cand2 = pg.evaluate(SECOND_CANDIDATES_JS)
    check("あきら" not in cand2, "1人目に選んだ人が2人目の候補に出ない", cand2)
    check(len(cand2) == 3, "2人目の候補は残り3人", cand2)

    pg.evaluate(PICK_SECOND_JS, "いすず")
    pg.wait_for_timeout(350)
    check((pg.input_value("#inNameA2") or "") == "いすず", "2人目の欄に名前が入る",
          pg.input_value("#inNameA2"))
    check((pg.input_value("#inNameA") or "") == "あきら",
          "描き直しても1人目の名前が消えない", pg.input_value("#inNameA"))

    candB = pg.evaluate(TEAM_B_CANDIDATES_JS)
    check("あきら" not in candB and "いすず" not in candB,
          "チームAで選んだ2人はチームBの候補にも出ない", candB)

    pg.evaluate(PICK_TEAM_B_JS, "うたの")
    pg.wait_for_timeout(350)
    chosenB = ".team-field:has(#inNameB) .picker-chip.is-chosen"
    bgB = to_rgb(rgb(pg, chosenB, "backgroundColor"))
    fgB = to_rgb(rgb(pg, chosenB, "color"))
    check(fgB == (255, 255, 255), "チームBも白文字", fgB)
    check(bgB != bgA, "チームAとBで塗る色が違う", (bgA, bgB))
    check(contrast(fgB, bgB) >= 4.5, "チームBもコントラスト4.5:1以上",
          round(contrast(fgB, bgB), 2))
    pg.screenshot(path=os.path.join(SHOTS, "slice1_doubles_pick.png"))

    # ================================================================
    section("指示3・4: スコアパネルの数字位置とターンの点線")
    pg.evaluate(PICK_TEAM_B2_JS, "えいじ")
    pg.wait_for_timeout(350)
    helpers.set_goal(pg, 5)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)

    turn = pg.locator(".score-panel.is-turn")
    check(turn.count() == 1, "撞いている側にだけ印が付く", turn.count())
    oc = to_rgb(rgb(pg, ".score-panel.is-turn", "outlineColor"))
    panel_bg = to_rgb(rgb(pg, ".score-panel.is-turn", "backgroundColor"))
    ink_raw = pg.evaluate(INK_JS) or "#1a1408"
    ink = hex_rgb(ink_raw.strip())
    check(oc != ink, "点線の色が地の黒（--ink）ではない", (oc, ink))
    check(contrast(oc, panel_bg) >= 3.0, "点線とパネル地色のコントラストが3:1以上",
          round(contrast(oc, panel_bg), 2))
    ow = rgb(pg, ".score-panel.is-turn", "outlineWidth")
    check(float(ow.replace("px", "")) >= 4, "点線が4px以上の太さ", ow)

    pos = pg.evaluate(SCORE_POS_JS)
    check(0.40 <= pos["center"] <= 0.68,
          "数字の中心がパネルの40〜68%の位置にある（下に沈んでいない）",
          round(pos["center"], 3))
    pg.screenshot(path=os.path.join(SHOTS, "slice1_scoreboard.png"))

    # ================================================================
    section("指示2: スコア表のマスが読める大きさ")
    pg.evaluate("() => { localStorage.removeItem('pool_session'); }")
    pg.goto(URL)
    pg.wait_for_timeout(500)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(250)
    pg.fill("#inNameA", "あきら")
    pg.fill("#inNameB", "うたの")
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)

    has_sheet = pg.locator(".sheet-cell").count()
    check(has_sheet > 0, "JPAスコアシートのマスが出る", has_sheet)
    box = pg.evaluate(CELL_BOX_JS)
    check(box["h"] >= 28, "マスの高さが28px以上", round(box["h"], 1))
    check(box["w"] >= 28, "マスの幅が28px以上", round(box["w"], 1))
    check(box["fs"] >= 13, "マスの文字が13px以上", box["fs"])

    overlap = pg.evaluate(OVERFLOW_JS)
    check(overlap == 0, "どのマスも数字がはみ出していない", overlap)

    cross = pg.evaluate(CROSS_JS)
    check(cross == 0, "隣り合うマスが重なっていない", cross)
    pg.screenshot(path=os.path.join(SHOTS, "slice1_sheet.png"))

    # ================================================================
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
