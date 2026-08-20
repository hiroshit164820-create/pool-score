# -*- coding: utf-8 -*-
"""self_player_test.py — 自分と対戦相手を分けて登録する（本人指示1・2026-08-20）

指示: 「選手登録の際に自分の登録と他プレーヤーの登録を分けてできるように。
       それがホーム画面にくるようにして」

確認する内容:
  1. 登録画面に「自分を登録する」と「対戦相手を登録する」が分かれている
  2. 自分として登録するとホームに自分の成績が出る
  3. 対戦相手として登録しても自分にはならない
  4. 自分は1人だけ（付け替えると前の人は自分でなくなる）
  5. 以前から登録してある人を後から自分にできる（移行の道）
  6. 試合数の多さで自分を推測しない（旧mainPlayerの挙動を残さない）

実行: python _test/self_player_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
sys.path.insert(0, os.path.join(ROOT, "_test"))

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def open_players(pg):
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)


def register(pg, name, as_self):
    """自分／対戦相手を選んで登録する"""
    btn = "#toggleSelfBtn" if as_self else "#toggleAddPlayerBtn"
    pg.click(btn)
    pg.wait_for_timeout(250)
    pg.fill("#newPlayerName", name)
    pg.wait_for_timeout(150)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(350)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 375, "height": 667})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ============================================================
    section("1. 登録が2つに分かれている")
    open_players(pg)
    check(pg.is_visible("#toggleSelfBtn"), "「自分を登録する」がある")
    check(pg.is_visible("#toggleAddPlayerBtn"), "「対戦相手を登録する」がある")
    check("自分" in (pg.text_content("#toggleSelfBtn") or ""), "自分の登録だと分かる文言")
    check("相手" in (pg.text_content("#toggleAddPlayerBtn") or ""), "相手の登録だと分かる文言")

    # 押すと欄の見出しが変わる（どちらを登録中か分かる）
    pg.click("#toggleSelfBtn")
    pg.wait_for_timeout(250)
    check("自分" in (pg.text_content("#newPlayerLabel") or ""), "自分を選ぶと見出しが変わる",
          pg.text_content("#newPlayerLabel"))
    pg.click("#toggleAddPlayerBtn")
    pg.wait_for_timeout(250)
    check("相手" in (pg.text_content("#newPlayerLabel") or ""), "相手を選ぶと見出しが変わる",
          pg.text_content("#newPlayerLabel"))

    # ============================================================
    section("2. 自分として登録するとホームに出る")
    register(pg, "たろう", as_self=True)
    self_id = pg.evaluate("() => (STORE.getSelf() || {}).name || null")
    check(self_id == "たろう", "自分として保存される", self_id)
    check(pg.locator(".player-card.is-self").count() == 1, "一覧で自分に印が付く")

    pg.click("#tabHome")
    pg.wait_for_timeout(400)
    home = pg.text_content("#homeBody") or ""
    check("たろう" in home, "ホームに自分の名前が出る", home[:60])
    check("自分を登録する" not in home, "登録の案内は消える")

    # ============================================================
    section("3. 対戦相手は自分にならない")
    open_players(pg)
    register(pg, "じろう", as_self=False)
    still = pg.evaluate("() => (STORE.getSelf() || {}).name || null")
    check(still == "たろう", "相手を登録しても自分は変わらない", still)
    check(pg.locator(".player-card.is-self").count() == 1, "自分の印は1人だけ")

    # ============================================================
    section("4. 自分は1人だけ")
    register(pg, "さぶろう", as_self=True)
    now_self = pg.evaluate("() => (STORE.getSelf() || {}).name || null")
    check(now_self == "さぶろう", "あとから登録した自分に入れ替わる", now_self)
    check(pg.locator(".player-card.is-self").count() == 1, "印が付くのは1人だけ")
    n = pg.evaluate("() => STORE.listPlayers().length")
    check(n == 3, "3人とも登録は残っている", n)

    # ============================================================
    section("5. あとから自分にできる（移行の道）")
    # 「じろう」を自分にする
    idx = pg.evaluate("""() => {
      const cards = Array.from(document.querySelectorAll('.player-card'));
      return cards.findIndex(c => (c.textContent || '').indexOf('じろう') >= 0);
    }""")
    check(idx >= 0, "じろうのカードがある", idx)
    pg.locator(".player-card").nth(idx).locator(".pc-more").click()
    pg.wait_for_timeout(300)
    pg.click("text=この人を自分にする")
    pg.wait_for_timeout(350)
    after = pg.evaluate("() => (STORE.getSelf() || {}).name || null")
    check(after == "じろう", "あとから自分にできる", after)

    # 外すこともできる
    idx2 = pg.evaluate("""() => {
      const cards = Array.from(document.querySelectorAll('.player-card'));
      return cards.findIndex(c => c.classList.contains('is-self'));
    }""")
    pg.locator(".player-card").nth(idx2).locator(".pc-more").click()
    pg.wait_for_timeout(300)
    pg.click("text=自分の指定を外す")
    pg.wait_for_timeout(350)
    cleared = pg.evaluate("() => STORE.getSelf()")
    check(cleared is None, "自分の指定を外せる", cleared)

    # ============================================================
    section("6. 試合数で自分を推測しない")
    # 誰も自分に指定していない状態でホームを見る。
    # 旧mainPlayerは試合数の最多者を自分にしていたので、
    # 記録があっても勝手に誰かの成績が出ないことを確認する
    pg.click("#tabHome")
    pg.wait_for_timeout(400)
    home2 = pg.text_content("#homeBody") or ""
    check("自分を登録する" in home2, "自分が未登録なら登録を促す", home2[:80])
    check("の成績" not in home2, "勝手に誰かの成績を出さない", home2[:80])

    # 自分を消したら指定も外れる
    pg.evaluate("""() => {
      const p = STORE.listPlayers()[0];
      STORE.setSelf(p.id);
      STORE.deletePlayer(p.id);
    }""")
    gone = pg.evaluate("() => STORE.getSelf()")
    check(gone is None, "自分を削除したら指定も外れる", gone)

    check(not errs, "JavaScriptエラーが出ていない", errs[:3])
    b.close()

ng = [r for r in results if not r[0]]
print("\n============================================")
print("成功: %d / 失敗: %d" % (len(results) - len(ng), len(ng)))
if ng:
    print("【失敗した項目】")
    for _, label, detail in ng:
        print("  - " + label + (("  -> " + str(detail)) if detail else ""))
    sys.exit(1)
print("すべて成功")
