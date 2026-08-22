# -*- coding: utf-8 -*-
"""fix_layout_test.py — 配置画面とルール選択画面の手直しの検証（本人の指示 2026-08-22）

本人の言葉と、それを座標で確かめる項目:

  1. 「一つ次に進むボタン」「直線を引く」「描画する」をすべてテーブル左側に配置して
     テーブルの表示を大きくする
       → 5つのボタンが全部 .lay-left の中で、どれも台より左にあること。
         右の列（.lay-right）が無いこと。台が以前より大きいこと（実測 456→556px）

  2. 配置図のボールのサイズをもう一回り小さくする
       → .tb-ball の実寸が 40px より小さく、掴める下限（30px）は割らないこと

  3. プレーヤー選択時、名前の後に「A」「B」と表示されるがクラスと紛らわしいので
     他の表記に変更して
       → 札の字が選手クラス（Be・C・B・A・SA・P）のどれとも一致しないこと。
         シングルスは「左」「右」、ダブルスは「左1」「左2」「右1」「右2」

  4. ダブルスのルール選択で「先にブレイクする人」を「先にブレイクするチーム」に
       → ダブルスのときだけ「チーム」。シングルスは「人」のまま

  5. 時計の「持ち時間」と「残り何秒で警告」の入力欄の高さと位置が揃っていない
       → 同じ行の入力欄の上端の差が 1px 以内であること（実測して出す）

実行: python _test/fix_layout_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail != "" else ""))


def section(name):
    print("\n-- " + name + " --")


# 選手クラスの記号（js/store.js の PLAYER_CLASSES）。札がこれと同じ字だと紛らわしい
PLAYER_CLASSES = ["Be", "C", "B", "A", "SA", "P"]

BTN_IDS = ["#layoutUndoBtn", "#layoutRedoBtn", "#layoutClearBtn",
           "#layoutLineBtn", "#layoutDrawBtn"]

ROW_JS = """(id) => {
  const d = document.getElementById(id);
  if (!d || d.hidden) return null;
  return [...d.querySelectorAll('.row')].map(row => {
    const fs = [...row.children].map(col => {
      const lab = col.querySelector(':scope > label');
      const inp = col.querySelector('input');
      if (!lab || !inp) return null;
      const a = lab.getBoundingClientRect(), b = inp.getBoundingClientRect();
      return { label: lab.textContent.trim(),
               labelTop: Math.round(a.top * 10) / 10,
               labelH: Math.round(a.height * 10) / 10,
               inputTop: Math.round(b.top * 10) / 10,
               inputH: Math.round(b.height * 10) / 10 };
    }).filter(Boolean);
    return fs;
  }).filter(r => r.length >= 2);
}"""

PICKER_JS = """(id) => {
  const inp = document.getElementById(id);
  if (!inp) return null;
  let n = (inp.closest('.member-row') || inp).nextElementSibling;
  let w = null;
  while (n) { if (n.classList && n.classList.contains('picker-wrap')) { w = n; break; }
              n = n.nextElementSibling; }
  if (!w) { const f = inp.closest('.field'); w = f && f.querySelector('.picker-wrap'); }
  if (!w) return null;
  return [...w.querySelectorAll('.picker-chip')].map(b => ({
    name: (b.querySelector('.pc-name') || {}).textContent || '',
    at: (b.querySelector('.pc-at') || {}).textContent || null,
    bg: b.querySelector('.pc-at')
      ? getComputedStyle(b.querySelector('.pc-at')).backgroundColor : null,
  }));
}"""


def click_chip(pg, target, name):
    pg.evaluate("""([id, nm]) => {
      const inp = document.getElementById(id);
      let n = (inp.closest('.member-row') || inp).nextElementSibling;
      let w = null;
      while (n) { if (n.classList && n.classList.contains('picker-wrap')) { w = n; break; }
                  n = n.nextElementSibling; }
      if (!w) { const f = inp.closest('.field'); w = f && f.querySelector('.picker-wrap'); }
      const b = [...w.querySelectorAll('.picker-chip')]
        .find(x => (x.querySelector('.pc-name') || {}).textContent === nm);
      if (!b) throw new Error('チップが無い: ' + nm);
      b.click();
    }""", [target, name])
    pg.wait_for_timeout(450)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    # =========== 1. 配置画面：ボタンは全部、台の左 ===========
    section("1. 練習配置のボタンはすべて台の左")
    pg.click("#tabLayout")
    pg.wait_for_timeout(700)
    check(pg.is_visible("#screenLayout"), "配置の画面が開く")

    for bid in BTN_IDS:
        check(pg.eval_on_selector(bid, "e => !!e.closest('.lay-left')"),
              bid + " が台の左の列にある")
    nright = pg.eval_on_selector_all(".lay-right", "e => e.length")
    check(nright == 0, "台の右の列は無い", nright)
    ntools = pg.eval_on_selector_all(".lay-tools", "e => e.length")
    check(ntools == 0, "台の下の横1行（.lay-tools）も無い", ntools)

    box = pg.evaluate("""() => {
      const t = document.getElementById('poolTable').getBoundingClientRect();
      const btns = ['layoutUndoBtn','layoutRedoBtn','layoutClearBtn',
                    'layoutLineBtn','layoutDrawBtn']
        .map(id => { const b = document.getElementById(id).getBoundingClientRect();
          return { id: id, right: Math.round(b.right), w: Math.round(b.width),
                   h: Math.round(b.height) }; });
      return { table: { left: Math.round(t.left), right: Math.round(t.right),
                        w: Math.round(t.width), h: Math.round(t.height) },
               btns: btns,
               hscroll: document.documentElement.scrollWidth
                        > document.documentElement.clientWidth };
    }""")
    for b in box["btns"]:
        check(b["right"] <= box["table"]["left"],
              b["id"] + " は台より左（右端 " + str(b["right"])
              + " ≦ 台の左端 " + str(box["table"]["left"]) + "）")
        check(b["h"] >= 44, b["id"] + " の高さが44px以上", b["h"])
    check(not box["hscroll"], "横スクロールは出ていない")

    # 以前（右の列があった頃）の実測は 242×456 @390×844
    check(box["table"]["w"] > 242,
          "台の幅が以前（242px）より広い", box["table"]["w"])
    check(box["table"]["h"] > 456,
          "台の高さが以前（456px）より高い", box["table"]["h"])

    # =========== 2. 球の大きさ ===========
    section("2. 配置図のボールをもう一回り小さく")
    for n in ["0", "1", "9"]:
        pg.click('.tray-ball[data-ball="%s"]' % n)
        pg.wait_for_timeout(200)
    size = pg.evaluate("""() => {
      const b = document.querySelector('.tb-ball[data-ball="9"]');
      const r = b.getBoundingClientRect();
      const num = b.querySelector('.bb-num');
      return { w: Math.round(r.width), h: Math.round(r.height),
               numFs: num ? getComputedStyle(num).fontSize : null,
               numW: num ? Math.round(num.getBoundingClientRect().width) : null };
    }""")
    check(size["w"] == size["h"], "球は真円（縦横が同じ）", size)
    check(size["w"] < 40, "以前の40pxより小さい", size["w"])
    check(size["w"] >= 30, "掴める下限30pxは割らない", size["w"])
    check(size["numFs"] is not None and float(size["numFs"].replace("px", "")) >= 15,
          "番号の文字は15px以上（読める）", size["numFs"])

    # 小さくしても指で掴んで動かせること
    b = pg.locator('.tb-ball[data-ball="9"]').bounding_box()
    before = pg.eval_on_selector('.tb-ball[data-ball="9"]', "e => e.style.left")
    pg.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(b["x"] + b["width"] / 2 + 40, b["y"] + b["height"] / 2 + 40, steps=8)
    pg.mouse.up()
    pg.wait_for_timeout(300)
    after = pg.eval_on_selector('.tb-ball[data-ball="9"]', "e => e.style.left")
    check(after != before, "小さくしても指で掴んで動かせる", (before, after))

    # =========== 3. プレーヤー選択の札 ===========
    section("3. プレーヤー選択の札（クラスと紛れない字）")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    for n in ["たいら", "岸川", "佐藤", "鈴木"]:
        helpers.add_player(pg, n)
    pg.wait_for_timeout(300)

    # --- シングルス ---
    pg.click("#tabHome")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    click_chip(pg, "inNameA", "たいら")
    chips = pg.evaluate(PICKER_JS, "inNameB")
    tags = [c["at"] for c in chips if c["at"]]
    check(tags, "他の欄にいる人には札が付く", tags)
    check(all(t not in PLAYER_CLASSES for t in tags),
          "札がクラス（Be・C・B・A・SA・P）と同じ字ではない", tags)
    check(tags and tags[0] == "左", "シングルスのA欄の札は「左」", tags)

    click_chip(pg, "inNameB", "岸川")
    chipsA = pg.evaluate(PICKER_JS, "inNameA")
    # 選び直しを開いてから読む
    pg.evaluate("""() => {
      const b = [...document.querySelectorAll('.picker-change')][0]; if (b) b.click();
    }""")
    pg.wait_for_timeout(400)
    chipsA = pg.evaluate(PICKER_JS, "inNameA")
    tagsA = [c["at"] for c in chipsA if c["at"]]
    check("右" in tagsA, "B欄にいる人の札は「右」", tagsA)

    # 札には側の色も付く（青＝A側／赤＝B側）
    colored = [c["bg"] for c in chipsA if c["at"] == "右"]
    check(colored and colored[0] not in (None, "rgba(0, 0, 0, 0)"),
          "札に側の色が付いている", colored)

    # --- ダブルス ---
    pg.click("#tabHome")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball_doubles")
    pg.wait_for_timeout(500)
    click_chip(pg, "inNameA", "たいら")
    pg.wait_for_timeout(300)
    dtags = [c["at"] for c in pg.evaluate(PICKER_JS, "inNameA2") if c["at"]]
    check(all(t not in PLAYER_CLASSES for t in dtags),
          "ダブルスの札もクラスと同じ字ではない", dtags)
    check("左1" in dtags, "ダブルスのA1欄の札は「左1」", dtags)

    # =========== 4. ダブルスは「先にブレイクするチーム」 ===========
    section("4. ダブルスの「先にブレイクするチーム」")
    txt = pg.eval_on_selector("#firstSideField label", "e => e.textContent.trim()")
    check(txt == "先にブレイクするチーム", "ダブルスの見出しは「チーム」", txt)
    btns = pg.eval_on_selector_all(
        "#firstSideToggle button", "es => es.map(e => e.textContent.trim())")
    check(btns == ["チームA", "チームB"], "選択肢も「チームA」「チームB」", btns)
    summary = pg.eval_on_selector("#startSummary", "e => e.textContent")
    check("先にブレイクするチーム" in summary,
          "まとめにも「先にブレイクするチーム」と出る",
          "先にブレイクするチーム" in summary)

    pg.click("#tabHome")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    txt2 = pg.eval_on_selector("#firstSideField label", "e => e.textContent.trim()")
    check(txt2 == "先にブレイクする人", "シングルスは「人」のまま", txt2)
    btns2 = pg.eval_on_selector_all(
        "#firstSideToggle button", "es => es.map(e => e.textContent.trim())")
    check(btns2 == ["プレーヤーA", "プレーヤーB"], "選択肢も元に戻る", btns2)
    summary2 = pg.eval_on_selector("#startSummary", "e => e.textContent")
    check("先にブレイクする人" in summary2, "まとめも「人」")

    # =========== 5. 時計の欄の上端がそろう ===========
    section("5. 時計の入力欄の上端がそろう")
    for kind, box_id in [("chess", "ccDetail"), ("shot", "scDetail")]:
        pg.evaluate("""(v) => { const t = document.getElementById('clockTypeToggle');
          [...t.querySelectorAll('button')].find(b => b.dataset.v === v).click(); }""",
                    kind)
        pg.wait_for_timeout(400)
        rows = pg.evaluate(ROW_JS, box_id)
        check(rows, box_id + " の2つ並びの行が読めた", len(rows or []))
        for r in (rows or []):
            tops = [f["inputTop"] for f in r]
            names = [f["label"] for f in r]
            gap = round(max(tops) - min(tops), 1)
            check(gap <= 1.0,
                  box_id + " " + " / ".join(names) + " の入力欄の上端がそろう",
                  "上端 " + str(tops) + " 差 " + str(gap) + "px")
            hs = [f["inputH"] for f in r]
            check(round(max(hs) - min(hs), 1) <= 1.0,
                  box_id + " " + " / ".join(names) + " の入力欄の高さがそろう", hs)

    # 画面の幅を変えても崩れない（折り返しの行数が変わるため）
    pg.set_viewport_size({"width": 320, "height": 640})
    pg.wait_for_timeout(500)
    rows = pg.evaluate(ROW_JS, "scDetail")
    for r in (rows or []):
        tops = [f["inputTop"] for f in r]
        check(round(max(tops) - min(tops), 1) <= 1.0,
              "320px幅でも " + " / ".join([f["label"] for f in r]) + " がそろう",
              tops)
    pg.set_viewport_size({"width": 390, "height": 844})
    pg.wait_for_timeout(400)

    check(not errs, "JSエラーが出ていない", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== %d件中 NG %d件 ====" % (len(results), len(ng)))
for r in ng:
    print("NG  " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
