# -*- coding: utf-8 -*-
"""fixhist_test.py — 履歴から終わった試合の記録を直す（本人の指示 2026-08-27）

本人の質問「履歴の試合結果からスコア修正をすることは可能？」から。
調べたところ、仕組み（スコア修正）は終わった試合でも動くのに入口が無く、
さらに取り消しても結果と成績が作り直されないままだった。

決めたこと（本人の承認 2026-08-27）:
  1. 履歴に「記録を直す」を足す。「試合終了」の記録だけは選ばせない（案A）
  2. 取り消したら結果と成績を作り直す。
     勝利条件を満たさなくなった試合は「進行中」に戻す
  3. 取り消す前に断りを出す

確かめること:
  1. 終わった試合の履歴カードに「記録を直す」が出る（進行中には出ない）
  2. 一覧に「試合終了」が出ない
  3. 勝敗が保たれる取り消し → 結果と成績の数値が減る。終了のまま
  4. 勝敗が決まらなくなる取り消し → 進行中に戻り、成績から外れる
  5. 取り消す前に確認が出る（断ると何も変わらない）

実行: python _test/fixhist_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


SNAP = """() => {
  const m = STORE.listMatches()[0];
  const full = m ? STORE.loadMatch(m.id) : null;
  const self = STORE.getSelfId();
  const d = self ? STORE.gameDetail(self) : null;
  const g = d && d.byGame ? d.byGame['9ball'] : null;
  return {
    終了: m ? m.finished : null,
    索引ラック: m ? m.racks : null,
    勝者: full && full.result ? full.result.winner : null,
    結果ラック: full && full.result ? full.result.racks : null,
    成績: g ? { 試合: g.matches, 勝: g.wins, 負: g.losses, ラック: g.racks } : null,
  };
}"""

SEED_SELF = """() => {
  const p = STORE.upsertPlayer('たいら');
  STORE.setSelf((p && p.id) ? p.id : p);
}"""


def play(pg, goal, a_wins, b_wins):
    """9ボールを goal 先取で、Aが a_wins・Bが b_wins ラック取って終わらせる"""
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "いっちょ")
    helpers.set_goal(pg, goal)
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    # 先に負ける側のぶんを入れてから、勝つ側で決める
    for _ in range(b_wins):
        pg.click("#panelB")
        pg.wait_for_timeout(280)
    for _ in range(a_wins):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(280)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)


def open_more(pg):
    """履歴カードの「⋯」を開く。中に「記録を直す」「削除」が入っている。

    「⋯」は押すたびに開閉するので、すでに開いていれば押さない
    （押すと閉じてしまい、中のボタンが見つからなくなる）。
    """
    if not pg.is_visible("#screenHistory"):
        pg.click("#tabHistory")
        pg.wait_for_timeout(800)
    more = pg.locator("#historyList .mc-more").first
    if not more.count():
        return False
    if more.get_attribute("aria-pressed") != "true":
        more.click()
        pg.wait_for_timeout(400)
    return pg.locator("#historyList .mc-more-body").count() > 0


def open_fix(pg):
    """履歴の「⋯」→「記録を直す」から試合画面を開き、スコア修正の一覧を出す"""
    if not open_more(pg):
        return False
    btn = pg.locator("#historyList .mc-more-body button", has_text="記録を直す").first
    if not btn.count():
        return False
    btn.click()
    pg.wait_for_timeout(900)
    pg.click("#reviseBtn")
    pg.wait_for_timeout(600)
    return True


def rows(pg):
    return pg.evaluate("""() => {
      const l = document.getElementById('evList');
      return l ? [...l.querySelectorAll('.ev-item')]
        .map(r => r.innerText.replace(/\\n/g, ' ')) : [];
    }""")


errs = []

with sync_playwright() as p:
    br = p.chromium.launch()

    # ============ 1・2・3. 勝敗が保たれる取り消し ============
    section("勝敗が保たれる取り消し（3先取で 3-2 → Bのラックを1つ消す）")
    pg = br.new_page(viewport={"width": 430, "height": 932})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    pg.goto(URL)
    pg.wait_for_timeout(900)
    pg.evaluate(SEED_SELF)
    pg.wait_for_timeout(300)
    play(pg, 3, 3, 2)
    before = pg.evaluate(SNAP)
    check(before["終了"] and before["索引ラック"] == {"A": 3, "B": 2},
          "下ごしらえ: 3-2 でたいらの勝ち", before)

    # ボタンが5つになると狭い画面で1行に収まらないため、
    # 「記録を直す」と「削除」は「⋯」の中にしまってある（本人の指示 2026-08-27）
    check(open_more(pg), "1. 履歴カードに「⋯」がある")
    check(pg.locator("#historyList .mc-more-body button", has_text="記録を直す").count() >= 1,
          "1. 「⋯」の中に「記録を直す」がある")
    check(pg.locator("#historyList .mc-more-body button", has_text="削除").count() >= 1,
          "1. 「⋯」の中に「削除」がある")
    rowsN = pg.evaluate("""() => {
      const f = document.querySelector('.match-card .mc-foot');
      return f ? new Set([...f.children]
        .map(c => Math.round(c.getBoundingClientRect().top))).size : null;
    }""")
    check(rowsN == 1, "1. 430px では操作ボタンが1行に収まる", rowsN)

    check(open_fix(pg), "下ごしらえ: 「記録を直す」から開けた")
    rs = rows(pg)
    check(not any("試合終了" in r for r in rs),
          "2. 一覧に「試合終了」が出ない（案A）", rs)
    check(any("ラックを取った" in r for r in rs),
          "2. 得点の記録は直せる", rs)

    # いっちょ（B）のラックを1つ取り消す。3-2 → 3-1 で勝敗は変わらない
    row = pg.locator(".ev-item", has_text="いっちょ がラックを取った").first
    check(row.count() > 0, "下ごしらえ: Bのラックの記録がある")
    row.locator("button", has_text="取り消す").first.click()
    pg.wait_for_timeout(1000)
    after = pg.evaluate(SNAP)
    check(after["終了"] is True, "3. 終わったままである", after)
    check(after["勝者"] == "A", "3. 勝者は変わらない", after)
    check(after["結果ラック"] == {"A": 3, "B": 1},
          "3. 結果のラック数が減る（B 2→1）", after)
    check(after["索引ラック"] == {"A": 3, "B": 1},
          "3. 履歴の一覧にも反映される", after)
    check(after["成績"] and after["成績"]["ラック"] == 4,
          "3. 成績のラック数も減る（5→4）", after["成績"])
    check(after["成績"] and after["成績"]["勝"] == 1,
          "3. 勝ち数は変わらない", after["成績"])
    pg.close()

    # ============ 4. 勝敗が決まらなくなる取り消し ============
    section("勝敗が決まらなくなる取り消し（3先取で 3-0 → Aのラックを1つ消す）")
    pg = br.new_page(viewport={"width": 430, "height": 932})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    pg.goto(URL)
    pg.wait_for_timeout(900)
    pg.evaluate(SEED_SELF)
    pg.wait_for_timeout(300)
    play(pg, 3, 3, 0)
    check(pg.evaluate(SNAP)["終了"] is True, "下ごしらえ: 3-0 で終わっている")

    check(open_fix(pg), "下ごしらえ: 「記録を直す」から開けた")
    pg.locator(".ev-item", has_text="たいら がラックを取った").first \
        .locator("button", has_text="取り消す").first.click()
    pg.wait_for_timeout(1000)
    after = pg.evaluate(SNAP)
    check(after["終了"] is False, "4. 進行中に戻る", after)
    check(after["勝者"] is None, "4. 勝者が消える", after)
    check(after["成績"] is None or after["成績"]["試合"] == 0,
          "4. 成績から外れる", after["成績"])
    pg.close()

    # ============ 5. 断ると何も変わらない ============
    section("取り消しの確認を断ったとき")
    pg = br.new_page(viewport={"width": 430, "height": 932})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # ダイアログの応え方は1か所で切り替える。
    # listener を重ねると、同じダイアログを2回さばこうとしてエラーになる
    answer = {"yes": True}
    pg.on("dialog", lambda d: d.accept() if answer["yes"] else d.dismiss())
    pg.goto(URL)
    pg.wait_for_timeout(900)
    pg.evaluate(SEED_SELF)
    pg.wait_for_timeout(300)
    play(pg, 3, 3, 0)
    base = pg.evaluate(SNAP)
    check(base["終了"] is True, "下ごしらえ: 終わっている")

    # ここから先は断る
    answer["yes"] = False
    if open_fix(pg):
        pg.locator(".ev-item", has_text="ラックを取った").first \
            .locator("button", has_text="取り消す").first.click()
        pg.wait_for_timeout(900)
        now = pg.evaluate(SNAP)
        check(now["終了"] == base["終了"] and now["結果ラック"] == base["結果ラック"],
              "5. 断ったら何も変わらない", str(base) + " → " + str(now))
    pg.close()

    check(not errs, "JSエラーが出ない", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "-" * 50)
print("合計 %d件 / NG %d件" % (len(results), len(ng)))
sys.exit(1 if ng else 0)
