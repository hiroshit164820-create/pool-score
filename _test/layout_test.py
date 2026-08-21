# -*- coding: utf-8 -*-
"""layout_test.py — 練習配置の保存と呼び出しの検証（本人指示16）

用途は「練習配置の保存・呼び出し」（本人の回答）。
台の俯瞰図に球を並べて保存し、あとで同じ形を作り直すための道具で、
試合の記録とは切り離してある。

対象:
  1. 配置の画面が開く（タブから）
  2. 球を台に置ける／どけられる
  3. 指で動かして位置を決められる
  4. 名前を付けて保存できる
  5. 呼び出すと同じ位置に戻る
  6. 削除できる
  7. 試合の記録に影響しない

実行: python _test/layout_test.py
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


POSITIONS = """() => Array.from(document.querySelectorAll('.tb-ball'))
  .map(b => ({ n: b.dataset.ball, left: b.style.left, top: b.style.top }))"""

STORED = "() => JSON.parse(localStorage.getItem('pool_layouts') || '[]')"


def put(pg, label):
    # 番号は .bb-num の中に入っているため、文字ではなく data-ball で選ぶ
    n = "0" if label == "手" else label
    pg.click('.tray-ball[data-ball="%s"]' % n)
    pg.wait_for_timeout(250)


def open_list(pg):
    """保存した配置の一覧を開く（すでに開いていれば何もしない）"""
    if pg.locator("#layoutListModal").get_attribute("hidden") is not None:
        pg.click("#layoutListBtn")
        pg.wait_for_timeout(400)


def close_list(pg):
    """一覧のカードを閉じる。

    2026-08-22 から一覧は重ねて出すカードになった（本人の指示）。
    開いたままだと下の台やボタンを押せないので、用が済んだら閉じる。
    """
    if pg.locator("#layoutListModal").get_attribute("hidden") is None:
        pg.click("#layoutListCloseBtn")
        pg.wait_for_timeout(300)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 375, "height": 667})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================================================================
    section("1. 配置の画面が開く")
    check(pg.is_visible("#tabLayout"), "タブに「配置」がある")
    pg.click("#tabLayout")
    pg.wait_for_timeout(600)
    check(pg.is_visible("#screenLayout"), "配置の画面が開く")
    check(pg.is_visible("#poolTable"), "台の俯瞰図が出る")
    check(pg.locator(".tray-ball").count() == 16, "手玉＋1〜15番を置ける",
          pg.locator(".tray-ball").count())

    # 台が縦長（9フィート台は2:1）
    ratio = pg.evaluate("""() => {
      const r = document.getElementById('poolTable').getBoundingClientRect();
      return Math.round((r.height / r.width) * 100) / 100;
    }""")
    check(1.8 <= ratio <= 2.2, "台が実物の比率（縦：横＝2：1）", ratio)

    # ================================================================
    section("2. 球を置ける／どけられる")
    put(pg, "手")
    put(pg, "1")
    put(pg, "9")
    check(pg.locator(".tb-ball").count() == 3, "3個置ける", pg.locator(".tb-ball").count())

    # 球は丸い（楕円に潰れない）
    sz = pg.evaluate("""() => {
      const r = document.querySelector('.tb-ball').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }""")
    check(sz["w"] == sz["h"], "球が丸い（縦横が同じ）", sz)
    check(sz["w"] >= 28, "球が指で掴める大きさ", sz)

    # 置いた球は一覧から選べなくなる（同じ球を2個置けない）
    check(pg.is_disabled('.tray-ball[data-ball="1"]'), "置いた球は一覧で選べなくなる")

    # 動かさずに離すと台からどける
    ball = pg.locator('.tb-ball[data-ball="9"]')
    box = ball.bounding_box()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down()
    pg.mouse.up()
    pg.wait_for_timeout(400)
    check(pg.locator(".tb-ball").count() == 2, "タップでどけられる", pg.locator(".tb-ball").count())
    check(not pg.is_disabled('.tray-ball[data-ball="9"]'), "どけた球はまた選べる")

    # ================================================================
    section("3. 指で動かして位置を決められる")
    put(pg, "9")
    before = pg.evaluate(POSITIONS)
    ball = pg.locator('.tb-ball[data-ball="9"]')
    box = ball.bounding_box()
    tb = pg.locator("#poolTable").bounding_box()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(tb["x"] + tb["width"] * 0.25, tb["y"] + tb["height"] * 0.18, steps=10)
    pg.mouse.up()
    pg.wait_for_timeout(400)
    after = pg.evaluate(POSITIONS)
    check(pg.locator(".tb-ball").count() == 3, "動かしても台から消えない",
          pg.locator(".tb-ball").count())
    moved = [a for a in after if a["n"] == "9"][0]
    check(moved["left"] != [x for x in before if x["n"] == "9"][0]["left"],
          "動かした位置が変わる", moved)

    # 台の外には出ない
    inside = pg.evaluate("""() => {
      const t = document.getElementById('poolTable').getBoundingClientRect();
      return Array.from(document.querySelectorAll('.tb-ball')).every(b => {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        return cx >= t.left && cx <= t.right && cy >= t.top && cy <= t.bottom;
      });
    }""")
    check(inside, "球が台の外に出ない")
    pg.screenshot(path=os.path.join(SHOTS, "layout.png"))

    # ================================================================
    section("4. 名前を付けて保存できる")
    pg.once("dialog", lambda d: d.accept("ドリルA"))
    pg.click("#layoutSaveBtn")
    pg.wait_for_timeout(600)
    stored = pg.evaluate(STORED)
    check(len(stored) == 1, "1件保存される", len(stored))
    check(stored[0]["name"] == "ドリルA", "付けた名前で保存される", stored[0]["name"])
    check(len(stored[0]["balls"]) == 3, "球の数も保存される", len(stored[0]["balls"]))
    # 位置は割合で持つ（画面の大きさが変わっても同じ配置に見えるように）
    xs = [ball["x"] for ball in stored[0]["balls"]]
    check(all(0 <= x <= 1 for x in xs), "位置は0〜1の割合で持つ", xs)

    # 保存を取り消せる
    pg.once("dialog", lambda d: d.dismiss())
    pg.click("#layoutSaveBtn")
    pg.wait_for_timeout(500)
    check(len(pg.evaluate(STORED)) == 1, "取り消したら増えない", len(pg.evaluate(STORED)))

    # ================================================================
    section("5. 呼び出すと同じ位置に戻る")
    saved_pos = pg.evaluate(POSITIONS)
    pg.click("#layoutClearBtn")
    pg.wait_for_timeout(400)
    check(pg.locator(".tb-ball").count() == 0, "全部どけられる")

    open_list(pg)
    check(pg.locator(".layout-item").count() == 1, "保存した配置が一覧に出る")
    check("ドリルA" in (pg.text_content(".layout-item .li-name") or ""),
          "名前が出る", pg.text_content(".layout-item .li-name"))

    pg.click('.layout-item button:text-is("呼び出す")')
    pg.wait_for_timeout(600)
    check(pg.locator(".tb-ball").count() == 3, "球の数が戻る", pg.locator(".tb-ball").count())
    now_pos = pg.evaluate(POSITIONS)

    def key(items):
        return sorted([(i["n"], i["left"], i["top"]) for i in items])

    check(key(now_pos) == key(saved_pos), "同じ位置に戻る", (key(saved_pos), key(now_pos)))
    pg.screenshot(path=os.path.join(SHOTS, "layout2.png"))

    # ================================================================
    section("6. 削除できる")
    open_list(pg)
    pg.once("dialog", lambda d: d.accept())
    pg.click('.layout-item button:text-is("削除")')
    pg.wait_for_timeout(600)
    live = [x for x in pg.evaluate(STORED) if not x.get("deletedAt")]
    check(len(live) == 0, "削除される", live)
    close_list(pg)

    # 削除の確認を取り消したら消えない
    put(pg, "2")
    pg.once("dialog", lambda d: d.accept("ドリルB"))
    pg.click("#layoutSaveBtn")
    pg.wait_for_timeout(600)
    open_list(pg)
    pg.once("dialog", lambda d: d.dismiss())
    pg.click('.layout-item button:text-is("削除")')
    pg.wait_for_timeout(500)
    live = [x for x in pg.evaluate(STORED) if not x.get("deletedAt")]
    check(len(live) == 1, "取り消したら消えない", live)
    close_list(pg)

    # ================================================================
    section("7. 試合の記録に影響しない")
    idx_before = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_matches_index') || '[]')")
    check(len(idx_before) == 0, "配置を作っても試合の記録は増えない", len(idx_before))

    # 試合を1件記録しても、配置は別々に残る
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    helpers.set_goal(pg, 2)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    for _ in range(2):
        pg.click("#panelA")
        pg.wait_for_timeout(400)
        if pg.is_visible("#finishModal"):
            break
    if pg.is_visible("#finishModal"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)

    live = [x for x in pg.evaluate(STORED) if not x.get("deletedAt")]
    check(len(live) == 1, "試合を記録しても配置は残る", len(live))
    idx_after = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_matches_index') || '[]')")
    check(len(idx_after) == 1, "試合の記録は別に残る", len(idx_after))

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
