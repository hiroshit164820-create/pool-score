# -*- coding: utf-8 -*-
"""share_test.py — 試合の記録を相手に渡す（本人の指示 2026-08-21）

本人の要望:
  「試合記録を対戦相手にも共有する機能が欲しい。
    両方の端末で記録を付けるのもめんどくさい」
  「万が一名前が違った場合はどうなる？」

作りは「記録をリンクに載せて渡す」。サーバーは使わない。
このテストでは、送る側と受け取る側を**別のブラウザ**（別のlocalStorage）で
用意して、往復を通しで確かめる。

対象:
  1. 終わった試合に「相手に送る」が出る（途中の試合には出ない）
  2. リンクが作れる（長さが上限内）
  3. 受け取り側でリンクを開くと取り込みの画面が出る
  4. 名前が一致する人は、はじめから選ばれている
  5. **名前が違うときは選ばれておらず、その場で選べる**
  6. 何も選ばずに取り込むと、成績に入らない（記録だけ残る）
  7. 選んで取り込むと、その人の成績に入る
  8. 一度対応付けると次から自動で選ばれる
  9. 同じ試合を2回取り込もうとすると警告が出る
 10. 取り込んだ試合は履歴に出て、中身（スコア）が送った側と一致する

実行: python _test/share_test.py
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


def play_match(pg, a, b):
    """9ボール3先を1試合こなして終わらせる"""
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(600)
    pg.fill("#inNameA", a)
    pg.fill("#inNameB", b)
    pg.wait_for_timeout(250)
    helpers.set_goal(pg, 3)
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)
    for _ in range(12):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(220)
    pg.wait_for_timeout(400)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)


def map_row(pg, side):
    """取り込み画面の対応付けの行を読む"""
    return pg.evaluate("""(side) => {
      const rows = [...document.querySelectorAll('#importBody .import-map')];
      const r = rows[side === 'A' ? 0 : 1];
      if (!r) return null;
      return {
        label: r.querySelector('label').textContent,
        chips: [...r.querySelectorAll('.chip')].map(c => ({
          t: c.textContent.trim(), on: c.classList.contains('is-on')})),
        now: r.querySelector('.hint').textContent.trim(),
      };
    }""", side)


def click_map(pg, side, text):
    pg.evaluate("""([side, t]) => {
      const rows = [...document.querySelectorAll('#importBody .import-map')];
      const r = rows[side === 'A' ? 0 : 1];
      const b = [...r.querySelectorAll('.chip')].find(c => c.textContent.trim().indexOf(t) >= 0);
      if (!b) throw new Error('選択肢が無い: ' + t);
      b.click();
    }""", [side, text])
    pg.wait_for_timeout(400)


with sync_playwright() as p:
    br = p.chromium.launch()

    # ================= 送る側 =================
    section("1. 送る側で1試合こなす")
    send = br.new_context(viewport={"width": 390, "height": 844})
    ps = send.new_page()
    errs_s = []
    ps.on("pageerror", lambda e: errs_s.append(str(e)))
    ps.goto(URL)
    ps.wait_for_timeout(700)
    play_match(ps, "たいら", "いっちょ")
    ps.click("#tabHistory")
    ps.wait_for_timeout(800)
    foot = ps.eval_on_selector_all("#historyList .mc-foot button",
                                   "e => e.map(x => x.textContent.trim())")
    print("   履歴のボタン: " + str(foot))
    check("相手に送る" in foot, "終わった試合に「相手に送る」が出る", foot)

    section("2. リンクを作る")
    link = ps.evaluate("""async () => {
      const m = STORE.loadMatch(STORE.listMatches()[0].id);
      const out = await SHARE.makeLink(m, 'file:///x/index.html');
      return {chars: out.chars, slim: out.slim, url: out.url,
              scores: m.result.scores, racks: m.result.racks, id: m.id,
              gz: SHARE.canGzip()};
    }""")
    print("   %d文字 / 結果だけ=%s / 圧縮=%s" % (link["chars"], link["slim"], link["gz"]))
    check(link["chars"] > 0, "リンクが作れる", link["chars"])
    check(link["chars"] <= 6000, "上限（6000字）に収まる", link["chars"])
    check(not link["slim"], "1球ごとの記録も入っている（結果だけに落ちていない）", link["slim"])
    body = link["url"].split("#")[1]
    ongoing_btns = ps.evaluate("""() => {
      // 途中の試合には「相手に送る」を出さない
      const cards = [...document.querySelectorAll('#historyList .match-card')];
      return cards.length;
    }""")
    check(ongoing_btns >= 1, "履歴に試合がある", ongoing_btns)
    check(not errs_s, "送る側でJSエラーなし", errs_s[:3])

    # ================= 受け取る側（名前が一致） =================
    section("3. 受け取る側：名前が一致する場合")
    recv = br.new_context(viewport={"width": 390, "height": 844})
    pr = recv.new_page()
    errs_r = []
    pr.on("pageerror", lambda e: errs_r.append(str(e)))
    pr.goto(URL)
    pr.wait_for_timeout(700)
    # 受け取る側には「いっちょ」だけ同じ名前で登録しておく（自分）
    pr.click("#tabPlayers")
    pr.wait_for_timeout(400)
    pr.click("#toggleSelfBtn")
    pr.wait_for_timeout(200)
    pr.fill("#newPlayerName", "いっちょ")
    pr.wait_for_timeout(150)
    pr.click("#addPlayerBtn")
    pr.wait_for_timeout(400)
    # 相手は違う名前で登録してある（本人の心配「名前が違った場合」）
    helpers.add_player(pr, "たいらさん")
    pr.wait_for_timeout(300)

    pr.goto(URL + "#" + body)
    pr.wait_for_timeout(1500)
    check(pr.is_visible("#screenImport"), "取り込みの画面が出る")
    txt = pr.inner_text("#importBody")
    print("   " + txt.replace("\n", " / ")[:160])
    check("たいら" in txt and "いっちょ" in txt, "送られてきた名前が出る", txt[:120])
    check("9ボール" in txt, "種目が出る", txt[:80])

    section("4. 名前が一致する側は、はじめから選ばれている")
    rb = map_row(pr, "B")
    print("   B: " + str(rb))
    check(rb and "いっちょ" in rb["label"], "B側の名前が「いっちょ」", rb)
    on = [c["t"] for c in rb["chips"] if c["on"]]
    check(any("いっちょ" in t for t in on), "「いっちょ」が選ばれている", on)
    check("いっちょ" in rb["now"], "「いっちょ として数えます」と出る", rb["now"])

    section("5. 名前が違う側は選ばれていない（本人の心配どおりの場合）")
    ra = map_row(pr, "A")
    print("   A: " + str(ra))
    check(ra and "たいら" in ra["label"], "A側の名前が「たいら」", ra)
    onA = [c["t"] for c in ra["chips"] if c["on"]]
    check(onA == ["成績に入れない"], "何も選ばれず「成績に入れない」になっている", onA)
    check("成績には入れません" in ra["now"], "そのままだと成績に入らないと出る", ra["now"])
    check(any("たいらさん" in c["t"] for c in ra["chips"]),
          "この端末の「たいらさん」が選択肢に出る", ra["chips"])
    check(any("新しく登録する" in c["t"] for c in ra["chips"]),
          "「新しく登録する」もある", ra["chips"])
    pr.screenshot(path=os.path.join(SHOTS, "share_import.png"), full_page=True)

    section("6. 違う名前の人に結び付けて取り込む")
    click_map(pr, "A", "たいらさん")
    ra2 = map_row(pr, "A")
    check("たいらさん" in ra2["now"], "「たいらさん として数えます」に変わる", ra2["now"])
    pr.locator("#importBody button", has_text="この試合を取り込む").click()
    pr.wait_for_timeout(1200)
    check(not pr.is_visible("#screenImport"), "取り込みの画面が閉じる")
    hist = pr.inner_text("#historyList")
    print("   履歴: " + hist.replace("\n", " / ")[:140])
    check("たいらさん" in hist, "履歴にこちらの名前で出る", hist[:140])
    check("いっちょ" in hist, "相手の名前も出る", hist[:140])

    section("7. 中身が送った側と一致する")
    got = pr.evaluate("""() => {
      const idx = STORE.listMatches()[0];
      const m = STORE.loadMatch(idx.id);
      return {id: m.id, scores: m.result.scores, racks: m.result.racks,
              winner: m.result.winner, events: m.events.length,
              names: {A: m.sides[0].name, B: m.sides[1].name},
              pids: {A: m.sides[0].playerIds.length, B: m.sides[1].playerIds.length}};
    }""")
    print("   " + str(got))
    check(got["id"] == link["id"], "同じ試合ID", (got["id"], link["id"]))
    check(got["racks"] == link["racks"], "ラック数が一致", (got["racks"], link["racks"]))
    check(got["events"] > 0, "1球ごとの記録も入っている", got["events"])
    check(got["pids"]["A"] == 1 and got["pids"]["B"] == 1, "両方とも人に結び付いた", got["pids"])

    section("8. 成績に入っている")
    st = pr.evaluate("""() => {
      const p = STORE.listPlayers().find(x => x.name === 'たいらさん');
      const s = STORE.playerStats(p.id);
      const me = STORE.getSelf();
      const ms = STORE.playerStats(me.id);
      return {taira: {m: s.matches, w: s.wins}, me: {m: ms.matches, w: ms.wins}};
    }""")
    print("   " + str(st))
    check(st["taira"]["m"] == 1 and st["taira"]["w"] == 1,
          "「たいらさん」に1勝が入る", st["taira"])
    check(st["me"]["m"] == 1 and st["me"]["w"] == 0, "自分に1敗が入る", st["me"])

    section("9. 同じ試合をもう一度開くと警告が出る")
    pr.goto(URL + "#" + body)
    pr.wait_for_timeout(1500)
    sub = pr.inner_text("#importSub")
    body_txt = pr.inner_text("#importBody")
    check("もう持っています" in sub, "見出しで知らせる", sub)
    check("二重になります" in body_txt, "二重になると書いてある", body_txt[:200])
    # 直下のボタン（取り込む／取り込まない）だけを見る。
    # 中の対応付けもボタンなので、絞らないと最初の1つを取ってしまう
    labels = pr.eval_on_selector_all("#importBody > button",
                                     "e => e.map(x => x.textContent.trim())")
    check("それでも取り込む" in labels,
          "ボタンが「それでも取り込む」に変わる", labels)

    section("10. 対応付けを覚えている（次から自動）")
    ra3 = map_row(pr, "A")
    onA3 = [c["t"] for c in ra3["chips"] if c["on"]]
    check(any("たいらさん" in t for t in onA3),
          "前に選んだ「たいらさん」が最初から選ばれている", onA3)
    pr.locator("#importBody button", has_text="取り込まない").click()
    pr.wait_for_timeout(600)
    check(pr.evaluate("() => STORE.listMatches().length") == 1, "二重に増えていない")

    section("11. 何も選ばずに取り込むと成績に入らない")
    # 2試合目を作って送る
    play_match(ps, "たいら", "べつのひと")
    link2 = ps.evaluate("""async () => {
      const m = STORE.loadMatch(STORE.listMatches()[0].id);
      const out = await SHARE.makeLink(m, 'file:///x/index.html');
      return out.url;
    }""")
    body2 = link2.split("#")[1]
    pr.goto(URL + "#" + body2)
    pr.wait_for_timeout(1500)
    # A（たいら）は覚えているので選ばれている。両方とも「成績に入れない」にする
    click_map(pr, "A", "成績に入れない")
    click_map(pr, "B", "成績に入れない")
    pr.locator("#importBody button", has_text="この試合を取り込む").click()
    pr.wait_for_timeout(1200)
    st2 = pr.evaluate("""() => {
      const p = STORE.listPlayers().find(x => x.name === 'たいらさん');
      return {matches: STORE.listMatches().length, taira: STORE.playerStats(p.id).matches};
    }""")
    print("   " + str(st2))
    check(st2["matches"] == 2, "記録は増える", st2)
    check(st2["taira"] == 1, "成績は増えない（1試合のまま）", st2)

    section("JSエラー")
    check(not errs_r, "受け取る側でJSエラーなし", errs_r[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
