# -*- coding: utf-8 -*-
"""pairpick_test.py — プレーヤーの選び方（本人の指示 2026-08-21・段階C）

本人の指摘:
  「9ボールダブルスで使ってみたが、プレーヤー選択がしづらかった。
    Aの一人とBの一人でペアを組みかえるときに、いちいちB側の一人に
    別の人をあてるという作業が発生した」
  「プレイヤー選択をしたら選択した名前のみ表示されるようにしてください。
    ほかの人は表示しない」

対象:
  1. 選ぶ前は候補が並ぶ
  2. 選んだあとは、その人のチップと「選び直す」だけになる（他の人は出ない）
  3. 「選び直す」を押すと候補が戻る
  4. 他の欄にいる人も候補に出て、どこにいるかの札が付く
  5. その人を押すと**入れ替わる**（相手の欄には元の人が移る）
  6. 空の欄に他の欄の人を入れると、元の欄は空になる
  7. シングルスでも入れ替えが効く
  8. JPAではスキルレベルが入れ替え後も正しく反映される

実行: python _test/pairpick_test.py
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


NAMES = """() => {
  const v = id => { const e = document.getElementById(id); return e ? e.value : null; };
  return {A1: v('inNameA'), A2: v('inNameA2'), B1: v('inNameB'), B2: v('inNameB2')};
}"""


# ピッカーの箱を探す共通の道具。
# シングルスは「入力欄の次」、ダブルスは「member-row の次」に置いてある
FIND = """
  const findWrap = (input) => {
    if (!input) return null;
    const row = input.closest('.member-row');
    let n = (row || input).nextElementSibling;
    while (n) { if (n.classList.contains('picker-wrap')) return n; n = n.nextElementSibling; }
    const f = input.closest('.field');
    return f ? f.querySelector('.picker-wrap') : null;
  };
