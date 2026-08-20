# -*- coding: utf-8 -*-
"""note_test.py — 試合メモの検証（本人指示11）

対象:
  1. 試合終了のダイアログでメモを書ける
  2. 書いたメモが保存され、履歴で読める
  3. 履歴から書き足し・書き換えができる
  4. 空にすると消える
  5. メモ無しでも今までどおり終了できる

実行: python _test/note_test.py
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


READ_NOTE = """(name) => {
  const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
  const e = idx.find(x => x.names.A === name);
  if (!e) return {err: 'no entry'};
  const m = JSON.parse(localStorage.getItem('pool_match_' + e.id));
  return { indexNote: e.note, bodyNote: m.note };
}"""


def play_and_finish(pg, nameA, nameB, note):
    """1試合してメモを書いて終了する"""
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)
    pg.fill("#inNameA", nameA)
    pg.fill("#inNameB", nameB)
    pg.wait_for_timeout(150)
    helpers.set_goal(pg, 3)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    pg.click("#finishBtn")
    pg.wait_for_timeout(400)
    if note is not None:
        pg.fill("#finishNote", note)
        pg.wait_for_timeout(150)
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(600)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    section("1. 終了ダイアログでメモを書ける")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    helpers.set_goal(pg, 3)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    pg.click("#finishBtn")
    pg.wait_for_timeout(400)
    check(pg.is_visible("#finishNote"), "終了ダイアログにメモ欄がある")
    fs = pg.eval_on_selector("#finishNote", "e => getComputedStyle(e).fontSize")
    check(float(fs.replace("px", "")) >= 16, "メモ欄の文字が16px以上（iOSで拡大しない）", fs)
    pg.fill("#finishNote", "手玉が走りすぎた。次は撞点を下げる")
    pg.wait_for_timeout(150)
    pg.screenshot(path=os.path.join(SHOTS, "note_finish_dialog.png"))
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(600)

    section("2. 保存され、履歴で読める")
    saved = pg.evaluate(READ_NOTE, "山田")
    check(saved.get("bodyNote") == "手玉が走りすぎた。次は撞点を下げる",
          "メモが試合本体に保存される", saved)
    check(saved.get("indexNote") == "手玉が走りすぎた。次は撞点を下げる",
          "一覧（インデックス）にも保存される", saved)
    check(pg.is_visible("#screenHistory"), "終了後は履歴が開く")
    shown = pg.locator(".match-card .mc-note").first.text_content()
    check("撞点を下げる" in (shown or ""), "履歴のカードにメモが出る", shown)
    pg.screenshot(path=os.path.join(SHOTS, "note_history.png"))

    section("3. 履歴から書き換えられる")
    btn = pg.locator('.match-card button:text-is("メモを編集")').first
    check(btn.count() == 1, "メモがある試合は「メモを編集」になる", btn.count())
    pg.once("dialog", lambda d: d.accept("書き換えたメモ"))
    btn.click()
    pg.wait_for_timeout(500)
    saved = pg.evaluate(READ_NOTE, "山田")
    check(saved.get("bodyNote") == "書き換えたメモ", "書き換えが保存される", saved)
    shown = pg.locator(".match-card .mc-note").first.text_content()
    check("書き換えたメモ" in (shown or ""), "履歴の表示も変わる", shown)

    section("4. 空にすると消える")
    pg.once("dialog", lambda d: d.accept(""))
    pg.locator('.match-card button:text-is("メモを編集")').first.click()
    pg.wait_for_timeout(500)
    saved = pg.evaluate(READ_NOTE, "山田")
    check(saved.get("bodyNote") == "", "空にするとメモが消える", saved)
    check(pg.locator(".match-card .mc-note").count() == 0, "履歴からも消える")
    btn2 = pg.locator('.match-card button:text-is("メモを追加")').first
    check(btn2.count() == 1, "メモが無い試合は「メモを追加」に戻る", btn2.count())

    section("5. メモ無しでも今までどおり終了できる")
    # 履歴の下部ボタンは削除したので、下のタブから種目へ移る（2026-08-21）
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    play_and_finish(pg, "鈴木", "田中", None)
    saved2 = pg.evaluate(READ_NOTE, "鈴木")
    check(saved2.get("bodyNote") == "", "メモ無しなら空で保存される", saved2)
    check(pg.is_visible("#screenHistory"), "メモ無しでも終了できる")

    section("6. 取り消したら書き換えない")
    pg.once("dialog", lambda d: d.dismiss())
    pg.locator('.match-card button:text-is("メモを追加")').first.click()
    pg.wait_for_timeout(400)
    check(pg.locator(".match-card .mc-note").count() == 0, "取り消したらメモは付かない")

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
