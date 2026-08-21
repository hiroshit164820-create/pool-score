# -*- coding: utf-8 -*-
"""qrscan_test.py — QRを写して取り込む（本人の指示 2026-08-22）

本人の指示:
  「受信側はQRを読み込むボタンを押せばカメラが起動する形をとれるようにしてください」

対象:
  1. 取り込み画面に「QRを読み取る」がある
  2. 押すとカメラの画面が開き、**実際にカメラを要求する**
  3. 偽の映像（QRを描いた動画）を見せると、**読み取って取り込みの確認まで進む**
  4. 取り込むと履歴と成績に入る
  5. 閉じるとカメラが止まる（つけっぱなしにしない）
  6. カメラを断られたときは、理由と次にすることが日本語で出る
  7. カメラが無い端末でも「写真から読み取る」の道が出る
  8. 試合の記録でないQRを見せても取り込まない
  9. JSエラーが無い

実行: python _test/qrscan_test.py
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
    helpers.goto_setup(pg)
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
        pg.wait_for_timeout(200)
    pg.wait_for_timeout(400)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)


# QRを描いた canvas を「カメラの映像」に見せかける仕掛け。
# getUserMedia を差し替えて canvas.captureStream() を返す。
# 本物のカメラは検証用のブラウザに無いので、こうするしかない。
FAKE_CAMERA = """(text) => {
  const qr = QRCODE.make(text, {ecLevel: 'L'});
  const QUIET = 4, total = qr.size + QUIET * 2;
  // 1マス8pxで描く。実機のカメラより条件は良いが、
  // 読み取りの筋道（映像 → canvas → 復号）は同じものを通る
  const cell = 8, px = cell * total;
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.modules[y][x]) ctx.fillRect((x+QUIET)*cell, (y+QUIET)*cell, cell, cell);
  // captureStream は動きが無いとフレームを出さないので、少しずつ描き直す
  const stream = c.captureStream(10);
  window.__fakeTimer = setInterval(function () {
    ctx.fillStyle = 'rgba(255,255,255,0.004)';
    ctx.fillRect(0, 0, 1, 1);
  }, 60);
  window.__fakeStream = stream;
  navigator.mediaDevices.getUserMedia = function () {
    return Promise.resolve(stream);
  };
  return {size: qr.size, version: qr.version};
}"""

DENY_CAMERA = """() => {
  navigator.mediaDevices.getUserMedia = function () {
    const e = new Error('denied');
    e.name = 'NotAllowedError';
    return Promise.reject(e);
  };
}"""

NO_CAMERA = """() => {
  navigator.mediaDevices.getUserMedia = function () {
    const e = new Error('none');
    e.name = 'NotFoundError';
    return Promise.reject(e);
  };
}"""


def open_import(pg):
    pg.click("#tabHome")
    pg.wait_for_timeout(500)
    pg.locator("#homeBody button", has_text="試合結果を取り込む").click()
    pg.wait_for_timeout(600)


with sync_playwright() as p:
    br = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])

    # ================= 送る側でリンクを作る =================
    section("1. 送る側で1試合こなす")
    send = br.new_context(viewport={"width": 390, "height": 844})
    ps = send.new_page()
    ps.goto(URL)
    ps.wait_for_timeout(700)
    play_match(ps, "たいら", "いっちょ")
    link = ps.evaluate("""async () => {
      const m = STORE.loadMatch(STORE.listMatches()[0].id);
      const out = await SHARE.makeLink(m, 'file:///x/index.html');
      return {url: out.url, chars: out.chars, scores: m.result.scores};
    }""")
    print("   リンク %d文字" % link["chars"])
    check(link["chars"] > 0, "リンクが作れる", link["chars"])

    # ================= 受け取る側 =================
    section("2. 取り込み画面に「QRを読み取る」がある")
    recv = br.new_context(viewport={"width": 390, "height": 844})
    pr = recv.new_page()
    errs = []
    pr.on("pageerror", lambda e: errs.append(str(e)))
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

    open_import(pr)
    check(pr.is_visible("#screenImport"), "取り込みの画面が開く")
    btns = pr.eval_on_selector_all("#importBody button",
                                   "e => e.map(x => x.textContent.trim())")
    print("   " + str(btns))
    check("QRを読み取る" in btns, "「QRを読み取る」がある", btns)

    section("3. カメラを断られたとき")
    pr.evaluate(DENY_CAMERA)
    pr.locator("#importBody button", has_text="QRを読み取る").click()
    pr.wait_for_timeout(900)
    check(pr.locator("#qrScanModal").get_attribute("hidden") is None, "読み取りの画面が開く")
    msg = pr.inner_text("#scanMsg")
    print("   " + msg)
    check("許可" in msg, "許可されていないと分かる言い方", msg)
    check("写真から読み取る" in msg or pr.is_visible("#scanFileLabel"),
          "次にできること（写真から読み取る）が出ている", msg)
    pr.click("#scanCloseBtn")
    pr.wait_for_timeout(400)
    check(pr.locator("#qrScanModal").get_attribute("hidden") is not None, "「やめる」で閉じる")

    section("4. カメラが無いとき")
    pr.evaluate(NO_CAMERA)
    open_import(pr)
    pr.locator("#importBody button", has_text="QRを読み取る").click()
    pr.wait_for_timeout(900)
    msg2 = pr.inner_text("#scanMsg")
    print("   " + msg2)
    check("見つかりません" in msg2, "カメラが無いと分かる言い方", msg2)
    pr.click("#scanCloseBtn")
    pr.wait_for_timeout(400)

    section("5. QRを写すと取り込みの確認まで進む")
    info = pr.evaluate(FAKE_CAMERA, link["url"])
    print("   QRは版%d・%dマス" % (info["version"], info["size"]))
    open_import(pr)
    pr.locator("#importBody button", has_text="QRを読み取る").click()
    # 読み取りは実測7ミリ秒だが、映像が出るまでの間があるので余裕を見る
    pr.wait_for_timeout(3500)
    pr.screenshot(path=os.path.join(SHOTS, "qr_scan.png"), full_page=False)
    check(pr.locator("#qrScanModal").get_attribute("hidden") is not None,
          "読み取れたらカメラの画面が閉じる")
    txt = pr.inner_text("#importBody")
    print("   " + txt.replace("\n", " / ")[:120])
    check("たいら" in txt and "いっちょ" in txt, "送られてきた名前が出る", txt[:120])
    rows = pr.eval_on_selector_all("#importBody .import-map", "e => e.length")
    check(rows == 2, "「この人は誰ですか」が2人ぶん出る", rows)

    section("6. カメラが止まっている")
    live = pr.evaluate("""() => {
      const s = window.__fakeStream;
      if (!s) return null;
      return s.getTracks().map(t => t.readyState);
    }""")
    print("   " + str(live))
    check(live and all(x == "ended" for x in live),
          "映像が止まっている（つけっぱなしにしない）", live)

    section("7. 取り込むと履歴と成績に入る")
    pr.locator("#importBody button", has_text="この試合を取り込む").click()
    pr.wait_for_timeout(1400)
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

    section("8. 試合の記録でないQRは取り込まない")
    pr.evaluate("() => { if (window.__fakeTimer) clearInterval(window.__fakeTimer); }")
    pr.evaluate(FAKE_CAMERA, "https://example.com/ただのページ")
    open_import(pr)
    pr.locator("#importBody button", has_text="QRを読み取る").click()
    pr.wait_for_timeout(3000)
    msg3 = pr.inner_text("#scanMsg")
    print("   " + msg3)
    check("試合の記録ではありません" in msg3, "違うQRだと知らせる", msg3)
    check(pr.evaluate("() => STORE.listMatches().length") == 1, "記録は増えない")
    pr.click("#scanCloseBtn")
    pr.wait_for_timeout(400)

    section("9. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
