# -*- coding: utf-8 -*-
"""paste_test.py — リンクを貼り付けて取り込む（本人の指示 2026-08-22）

本人の指摘（実機で確認したうえでの報告）:
  「LINEで開いたブラウザ上でしか反映されず、
    ホーム画面に追加したアイコンから開いたアプリの方に取り込まれない。
    アプリの中にリンクを貼る窓をつけて、取り込むボタンをつけるのは可能？」

ホーム画面のアプリとLINEの中のブラウザは、見た目が同じでも保存場所が別々。
リンクを踏んだ側にしか記録が入らない。そこで:
  ・履歴に「受け取る」を置き、リンクを貼り付けて取り込めるようにした
  ・リンクを踏んだ側（ブラウザ）に「このリンクを写す」を出した

対象:
  1. 履歴に「受け取る」がある
  2. 押すと貼り付け窓が出る
  3. でたらめな文字を入れると理由が出て、取り込まれない
  4. リンクをまるごと貼ると取り込みの確認が出る
  5. 前後に文章が付いていても通る
  6. 「1.g.…」の本体だけでも通る
  7. 取り込むと履歴に入り、成績にも入る
  8. 二重の取り込みには警告が出る
  9. リンクを踏んだ側には「このリンクを写す」の案内が出る
 10. JSエラーが無い

実行: python _test/paste_test.py
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


def open_paste(pg):
    pg.click("#tabHistory")
    pg.wait_for_timeout(600)
    pg.click("#importOpenBtn")
    pg.wait_for_timeout(600)


def try_paste(pg, text):
    """貼り付け窓に入れて「取り込む」を押す"""
    pg.fill("#importPasteBox", text)
    pg.wait_for_timeout(200)
    pg.locator("#importBody button", has_text="取り込む").first.click()
    pg.wait_for_timeout(1200)


with sync_playwright() as p:
    br = p.chromium.launch()

    # ================= 送る側でリンクを作る =================
    section("1. 送る側で1試合こなしてリンクを作る")
    send = br.new_context(viewport={"width": 390, "height": 844})
    ps = send.new_page()
    errs_s = []
    ps.on("pageerror", lambda e: errs_s.append(str(e)))
    ps.goto(URL)
    ps.wait_for_timeout(700)
    play_match(ps, "たいら", "いっちょ")
    link = ps.evaluate("""async () => {
      const m = STORE.loadMatch(STORE.listMatches()[0].id);
      const out = await SHARE.makeLink(m, 'file:///x/index.html');
      return {url: out.url, chars: out.chars, scores: m.result.scores, id: m.id};
    }""")
    body = link["url"].split("#")[1]
    raw = body.split("=", 1)[1]
    print("   %d文字" % link["chars"])
    check(link["chars"] > 0, "リンクが作れる", link["chars"])
    check(not errs_s, "送る側でJSエラーなし", errs_s[:3])

    # ================= 貼り付けの読み取り（単体） =================
    section("2. 貼り付けの読み取り（SHARE.readAny）")
    cases = ps.evaluate("""(a) => {
      const url = a[0], raw = a[1];
      return {
        full: SHARE.readAny(url),
        withText: SHARE.readAny('9ボール たいら 対 いっちょ の記録です。開くと取り込めます。 ' + url),
        hashOnly: SHARE.readAny('#m=' + raw),
        keyOnly: SHARE.readAny('m=' + raw),
        rawOnly: SHARE.readAny(raw),
        junk: SHARE.readAny('こんにちは'),
        empty: SHARE.readAny(''),
        nul: SHARE.readAny(null)
      };
    }""", [link["url"], raw])
    check(cases["full"] == raw, "リンクまるごとから読める")
    check(cases["withText"] == raw, "前後に文章が付いていても読める")
    check(cases["hashOnly"] == raw, "「#m=…」だけでも読める")
    check(cases["keyOnly"] == raw, "「m=…」だけでも読める")
    check(cases["rawOnly"] == raw, "本体だけでも読める")
    check(cases["junk"] is None, "関係ない文字は読まない", cases["junk"])
    check(cases["empty"] is None, "空は読まない", cases["empty"])
    check(cases["nul"] is None, "null でも落ちない", cases["nul"])

    # ================= 受け取る側 =================
    section("3. 受け取る側：履歴の「受け取る」から貼り付け窓を開く")
    recv = br.new_context(viewport={"width": 390, "height": 844})
    pr = recv.new_page()
    errs_r = []
    pr.on("pageerror", lambda e: errs_r.append(str(e)))
    pr.goto(URL)
    pr.wait_for_timeout(700)
    pr.click("#tabPlayers")
    pr.wait_for_timeout(400)
    pr.click("#toggleSelfBtn")
    pr.wait_for_timeout(200)
    pr.fill("#newPlayerName", "いっちょ")
    pr.wait_for_timeout(150)
    pr.click("#addPlayerBtn")
    pr.wait_for_timeout(400)
    helpers.add_player(pr, "たいら")
    pr.wait_for_timeout(300)

    pr.click("#tabHistory")
    pr.wait_for_timeout(600)
    check(pr.is_visible("#importOpenBtn"), "履歴に「受け取る」がある")
    pr.click("#importOpenBtn")
    pr.wait_for_timeout(600)
    check(pr.is_visible("#screenImport"), "取り込みの画面が開く")
    check(pr.is_visible("#importPasteBox"), "リンクを貼る窓がある")
    head = pr.inner_text("#importTitle")
    check("受け取る" in head, "見出しが「記録を受け取る」", head)
    btns = pr.eval_on_selector_all("#importBody button",
                                   "e => e.map(x => x.textContent.trim())")
    print("   ボタン: " + str(btns))
    check(any(t == "取り込む" for t in btns), "「取り込む」ボタンがある", btns)
    check(any("写したものを入れる" in t for t in btns), "「写したものを入れる」がある", btns)
    pr.screenshot(path=os.path.join(SHOTS, "paste_box.png"), full_page=True)

    section("4. でたらめな文字は取り込まない")
    try_paste(pr, "こんにちは")
    msg = pr.inner_text("#importPasteMsg")
    print("   " + msg)
    check("リンクが見つかりません" in msg, "理由が出る", msg)
    check(pr.is_visible("#importPasteBox"), "貼り付け窓のまま（進まない）")
    n0 = pr.evaluate("() => STORE.listMatches().length")
    check(n0 == 0, "記録は増えていない", n0)

    section("5. 途中で切れたリンクは読めないと出る")
    try_paste(pr, link["url"][: len(link["url"]) - 200])
    msg2 = pr.inner_text("#importPasteMsg")
    print("   " + msg2)
    check("読めません" in msg2 or "リンクが見つかりません" in msg2, "理由が出る", msg2)
    check(pr.evaluate("() => STORE.listMatches().length") == 0, "記録は増えていない")

    section("6. 文章付きのリンクを貼ると取り込みの確認が出る")
    try_paste(pr, "9ボール たいら 対 いっちょ の記録です。開くと取り込めます。 " + link["url"])
    txt = pr.inner_text("#importBody")
    print("   " + txt.replace("\n", " / ")[:140])
    check("たいら" in txt and "いっちょ" in txt, "送られてきた名前が出る", txt[:120])
    check("9ボール" in txt, "種目が出る", txt[:80])
    rows = pr.eval_on_selector_all("#importBody .import-map", "e => e.length")
    check(rows == 2, "「この人は誰ですか」が2人ぶん出る", rows)

    section("7. 取り込むと履歴に入り、成績にも入る")
    pr.locator("#importBody button", has_text="この試合を取り込む").click()
    pr.wait_for_timeout(1400)
    check(not pr.is_visible("#screenImport"), "取り込みの画面が閉じる")
    check(pr.is_visible("#screenHistory"), "履歴に戻る")
    st = pr.evaluate("""() => {
      const t = STORE.listPlayers().find(x => x.name === 'たいら');
      const i = STORE.listPlayers().find(x => x.name === 'いっちょ');
      const m = STORE.listMatches()[0];
      return {n: STORE.listMatches().length,
              taira: STORE.playerStats(t.id).matches,
              iccho: STORE.playerStats(i.id).matches,
              scores: STORE.loadMatch(m.id).result.scores};
    }""")
    print("   " + str(st))
    check(st["n"] == 1, "記録が1件入る", st)
    check(st["taira"] == 1 and st["iccho"] == 1, "両方の成績に1試合入る", st)
    check(st["scores"] == link["scores"], "スコアが送った側と一致する", st["scores"])

    section("8. 同じものをもう一度貼ると警告が出る")
    open_paste(pr)
    try_paste(pr, raw)
    txt2 = pr.inner_text("#importBody")
    check("すでに記録にあります" in txt2, "二重になると出る", txt2[:120])
    sub = pr.inner_text("#importSub")
    check("もう持っています" in sub, "副題も知らせる", sub)
    pr.locator("#importBody button", has_text="取り込まない").click()
    pr.wait_for_timeout(800)
    check(pr.is_visible("#screenHistory"), "「取り込まない」で履歴に戻る")
    check(pr.evaluate("() => STORE.listMatches().length") == 1, "二重にはならない")

    section("9. リンクを踏んだ側には「このリンクを写す」が出る")
    pr.goto(URL + "#" + body)
    pr.wait_for_timeout(1500)
    check(pr.is_visible("#screenImport"), "リンクからも今までどおり開く")
    btns2 = pr.eval_on_selector_all("#importBody button",
                                    "e => e.map(x => x.textContent.trim())")
    check(any("このリンクを写す" in t for t in btns2), "「このリンクを写す」がある", btns2)
    note = pr.inner_text("#importBody")
    check("ホーム画面" in note and "受け取る" in note,
          "ホーム画面のアプリには入らないと知らせ、道筋を示す", note[-200:])
    pr.screenshot(path=os.path.join(SHOTS, "paste_recv_note.png"), full_page=True)

    section("10. JSエラー")
    check(not errs_r, "受け取る側でJSエラーなし", errs_r[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
