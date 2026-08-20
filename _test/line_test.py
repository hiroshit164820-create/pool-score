# -*- coding: utf-8 -*-
"""line_test.py — 配置図に直線を引ける機能の検証（本人の指示 2026-08-21 / 段階4）

対象:
  1. 「直線を引く」のボタンがある／押すと切り替わる
  2. 台をなぞると直線が1本引ける（引いた向きと位置が合っている）
  3. 線を引く間は球を掴めない（球が動かない・消えない）
  4. 引いた線を押すと、その1本だけが消える
  5. 「一つ前に戻る」で消した線が戻る／引いた線が消える
  6. 「全部どける」で線も消える
  7. 保存 → 呼び出しで線が戻る
  8. 線を入れる前に保存した配置（lines が無い）を呼び出しても落ちない
  9. 画面の説明に線の本数が出る

実行: python _test/line_test.py
"""
import sys, io, os
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


def drag(pg, x1, y1, x2, y2, steps=8):
    """台の中を割合（0〜1）で指定してなぞる"""
    box = pg.locator("#poolTable").bounding_box()
    pg.mouse.move(box["x"] + box["width"] * x1, box["y"] + box["height"] * y1)
    pg.mouse.down()
    for i in range(1, steps + 1):
        t = i / float(steps)
        pg.mouse.move(box["x"] + box["width"] * (x1 + (x2 - x1) * t),
                      box["y"] + box["height"] * (y1 + (y2 - y1) * t))
        pg.wait_for_timeout(20)
    pg.mouse.up()
    pg.wait_for_timeout(250)


def tap(pg, x, y):
    box = pg.locator("#poolTable").bounding_box()
    pg.mouse.move(box["x"] + box["width"] * x, box["y"] + box["height"] * y)
    pg.mouse.down()
    pg.wait_for_timeout(60)
    pg.mouse.up()
    pg.wait_for_timeout(250)


