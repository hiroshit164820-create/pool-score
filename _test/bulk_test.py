# -*- coding: utf-8 -*-
"""bulk_test.py — 履歴の複数選択（本人の指示 2026-08-22）

本人の指示:
  「試合結果を複数件まとめて送ることもできる？履歴にチェックボックス付けて、
    複数選択してからまとめて送信みたいな。」
  「それに付随して、複数まとめて削除、複数まとめてメモ、も可能にしたい」
  「既存メモがあるときは既存を『メモ1』として、『メモ2』に自動的に追記する形に」

対象:
  1. 履歴に「複数選択」があり、押すと選べる状態になる
  2. カードを押すと選べる／もう一度押すと外れる
  3. 選んでいる間は、カードの中のボタン（削除など）を押せない
  4. 何も選んでいないと、まとめての操作は押せない
  5. まとめて削除：確認が出て、選んだぶんだけ消える
  6. まとめてメモ：メモが無い試合にはそのまま入る
  7. まとめてメモ：**すでにメモがある試合は「メモ1」「メモ2」になる**
  8. 3回目は「メモ3」になる（番号が続く）
  9. 「複数選択をやめる」で選択が消える
 10. JSエラーが無い

実行: python _test/bulk_test.py
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
NL = chr(10)


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def play_match(pg, a, b):
    """9ボール2先を1試合こなして終わらせる"""
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", a)
    pg.fill("#inNameB", b)
    pg.wait_for_timeout(200)
    helpers.set_goal(pg, 3)
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    for _ in range(12):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(180)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(800)


# 3件を1本のリンクにまとめ、読み戻して同じ3件になるか確かめる
MANY_PROBE = """async () => {
  const ids = STORE.listMatches().slice(0, 3).map(m => m.id);
  const list = ids.map(id => STORE.loadMatch(id));
  const out = await SHARE.makeLink(list);
  const body = SHARE.readAny(out.url);
  const back = await SHARE.decodeAll(body);
  return {chars: out.chars, count: out.count, dropped: out.dropped,
          got: back.length, ids: ids, backIds: back.map(p => p.id),
          qr: QRCODE.make(out.url, {ecLevel: 'L'}).size};
}"""


def cards(pg):
    return pg.locator("#historyList .match-card")


def pick(pg, i):
    cards(pg).nth(i).click()
    pg.wait_for_timeout(350)


def notes(pg):
    return pg.evaluate("""() => STORE.listMatches().map(m => ({
      who: m.names.A + '対' + m.names.B, note: m.note || ''
    }))""")


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    section("1. 3試合こなす")
    play_match(pg, "たいら", "いっちょ")
    play_match(pg, "たいら", "さとう")
    play_match(pg, "たいら", "すずき")
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    check(cards(pg).count() == 3, "履歴に3件ある", cards(pg).count())

    section("2. 「複数選択」で選べる状態になる")
    check(pg.is_visible("#histSelectBtn"), "「複数選択」がある")
    check(pg.locator("#bulkBar").get_attribute("hidden") is not None,
          "ふだんはまとめての帯を出さない")
    pg.click("#histSelectBtn")
    pg.wait_for_timeout(500)
    check(pg.locator("#bulkBar").get_attribute("hidden") is None, "まとめての帯が出る")
    check((pg.text_content("#histSelectBtn") or "").strip() == "複数選択をやめる",
          "ボタンの文字が変わる", pg.text_content("#histSelectBtn"))
    check(cards(pg).nth(0).evaluate("e => e.classList.contains('is-selectable')"),
          "カードが選べる見た目になる")

    section("3. 何も選んでいないと押せない")
    dis = pg.evaluate("""() => ['bulkSendBtn','bulkNoteBtn','bulkDeleteBtn']
      .map(id => document.getElementById(id).disabled)""")
    check(all(dis), "まとめての3つが押せない", dis)
    cnt = pg.inner_text("#bulkCount")
    check("選びたい" in cnt, "何をすればよいか出ている", cnt)

    section("4. 押すと選べる／もう一度押すと外れる")
    pick(pg, 0)
    check(cards(pg).nth(0).evaluate("e => e.classList.contains('is-picked')"), "1件目が選ばれる")
    check("1件" in pg.inner_text("#bulkCount"), "件数が出る", pg.inner_text("#bulkCount"))
    dis2 = pg.evaluate("""() => document.getElementById('bulkDeleteBtn').disabled""")
    check(not dis2, "選ぶと押せるようになる")
    pick(pg, 0)
    check(not cards(pg).nth(0).evaluate("e => e.classList.contains('is-picked')"),
          "もう一度押すと外れる")
    check("選びたい" in pg.inner_text("#bulkCount"), "件数の表示も戻る")

    section("5. 選んでいる間はカードの中のボタンを押せない")
    pick(pg, 0)
    blocked = cards(pg).nth(0).evaluate("""e => {
      const b = e.querySelector('.mc-foot button');
      if (!b) return null;
      return getComputedStyle(b).pointerEvents;
    }""")
    check(blocked == "none", "中のボタンが押せない状態になっている", blocked)
    pg.screenshot(path=os.path.join(SHOTS, "bulk_select.png"), full_page=True)

    section("6. まとめてメモ（メモが無い試合）")
    pick(pg, 1)  # 1件目と2件目を選ぶ
    check("2件" in pg.inner_text("#bulkCount"), "2件を選択中", pg.inner_text("#bulkCount"))
    pg.once("dialog", lambda d: d.accept("台が重い"))
    pg.click("#bulkNoteBtn")
    pg.wait_for_timeout(900)
    ns = notes(pg)
    print("   " + str(ns))
    got = [x["note"] for x in ns if x["note"]]
    check(len(got) == 2, "2件にメモが入る", ns)
    check(all(x == "台が重い" for x in got), "はじめは番号を付けない", got)

    section("7. すでにメモがある試合は「メモ1」「メモ2」になる")
    pg.once("dialog", lambda d: d.accept("キューを替えた"))
    pg.click("#bulkNoteBtn")
    pg.wait_for_timeout(900)
    ns2 = [x["note"] for x in notes(pg) if x["note"]]
    print("   " + repr(ns2[0]))
    check(all("メモ1" in n for n in ns2), "「メモ1」が付く", ns2[:1])
    check(all("メモ2" in n for n in ns2), "「メモ2」が付く", ns2[:1])
    check(all("台が重い" in n for n in ns2), "前のメモが残っている", ns2[:1])
    check(all("キューを替えた" in n for n in ns2), "新しいメモも入る", ns2[:1])
    want = "メモ1" + NL + "台が重い" + NL + NL + "メモ2" + NL + "キューを替えた"
    check(ns2[0] == want, "並びが「メモ1→メモ2」になっている", repr(ns2[0]))

    section("8. 3回目は「メモ3」になる")
    pg.once("dialog", lambda d: d.accept("ラシャが新しい"))
    pg.click("#bulkNoteBtn")
    pg.wait_for_timeout(900)
    ns3 = [x["note"] for x in notes(pg) if x["note"]]
    check(all("メモ3" in n for n in ns3), "「メモ3」になる", ns3[:1])
    check(all("メモ4" not in n for n in ns3), "番号が飛ばない", ns3[:1])
    print("   " + repr(ns3[0]))

    section("9. まとめて削除")
    # いま1件目と2件目が選ばれている
    n_before = pg.evaluate("() => STORE.listMatches().length")
    # 取り消したら消えない
    pg.once("dialog", lambda d: d.dismiss())
    pg.click("#bulkDeleteBtn")
    pg.wait_for_timeout(700)
    check(pg.evaluate("() => STORE.listMatches().length") == n_before,
          "確認を取り消したら消えない")
    pg.once("dialog", lambda d: d.accept())
    pg.click("#bulkDeleteBtn")
    pg.wait_for_timeout(900)
    left = pg.evaluate("() => STORE.listMatches().length")
    check(left == n_before - 2, "選んだ2件だけ消える", {"前": n_before, "後": left})
    check("選びたい" in pg.inner_text("#bulkCount"), "選択が空になる")

    section("10. 複数選択をやめる")
    pick(pg, 0)
    pg.click("#histSelectBtn")
    pg.wait_for_timeout(500)
    check(pg.locator("#bulkBar").get_attribute("hidden") is not None, "帯が消える")
    check(not cards(pg).nth(0).evaluate("e => e.classList.contains('is-picked')"),
          "選択も消える")
    check((pg.text_content("#histSelectBtn") or "").strip() == "複数選択", "文字が戻る")
    # ふつうの状態ではカードの中のボタンが押せる
    live = cards(pg).nth(0).evaluate("""e => {
      const b = e.querySelector('.mc-foot button');
      return b ? getComputedStyle(b).pointerEvents : null;
    }""")
    check(live != "none", "中のボタンがまた押せる", live)

    section("11. まとめて送る")
    # 残り1件では「まとめて」にならないので、2試合足してから確かめる
    play_match(pg, "たいら", "たなか")
    play_match(pg, "たいら", "やまだ")
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    pg.click("#histSelectBtn")
    pg.wait_for_timeout(400)
    pick(pg, 0)
    pick(pg, 1)
    pick(pg, 2)
    check("3件" in pg.inner_text("#bulkCount"), "3件を選択中", pg.inner_text("#bulkCount"))
    pg.click("#bulkSendBtn")
    pg.wait_for_timeout(1500)
    check(pg.locator("#shareModal").get_attribute("hidden") is None, "送るカードが開く")
    sub = pg.inner_text("#shareSub")
    print("   " + sub)
    check("3件" in sub, "何件を送るのか出る", sub)
    btns3 = pg.eval_on_selector_all("#shareBody button",
                                    "e => e.map(x => x.textContent.trim())")
    check("QRを表示する" in btns3 and "リンクで送る" in btns3, "送り方を選べる", btns3)

    # 3件ぶんが本当に1本のリンクに入っているか、読み戻して確かめる
    many = pg.evaluate(MANY_PROBE)
    print("   " + str(many))
    check(many["count"] == 3 and many["dropped"] == 0, "3件とも入る", many)
    check(many["got"] == 3, "読み戻すと3件になる", many)
    check(sorted(many["ids"]) == sorted(many["backIds"]), "同じ試合が返る", many)
    pg.locator("#shareBody button", has_text="QRを表示する").click()
    pg.wait_for_timeout(900)
    check(pg.locator("#shareQrCanvas").count() == 1, "3件ぶんのQRが描ける")
    pg.screenshot(path=os.path.join(SHOTS, "bulk_send_qr.png"), full_page=False)
    pg.click("#shareCloseBtn")
    pg.wait_for_timeout(400)

    section("12. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