"""


def picker(pg, target):
    """その名前欄のピッカーの中身を読む。target は 'inNameA' など"""
    return pg.evaluate("""(id) => {""" + FIND + """
      const w = findWrap(document.getElementById(id));
      if (!w) return null;
      return {
        label: (w.querySelector('.picker-label') || {}).textContent,
        chips: [...w.querySelectorAll('.picker-chip')].map(b => ({
          name: (b.querySelector('.pc-name') || {}).textContent,
          at: (b.querySelector('.pc-at') || {}).textContent || null,
          chosen: b.classList.contains('is-chosen'),
        })),
        change: !!w.querySelector('.picker-change'),
        select: !!w.querySelector('.picker-select'),
      };
    }""", target)


def click_chip(pg, target, name):
    """その名前欄のピッカーで、name のチップを押す"""
    pg.evaluate("""([id, nm]) => {""" + FIND + """
      const w = findWrap(document.getElementById(id));
      const b = [...w.querySelectorAll('.picker-chip')]
        .find(x => (x.querySelector('.pc-name') || {}).textContent === nm);
      if (!b) throw new Error('チップが見つからない: ' + nm);
      b.click();
    }""", [target, name])
    pg.wait_for_timeout(500)


def click_change(pg, target):
    pg.evaluate("""(id) => {""" + FIND + """
      const w = findWrap(document.getElementById(id));
      w.querySelector('.picker-change').click();
    }""", target)
    pg.wait_for_timeout(500)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # 4人登録する
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    for n in ["たいら", "岸川", "佐藤", "鈴木"]:
        helpers.add_player(pg, n)
    pg.wait_for_timeout(300)

    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball_doubles")
    pg.wait_for_timeout(700)

    # ================= 1. 選ぶ前 =================
    section("1. 選ぶ前は候補が並ぶ")
    pk = picker(pg, "inNameA")
    print("   " + str(pk))
    check(pk and pk["label"] == "登録した人から選ぶ", "見出しが「登録した人から選ぶ」", pk)
    check(pk and len(pk["chips"]) == 4, "4人ぶんの候補が出る", pk and len(pk["chips"]))
    check(pk and not pk["change"], "「選び直す」はまだ無い")

    # ================= 2. 選んだあと =================
    section("2. 選んだあとは選んだ人だけ")
    click_chip(pg, "inNameA", "たいら")
    pk = picker(pg, "inNameA")
    print("   " + str(pk))
    check(pk and not pk["label"], "見出しは出さない（縦を空けるため）", pk)
    check(pk and len(pk["chips"]) == 1, "チップは1つだけ", pk and len(pk["chips"]))
    check(pk and pk["chips"][0]["name"] == "たいら", "選んだ人が出ている", pk)
    check(pk and pk["chips"][0]["chosen"], "選んだ印が付く", pk)
    check(pk and pk["change"], "「選び直す」がある")
    check(pk and not pk["select"], "ほかの人のプルダウンも畳む")
    check(pg.evaluate(NAMES)["A1"] == "たいら", "名前欄に入る")

    section("3. 「選び直す」で候補が戻る")
    click_change(pg, "inNameA")
    pk = picker(pg, "inNameA")
    check(pk and len(pk["chips"]) == 4, "候補が戻る", pk and len(pk["chips"]))
    click_chip(pg, "inNameA", "たいら")
    pg.wait_for_timeout(300)

    # ================= 4〜5. ペアの組み替え =================
    section("4. 4人そろえる")
    click_chip(pg, "inNameA2", "岸川")
    click_chip(pg, "inNameB", "佐藤")
    click_chip(pg, "inNameB2", "鈴木")
    n = pg.evaluate(NAMES)
    print("   " + str(n))
    check(n == {"A1": "たいら", "A2": "岸川", "B1": "佐藤", "B2": "鈴木"},
          "A=たいら・岸川 / B=佐藤・鈴木", n)

    section("5. 他の欄の人も候補に出て、どこにいるか分かる")
    click_change(pg, "inNameA2")
    pk = picker(pg, "inNameA2")
    print("   " + str(pk))
    check(pk and len(pk["chips"]) == 4, "他の欄の人も出る（4人）", pk and len(pk["chips"]))
    sato = [c for c in pk["chips"] if c["name"] == "佐藤"]
    # 2026-08-22：札の字をクラス（Be・C・B・A・SA・P）と紛れない位置の言葉に変えた
    check(sato and sato[0]["at"] == "右1", "佐藤に「右1」の札が付く", sato)

    section("6. 押すと入れ替わる（ペアの組み替えが1回で済む）")
    click_chip(pg, "inNameA2", "佐藤")
    n2 = pg.evaluate(NAMES)
    print("   " + str(n2))
    check(n2 == {"A1": "たいら", "A2": "佐藤", "B1": "岸川", "B2": "鈴木"},
          "A2と B1 が入れ替わる", n2)
    pg.screenshot(path=os.path.join(SHOTS, "pairpick.png"), full_page=True)

    section("7. 空の欄へ移すと、元の欄は空になる")
    # B2 を空にしてから、そこへ A1 の人を入れる
    pg.evaluate("() => { document.getElementById('inNameB2').value = ''; }")
    pg.wait_for_timeout(200)
    click_change(pg, "inNameB2")
    click_chip(pg, "inNameB2", "たいら")
    n3 = pg.evaluate(NAMES)
    print("   " + str(n3))
    check(n3["B2"] == "たいら" and not n3["A1"], "移した先に入り、元は空になる", n3)

    # ================= 8. シングルス =================
    section("8. シングルスでも入れ替えが効く")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(700)
    click_chip(pg, "inNameA", "たいら")
    click_chip(pg, "inNameB", "岸川")
    n4 = pg.evaluate(NAMES)
    check(n4["A1"] == "たいら" and n4["B1"] == "岸川", "2人そろう", n4)
    click_change(pg, "inNameA")
    pk = picker(pg, "inNameA")
    kis = [c for c in pk["chips"] if c["name"] == "岸川"]
    # 2026-08-22：クラス（Be・C・B・A・SA・P）と紛れない字にした
    check(kis and kis[0]["at"] == "右", "シングルスの札は「右」", kis)
    click_chip(pg, "inNameA", "岸川")
    n5 = pg.evaluate(NAMES)
    print("   " + str(n5))
    check(n5["A1"] == "岸川" and n5["B1"] == "たいら", "AとBが入れ替わる", n5)

    # ================= 9. JPAのスキルレベル =================
    section("9. JPAは入れ替え後もスキルレベルが合う")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(500)
    # たいら=SL7、岸川=SL3 にする
    pg.evaluate("""() => {
      const ps = STORE.listPlayers();
      const set = (nm, v) => { const p = ps.find(x => x.name === nm);
        STORE.setPlayerSkill(p.id, Object.assign({}, p.skill, {nine: v})); };
      set('たいら', 7); set('岸川', 3);
    }""")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(700)
    # 前の節の名前が残っているので、いったん空にしてから選び直す
    pg.evaluate("""() => {
      ['inNameA', 'inNameA2', 'inNameB', 'inNameB2'].forEach(function (id) {
        const e = document.getElementById(id);
        if (e) e.value = '';
      });
    }""")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(500)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(700)
    click_chip(pg, "inNameA", "たいら")
    click_chip(pg, "inNameB", "岸川")
    pg.wait_for_timeout(400)
    sl = pg.eval_on_selector_all("#goalArea .field .chip[aria-pressed='true']",
                                 "e => e.map(x => x.textContent.trim())")
    print("   入れ替え前: " + str(sl))
    check(sl[:2] == ["SL7", "SL3"], "A=SL7 / B=SL3", sl)
    click_change(pg, "inNameA")
    click_chip(pg, "inNameA", "岸川")
    pg.wait_for_timeout(500)
    sl2 = pg.eval_on_selector_all("#goalArea .field .chip[aria-pressed='true']",
                                  "e => e.map(x => x.textContent.trim())")
    print("   入れ替え後: " + str(sl2))
    check(sl2[:2] == ["SL3", "SL7"], "入れ替えるとSLも入れ替わる", sl2)

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
