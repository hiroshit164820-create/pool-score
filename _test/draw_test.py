# -*- coding: utf-8 -*-
"""draw_test.py — 配置図の「描画する」（なぞった通りの線）の検証
（本人の指示 2026-08-20）

対象:
  1. 「直線を引く」と「描画する」が別のボタンとして並ぶ
  2. どちらか一方しか入らない（片方を押すともう片方が切れる）
  3. 描画: 指でなぞった通りの線になる（曲げた跡が残る）
  4. 描画中は球を掴めない
  5. 描いた線を押すと、その1本だけが消える（直線と混ざっても正しく選ぶ）
  6. 「一つ前に戻る」「一つ次に進む」で描いた線も戻る
  7. 「全部どける」で描いた線も消える
  8. 保存 → 呼び出しで描いた線が戻る
  9. 描画を入れる前に保存した配置（strokes が無い）を呼び出しても落ちない
 10. 説明と一覧に「描画 N本」が出る

実行: python _test/draw_test.py
"""
import sys, io, os, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

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


def trace(pg, pts, steps_per_leg=6):
    """割合(0〜1)の点列をなぞる"""
    box = pg.locator("#poolTable").bounding_box()

    def at(q):
        return (box["x"] + box["width"] * q[0], box["y"] + box["height"] * q[1])

    x, y = at(pts[0])
    pg.mouse.move(x, y)
    pg.mouse.down()
    for i in range(1, len(pts)):
        x0, y0 = at(pts[i - 1])
        x1, y1 = at(pts[i])
        for k in range(1, steps_per_leg + 1):
            t = k / float(steps_per_leg)
            pg.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
            pg.wait_for_timeout(15)
    pg.mouse.up()
    pg.wait_for_timeout(300)


def tap(pg, x, y):
    box = pg.locator("#poolTable").bounding_box()
    pg.mouse.move(box["x"] + box["width"] * x, box["y"] + box["height"] * y)
    pg.mouse.down()
    pg.wait_for_timeout(60)
    pg.mouse.up()
    pg.wait_for_timeout(300)