def line_count(pg):
    return pg.eval_on_selector_all(".pt-lines .ptl-main", "e => e.length")


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)
    pg.click("#tabLayout")
    pg.wait_for_timeout(700)

    # ================= 1. ボタン =================
    section("1. 「直線を引く」のボタン")
    btn = pg.locator("#layoutDrawBtn")
    check(btn.count() == 1, "ボタンがある")
    check((btn.text_content() or "").strip() == "直線を引く", "はじめは「直線を引く」",
          btn.text_content())
    box = btn.bounding_box()
    check(box and box["height"] >= 44, "高さが44px以上（指で押せる）", box)
    btn.click()
    pg.wait_for_timeout(300)
    check((btn.text_content() or "").strip() == "線を引くのをやめる",
          "押すと「線を引くのをやめる」", btn.text_content())
    check(pg.eval_on_selector("#poolTable", "e => e.classList.contains('drawing')"),
          "台が線を引く状態になる")
    hint = pg.text_content("#layoutHint") or ""
    check("なぞる" in hint, "使い方の案内が出る", hint)

    # ================= 2. 線を引く =================
    section("2. 台をなぞると直線が引ける")
    drag(pg, 0.25, 0.25, 0.75, 0.60)
    check(line_count(pg) == 1, "線が1本になる", line_count(pg))
    got = pg.eval_on_selector(".pt-lines .ptl-main",
                              "e => [e.getAttribute('x1'), e.getAttribute('y1'),"
                              " e.getAttribute('x2'), e.getAttribute('y2')]")
    def near(v, want, tol=4.0):
        try:
            return abs(float(str(v).replace("%", "")) - want) <= tol
        except Exception:
            return False
    check(near(got[0], 25) and near(got[1], 25) and near(got[2], 75) and near(got[3], 60),
          "なぞった向き・位置と合っている", got)
    check("preview" not in (pg.eval_on_selector(".pt-lines .ptl-main", "e => e.getAttribute('class')") or ""),
          "指を離したら破線ではなくなる")
    sub = pg.text_content("#layoutSub") or ""
    check("線 1本" in sub, "説明に「線 1本」が出る", sub)
    pg.screenshot(path=os.path.join(SHOTS, "line_drawn.png"))

    # ================= 3. 線を引く間は球を掴めない =================
    section("3. 線を引く間は球を掴めない")
    # 先に球を1つ置く（トレイは押せる）
    pg.click(".tray-ball[data-ball='1']")
    pg.wait_for_timeout(300)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1, "球が1つ置ける")
    before = pg.eval_on_selector(".tb-ball", "e => e.style.left + ',' + e.style.top")
    # 球の上をなぞる（球の真ん中あたり = 0.5, 0.5 付近）
    n2 = line_count(pg)
    drag(pg, 0.5, 0.5, 0.2, 0.8)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1,
          "なぞっても球が消えない")
    after = pg.eval_on_selector(".tb-ball", "e => e.style.left + ',' + e.style.top")
    check(before == after, "なぞっても球が動かない", before + " -> " + after)
    check(line_count(pg) == n2 + 1, "球の上でも線が引ける", line_count(pg))

    # ================= 4. 押すと1本だけ消える =================
    section("4. 線を押すと消える")
    check(line_count(pg) == 2, "いま線は2本", line_count(pg))
    # 1本目（0.25,0.25 → 0.75,0.60）の真ん中あたりを押す
    tap(pg, 0.50, 0.425)
    check(line_count(pg) == 1, "押した1本だけが消える", line_count(pg))
    rest = pg.eval_on_selector(".pt-lines .ptl-main",
                               "e => [e.getAttribute('x1'), e.getAttribute('y1')]")
    check(near(rest[0], 50) and near(rest[1], 50), "残ったのはもう1本のほう", rest)

    # 何も無いところを押しても消えない
    n3 = line_count(pg)
    tap(pg, 0.9, 0.05)
    check(line_count(pg) == n3, "線の無いところを押しても消えない", line_count(pg))

    # ================= 5. 一つ前に戻る =================
    section("5. 「一つ前に戻る」")
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(400)
    check(line_count(pg) == 2, "消した線が戻る", line_count(pg))
    pg.click("#layoutRedoBtn")
    pg.wait_for_timeout(400)
    check(line_count(pg) == 1, "「一つ次に進む」でまた消える", line_count(pg))

    # ================= 6. 全部どける =================
    section("6. 「全部どける」")
    pg.click("#layoutClearBtn")
    pg.wait_for_timeout(400)
    check(line_count(pg) == 0, "線も消える", line_count(pg))
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 0, "球も消える")
    pg.click("#layoutUndoBtn")
    pg.wait_for_timeout(400)
    check(line_count(pg) == 1 and pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1,
          "戻すと線も球も戻る", str(line_count(pg)))

    # ================= 7. 保存して呼び出す =================
    section("7. 保存 → 呼び出し")
    pg.once("dialog", lambda d: d.accept("線のテスト"))
    pg.click("#layoutSaveBtn")
    pg.wait_for_timeout(600)
    saved = pg.evaluate("() => STORE.listLayouts()[0]")
    check(saved and saved.get("lines") and len(saved["lines"]) == 1,
          "保存した中身に線が入る", saved)
    pg.click("#layoutClearBtn")
    pg.wait_for_timeout(400)
    pg.click("#layoutListBtn")
    pg.wait_for_timeout(400)
    sub2 = pg.text_content("#layoutList") or ""
    check("線 1本" in sub2, "一覧に「線 1本」が出る", sub2[:120])
    pg.locator(".layout-item button", has_text="呼び出す").first.click()
    pg.wait_for_timeout(600)
    check(line_count(pg) == 1, "呼び出すと線が戻る", line_count(pg))
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1, "球も戻る")

    # ================= 8. 古い配置（lines が無い）=================
    section("8. 線を入れる前に保存した配置")
    pg.evaluate("""() => {
      const all = JSON.parse(localStorage.getItem('pool_layouts') || '[]');
      all.unshift({id:'L_old', name:'むかしの配置',
        balls:[{n:1,x:0.3,y:0.3},{n:8,x:0.6,y:0.6}],
        note:'', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()});
      localStorage.setItem('pool_layouts', JSON.stringify(all));
    }""")
    # 呼び出した直後は一覧が閉じているので、1回だけ押して開く
    if pg.eval_on_selector("#layoutList", "e => e.hidden"):
        pg.click("#layoutListBtn")
        pg.wait_for_timeout(400)
    pg.locator(".layout-item", has_text="むかしの配置").locator("button", has_text="呼び出す").click()
    pg.wait_for_timeout(600)
    check(line_count(pg) == 0, "線は0本になる", line_count(pg))
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 2, "球は2つ戻る")

    # ================= 9. 線を引くのをやめる =================
    section("9. 線を引くのをやめる")
    pg.click("#layoutDrawBtn")
    pg.wait_for_timeout(300)
    check((pg.text_content("#layoutDrawBtn") or "").strip() == "直線を引く",
          "文言が戻る", pg.text_content("#layoutDrawBtn"))
    check(not pg.eval_on_selector("#poolTable", "e => e.classList.contains('drawing')"),
          "台の状態も戻る")
    # 球がまた掴める（タップでどける）
    pg.locator(".tb-ball").first.click()
    pg.wait_for_timeout(400)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1,
          "球をタップでどけられる", pg.eval_on_selector_all(".tb-ball", "e => e.length"))

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
