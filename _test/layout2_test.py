# -*- coding: utf-8 -*-
"""layout2_test.py — 配置図の指示7件の検証（2026-08-20）

対象:
  1. ポケット6つとポイント（ダイヤ）18個が出る
  2. 球の上下に出ていた横線が消えている
  3. 「配置を保存」が上の帯にある
  4. 「一つ前に戻る」「全部どける」が台の左に縦に並ぶ
  5. 「一つ次に進む」が台の右にある／戻る・進むが両方効く
  6. 一言メモを保存して呼び出せる
  7. 球の番号が黒文字・太字・拡大されている（白地に黒枠の丸）

実行: python _test/layout2_test.py
"""
import sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOTS, exist_ok=True)

results = []
def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label + (("  -> " + str(detail)) if detail and not cond else ""))

def put(pg, n):
    pg.click(".tray-ball[data-ball='%s']" % n)

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(400)
    pg.click("#tabLayout")
    pg.wait_for_timeout(400)

    print("\n-- 1. ポケットとポイント --")
    pockets = pg.eval_on_selector_all(".pt-pocket", "els => els.length")
    dots = pg.eval_on_selector_all(".pt-dot", "els => els.length")
    sides = pg.eval_on_selector_all(".pt-pocket.side", "els => els.length")
    check(pockets == 6, "ポケットが6つ", pockets)
    check(sides == 2, "うちサイドポケットが2つ", sides)
    check(dots == 18, "ポイント（ダイヤ）が18個", dots)
    vis = pg.eval_on_selector(".pt-pocket", "e => e.getBoundingClientRect().width > 10")
    check(vis, "ポケットが実寸で描かれている")

    print("\n-- 2. 球の上下の線が消えている --")
    line = pg.eval_on_selector("#poolTable", """e => {
      const b = getComputedStyle(e, '::before').content;
      const a = getComputedStyle(e, '::after').content;
      return b + '|' + a;
    }""")
    check("none" in line, "::before/::after の線が none", line)

    print("\n-- 3. 「配置を保存」が上の帯 --")
    inbar = pg.eval_on_selector("#layoutSaveBtn", "e => !!e.closest('.topbar')")
    check(inbar, "保存ボタンが .topbar の中")
    th = pg.eval_on_selector("#poolTable", "e => e.getBoundingClientRect().height")
    check(th > 330, "盤面の高さが330pxより大きい（以前は約310px）", round(th))

    print("\n-- 4/5. 左右のボタン列 --")
    lf = pg.eval_on_selector("#layoutUndoBtn", "e => !!e.closest('.lay-left')")
    lc = pg.eval_on_selector("#layoutClearBtn", "e => !!e.closest('.lay-left')")
    rr = pg.eval_on_selector("#layoutRedoBtn", "e => !!e.closest('.lay-right')")
    check(lf, "「一つ前に戻る」が左列")
    check(lc, "「全部どける」が左列")
    check(rr, "「一つ次に進む」が右列")
    check(pg.inner_text("#layoutUndoBtn").strip() == "一つ前に戻る", "左のラベル", pg.inner_text("#layoutUndoBtn"))
    check(pg.inner_text("#layoutRedoBtn").strip() == "一つ次に進む", "右のラベル", pg.inner_text("#layoutRedoBtn"))
    lx = pg.eval_on_selector("#layoutUndoBtn", "e => e.getBoundingClientRect().left")
    tx = pg.eval_on_selector("#poolTable", "e => e.getBoundingClientRect().left")
    rx = pg.eval_on_selector("#layoutRedoBtn", "e => e.getBoundingClientRect().left")
    trx = pg.eval_on_selector("#poolTable", "e => e.getBoundingClientRect().right")
    check(lx < tx, "左列は台より左", (lx, tx))
    check(rx > trx, "右列は台より右", (rx, trx))
    # 台がはみ出していないこと
    over = pg.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth")
    check(not over, "横スクロールが出ていない")

    print("\n-- 戻る／進むが効く --")
    check(pg.eval_on_selector("#layoutUndoBtn", "e => e.disabled"), "最初は「戻る」が押せない")
    check(pg.eval_on_selector("#layoutRedoBtn", "e => e.disabled"), "最初は「進む」が押せない")
    put(pg, "1"); put(pg, "2"); put(pg, "3")
    pg.wait_for_timeout(150)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 3, "3個置いた")
    pg.click("#layoutUndoBtn"); pg.wait_for_timeout(150)
    n2 = pg.eval_on_selector_all(".tb-ball", "e => e.length")
    check(n2 == 2, "「一つ前に戻る」で2個", n2)
    pg.click("#layoutUndoBtn"); pg.wait_for_timeout(150)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 1, "もう一度戻って1個（2手以上戻れる）")
    pg.click("#layoutRedoBtn"); pg.wait_for_timeout(150)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 2, "「一つ次に進む」で2個に戻る")
    pg.click("#layoutRedoBtn"); pg.wait_for_timeout(150)
    check(pg.eval_on_selector_all(".tb-ball", "e => e.length") == 3, "もう一度進んで3個")

    print("\n-- 6. 一言メモ --")
    check(pg.is_visible("#layoutMemo"), "メモ欄がある")
    pg.fill("#layoutMemo", "押しのコース練習")
    pg.once("dialog", lambda d: d.accept("メモ確認用"))
    pg.click("#layoutSaveBtn")
    pg.wait_for_timeout(300)
    stored = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_layouts') || '[]')")
    note = stored[0].get("note") if stored else None
    check(note == "押しのコース練習", "メモが保存された", note)
    pg.fill("#layoutMemo", "")
    pg.click("#layoutListBtn"); pg.wait_for_timeout(200)
    shown = pg.inner_text("#layoutList")
    check("押しのコース練習" in shown, "一覧にメモが出る", shown[:80])
    pg.click("#layoutList button.primary"); pg.wait_for_timeout(300)
    check(pg.input_value("#layoutMemo") == "押しのコース練習", "呼び出すとメモが戻る", pg.input_value("#layoutMemo"))

    print("\n-- 7. 番号の見え方 --")
    st = pg.eval_on_selector(".tb-ball .bb-num", """e => {
      const s = getComputedStyle(e);
      return { color: s.color, weight: s.fontWeight, size: parseFloat(s.fontSize) };
    }""")
    # 2026-08-21の指示で「白地に黒い枠線・黒文字の丸」に変えた（白文字ではなくなった）
    check(st["color"] == "rgb(17, 17, 17)", "配置図の番号が黒文字", st["color"])
    check(int(st["weight"]) >= 700, "太字", st["weight"])
    check(st["size"] >= 15, "12px→15px以上に拡大", st["size"])
    pg.screenshot(path=os.path.join(SHOTS, "layout2.png"), full_page=True)

    print("\n-- JSエラー --")
    check(not errs, "ページのJSエラーなし", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