def counts(pg):
    return pg.evaluate("""() => ({
      line: document.querySelectorAll('.pt-lines line.ptl-main').length,
      poly: document.querySelectorAll('.pt-lines polyline.ptl-main').length,
    })""")


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)
    pg.click("#tabLayout")
    pg.wait_for_timeout(700)

    # ================= 1・2. 2つのボタン =================
    section("1・2. 「直線を引く」と「描画する」")
    check(pg.locator("#layoutLineBtn").count() == 1, "「直線を引く」がある")
    check(pg.locator("#layoutDrawBtn").count() == 1, "「描画する」がある")
    for bid in ["#layoutLineBtn", "#layoutDrawBtn"]:
        box = pg.locator(bid).bounding_box()
        check(box and box["height"] >= 44, bid + " が44px以上", box)
    # 2026-08-22：本人の指示で台の左の列へ移した。縦に並ぶ（同じ左端で上下）
    pos = pg.evaluate("""() => {
      const a = document.getElementById('layoutLineBtn').getBoundingClientRect();
      const b = document.getElementById('layoutDrawBtn').getBoundingClientRect();
      const t = document.getElementById('poolTable').getBoundingClientRect();
      return {sameCol: Math.abs(a.left - b.left) < 4, order: a.top < b.top,
              leftOfTable: a.right <= t.left && b.right <= t.left};
    }""")
    check(pos["sameCol"] and pos["order"], "2つが縦に並ぶ", pos)
    check(pos["leftOfTable"], "2つとも台の左にある", pos)

    pg.click("#layoutDrawBtn")
    pg.wait_for_timeout(300)
    check((pg.text_content("#layoutDrawBtn") or "").strip() == "描画をやめる",
          "描画が入る", pg.text_content("#layoutDrawBtn"))
    check((pg.text_content("#layoutLineBtn") or "").strip() == "直線を引く",
          "直線は入っていない", pg.text_content("#layoutLineBtn"))
    hint = pg.text_content("#layoutHint") or ""
    check("なぞった通り" in hint, "描画の使い方が出る", hint)

    pg.click("#layoutLineBtn")
    pg.wait_for_timeout(300)
    check((pg.text_content("#layoutLineBtn") or "").strip() == "直線をやめる",
          "直線に切り替わる", pg.text_content("#layoutLineBtn"))
    check((pg.text_content("#layoutDrawBtn") or "").strip() == "描画する",
          "描画は切れる（同時には使えない）", pg.text_content("#layoutDrawBtn"))

    # ================= 3. なぞった通りの線 =================
    section("3. なぞった通りの線になる")
    pg.click("#layoutDrawBtn")   # 描画へ
    pg.wait_for_timeout(300)
    # コの字に曲げてなぞる。直線なら始点と終点しか残らない
    trace(pg, [(0.2, 0.2), (0.8, 0.2), (0.8, 0.5), (0.2, 0.5)])
    c = counts(pg)
    check(c["poly"] == 1 and c["line"] == 0, "描いた線が1本できる（直線は0本）", c)
    pts = pg.eval_on_selector(".pt-lines polyline.ptl-main",
                              "e => e.getAttribute('points').trim().split(/\\s+/)")
    check(len(pts) >= 8, "なぞった点が残っている（曲げた跡がある）", len(pts))

    # 曲がり角が入っているか。x が増えてから止まり、次に減る形
    xs = [float(q.split(",")[0]) for q in pts]
    ys = [float(q.split(",")[1]) for q in pts]
    check(max(xs) - min(xs) > 400, "横に大きく動いている", (min(xs), max(xs)))
    check(max(ys) - min(ys) > 200, "縦にも動いている（直線ではない）", (min(ys), max(ys)))
    # 最後は左へ戻っている
    check(xs[-1] < max(xs) - 300, "折り返して左へ戻っている", (xs[-1], max(xs)))
    sub = pg.text_content("#layoutSub") or ""
    check("描画 1本" in sub, "説明に「描画 1本」が出る", sub)
    pg.screenshot(path=os.path.join(SHOTS, "draw_stroke.png"))

    # ================= 4. 球を掴めない =================
    section("4. 描画中は球を掴めない")
    pg.click(".tray-ball[data-ball='1']")
    pg.wait_for_timeout(300)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1, "球が1つ置ける")
    before = pg.eval_on_selector(".tb-ball", "e => e.style.left + ',' + e.style.top")
    trace(pg, [(0.5, 0.5), (0.3, 0.7)])
    after = pg.eval_on_selector(".tb-ball", "e => e.style.left + ',' + e.style.top")
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1, "球が消えない")
    check(before == after, "球が動かない", before + " -> " + after)
    check(counts(pg)["poly"] == 2, "球の上でも描ける", counts(pg))

    # ================= 5. 押すと1本だけ消える =================
    section("5. 描いた線を押すと消える（直線と混ざっても正しく選ぶ）")
    pg.click("#layoutLineBtn")   # 直線へ
    pg.wait_for_timeout(300)
    box = pg.locator("#poolTable").bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.15, box["y"] + box["height"] * 0.85)
    pg.mouse.down()
    for k in range(1, 9):
        pg.mouse.move(box["x"] + box["width"] * (0.15 + 0.7 * k / 8.0),
                      box["y"] + box["height"] * 0.85)
        pg.wait_for_timeout(20)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    c = counts(pg)
    check(c["line"] == 1 and c["poly"] == 2, "直線1本＋描画2本になった", c)

    pg.click("#layoutDrawBtn")   # 描画へ（どちらのモードでも消せる）
    pg.wait_for_timeout(300)
    # 1本目の描画（コの字）の上辺 y=0.2 を押す
    tap(pg, 0.5, 0.2)
    c = counts(pg)
    check(c["poly"] == 1 and c["line"] == 1, "押した描画1本だけが消える", c)
    # 直線（y=0.85）を押す
    tap(pg, 0.5, 0.85)
    c = counts(pg)
    check(c["line"] == 0 and c["poly"] == 1, "直線も同じように消せる", c)
    # 何も無いところ
    n = counts(pg)
    tap(pg, 0.95, 0.05)
    check(counts(pg) == n, "線の無いところを押しても消えない", counts(pg))

    # ================= 6. 戻る・進む =================
    section("6. 「一つ前に戻る」「一つ次に進む」")
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(400)
    check(counts(pg)["line"] == 1, "消した直線が戻る", counts(pg))
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(400)
    check(counts(pg)["poly"] == 2, "消した描画も戻る", counts(pg))
    pg.click("#layoutRedoBtn")
    pg.wait_for_timeout(400)
    check(counts(pg)["poly"] == 1, "進むとまた消える", counts(pg))

    # ================= 7. 全部どける =================
    section("7. 「全部どける」")
    pg.click("#layoutClearBtn")
    pg.wait_for_timeout(400)
    c = counts(pg)
    check(c["poly"] == 0 and c["line"] == 0, "描画も直線も消える", c)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 0, "球も消える")
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(400)
    check(counts(pg)["poly"] == 1 and counts(pg)["line"] == 1,
          "戻すと全部戻る", counts(pg))

    # ================= 8. 保存 → 呼び出し =================
    section("8. 保存 → 呼び出し")
    pg.once("dialog", lambda d: d.accept("描画のテスト"))
    pg.click("#layoutSaveBtn")
    pg.wait_for_timeout(600)
    saved = pg.evaluate("() => STORE.listLayouts()[0]")
    check(saved and saved.get("strokes") and len(saved["strokes"]) == 1,
          "保存した中身に描画が入る", saved and list(saved.keys()))
    check(len(saved["strokes"][0]["pts"]) >= 5, "点も保存されている",
          saved and len(saved["strokes"][0]["pts"]))
    pg.click("#layoutClearBtn")
    pg.wait_for_timeout(400)
    if pg.eval_on_selector("#layoutListModal", "e => e.hidden"):
        pg.click("#layoutListBtn")
        pg.wait_for_timeout(400)
    listtext = pg.inner_text("#layoutList")
    check("描画 1本" in listtext, "一覧に「描画 1本」が出る", listtext[:150])
    pg.locator(".layout-item", has_text="描画のテスト").locator(
        "button", has_text="呼び出す").click()
    pg.wait_for_timeout(600)
    c = counts(pg)
    check(c["poly"] == 1 and c["line"] == 1, "呼び出すと描画も直線も戻る", c)

    # ================= 9. 古い配置 =================
    section("9. 描画を入れる前に保存した配置")
    pg.evaluate("""() => {
      const all = JSON.parse(localStorage.getItem('pool_layouts') || '[]');
      all.unshift({id:'L_old2', name:'むかしの配置',
        balls:[{n:1,x:0.3,y:0.3}],
        lines:[{x1:0.1,y1:0.1,x2:0.9,y2:0.9}],
        note:'', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()});
      localStorage.setItem('pool_layouts', JSON.stringify(all));
    }""")
    if pg.eval_on_selector("#layoutListModal", "e => e.hidden"):
        pg.click("#layoutListBtn")
        pg.wait_for_timeout(400)
    pg.locator(".layout-item", has_text="むかしの配置").locator(
        "button", has_text="呼び出す").click()
    pg.wait_for_timeout(600)
    c = counts(pg)
    check(c["poly"] == 0 and c["line"] == 1, "描画は0本・直線は戻る", c)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1, "球も戻る")

    # ================= 10. モードを切る =================
    section("10. 描画をやめる")
    pg.click("#layoutDrawBtn")
    pg.wait_for_timeout(300)
    check((pg.text_content("#layoutDrawBtn") or "").strip() == "描画する",
          "文言が戻る", pg.text_content("#layoutDrawBtn"))
    pg.locator(".tb-ball").first.click()
    pg.wait_for_timeout(400)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 0,
          "球をタップでどけられる")

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
