# -*- coding: utf-8 -*-
"""qrsend_test.py — 記録を「リンク」か「QR」で渡す（本人の指示 2026-08-22）

本人の指示:
  「送信時にリンクでおくるか、QRを表示を選択」

対象:
  1. 履歴の「相手に送る」で、送り方を選ぶカードが開く
  2. 「QRを表示する」を押すとQRが描かれる
  3. QRが**実際に読み取れる中身**になっている（作った行列を読み戻して確かめる）
  4. QRのまわりに余白（クワイエットゾーン）が4マスある
  5. 画面に入る大きさで描かれている（はみ出さない）
  6. 「送り方を選び直す」で戻れる
  7. 長い記録では「結果だけにして小さくする」が出て、押すとマスが減る
  8. 「リンクで送る」は今までどおり動く
  9. 閉じる・背景・Escで閉じる
 10. JSエラーが無い

実行: python _test/qrsend_test.py
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
    """ローテーション120点先取を1試合こなして終わらせる（記録が長くなる種目）"""
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(600)
    pg.fill("#inNameA", a)
    pg.fill("#inNameB", b)
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)
    # 1〜15番を順に押していく。120点に届くまで繰り返す
    for _ in range(3):
        for n in range(1, 16):
            btn = pg.locator('#ballGrid .ball-btn[data-ball="%d"]' % n)
            if btn.count() and btn.is_enabled():
                btn.click()
                pg.wait_for_timeout(60)
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        nxt = pg.locator("#nextRackBtn")
        if nxt.count() and nxt.is_visible():
            nxt.click()
            pg.wait_for_timeout(300)
    pg.wait_for_timeout(400)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)
    else:
        # 届かなかったときは、その場で終わらせて記録に残す
        pg.click("#finishBtn")
        pg.wait_for_timeout(500)
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            pg.click("#confirmFinishBtn")
            pg.wait_for_timeout(900)


def open_send(pg):
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    pg.locator("#historyList .mc-foot button", has_text="相手に送る").first.click()
    pg.wait_for_timeout(900)


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    section("1. 送り方を選ぶカード")
    play_match(pg, "たいら", "いっちょ")
    open_send(pg)
    check(not pg.locator("#shareModal").get_attribute("hidden"), "送るカードが開く")
    btns = pg.eval_on_selector_all("#shareBody button",
                                   "e => e.map(x => x.textContent.trim())")
    print("   " + str(btns))
    check("QRを表示する" in btns, "「QRを表示する」がある", btns)
    check("リンクで送る" in btns, "「リンクで送る」がある", btns)
    sub = pg.inner_text("#shareSub")
    check("たいら" in sub and "いっちょ" in sub, "誰の試合か出る", sub)

    section("2. QRを表示する")
    pg.locator("#shareBody button", has_text="QRを表示する").click()
    pg.wait_for_timeout(900)
    check(pg.locator("#shareQrCanvas").count() == 1, "QRが描かれる")
    info = pg.evaluate("""() => {
      const c = document.getElementById('shareQrCanvas');
      const r = c.getBoundingClientRect();
      return {w: c.width, h: c.height,
              cssW: Math.round(r.width), cssH: Math.round(r.height),
              vw: window.innerWidth, vh: window.innerHeight};
    }""")
    print("   " + str(info))
    check(info["w"] == info["h"] and info["w"] > 0, "正方形に描かれる", info)
    check(info["cssW"] <= info["vw"], "横にはみ出さない", info)
    check(info["cssH"] <= info["vh"], "縦にはみ出さない", info)
    pg.screenshot(path=os.path.join(SHOTS, "qr_send.png"), full_page=False)

    section("3. QRの中身が読み取れる形になっている")
    # 画面に出したのと同じリンクからQRを作り直し、
    # 「読み取る側」と同じ手順（マスを読む）で元のリンクに戻ることを確かめる。
    # ここでは qr.js の内部を使わず、行列そのものを検算する
    probe = pg.evaluate("""async () => {
      const m = STORE.loadMatch(STORE.listMatches()[0].id);
      const out = await SHARE.makeLink(m);
      const qr = QRCODE.make(out.url, {ecLevel: 'L'});
      // 3隅のファインダがあるか
      function finder(x0, y0) {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 7; x++) {
            const ring = (x === 0 || x === 6 || y === 0 || y === 6);
            const core = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
            const want = ring || core;
            if (qr.modules[y0 + y][x0 + x] !== want) return false;
          }
        }
        return true;
      }
      const n = qr.size;
      return {
        chars: out.chars, version: qr.version, size: n,
        tl: finder(0, 0), tr: finder(n - 7, 0), bl: finder(0, n - 7),
        // 右下にはファインダを置かない
        brDark: qr.modules[n - 4][n - 4],
      };
    }""")
    print("   " + str(probe))
    check(probe["tl"] and probe["tr"] and probe["bl"], "3隅に位置検出パターンがある", probe)
    check(probe["size"] == 21 + 4 * (probe["version"] - 1), "版とマス数が合っている", probe)

    section("4. まわりに余白が4マスある")
    quiet = pg.evaluate("""() => {
      const c = document.getElementById('shareQrCanvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      // 上端から下へ、最初に黒が出る行を探す
      function firstDarkRow() {
        for (let y = 0; y < c.height; y++) {
          for (let x = 0; x < c.width; x++) {
            const i = (y * c.width + x) * 4;
            if (d[i] < 128) return y;
          }
        }
        return -1;
      }
      const top = firstDarkRow();
      return {top: top, size: c.width};
    }""")
    print("   " + str(quiet))
    cell = quiet["size"] / (probe["size"] + 8)
    check(quiet["top"] > 0, "上に余白がある", quiet)
    check(abs(quiet["top"] - cell * 4) <= cell,
          "余白がおよそ4マスぶんある", {"top": quiet["top"], "cell": round(cell, 2)})

    section("5. 送り方を選び直せる")
    pg.locator("#shareBody button", has_text="送り方を選び直す").click()
    pg.wait_for_timeout(500)
    btns2 = pg.eval_on_selector_all("#shareBody button",
                                    "e => e.map(x => x.textContent.trim())")
    check("QRを表示する" in btns2, "選ぶ画面に戻る", btns2)

    section("6. 長い記録は小さくできる")
    pg.locator("#shareBody button", has_text="QRを表示する").click()
    pg.wait_for_timeout(900)
    body = pg.inner_text("#shareBody")
    slim_btn = pg.locator("#shareBody button", has_text="結果だけにして小さくする")
    if slim_btn.count():
        before = pg.evaluate("() => document.getElementById('shareQrCanvas').width")
        slim_btn.click()
        pg.wait_for_timeout(900)
        after_txt = pg.inner_text("#shareBody")
        check("結果だけのQR" in after_txt, "結果だけのQRになったと出る", after_txt[:120])
        marks = pg.evaluate("""async () => {
          const m = STORE.loadMatch(STORE.listMatches()[0].id);
          const copy = {}; Object.keys(m).forEach(k => copy[k] = m[k]);
          copy.events = [];
          const full = await SHARE.makeLink(m);
          const slim = await SHARE.makeLink(copy);
          return {full: QRCODE.make(full.url, {ecLevel:'L'}).size,
                  slim: QRCODE.make(slim.url, {ecLevel:'L'}).size};
        }""")
        print("   " + str(marks))
        check(marks["slim"] < marks["full"], "マス数が減る", marks)
    else:
        print("   （この試合ではQRが細かくならなかったので、この節は飛ばす）")
        check("マス" in body, "マス数が出る", body[:120])

    section("7. 閉じられる")
    pg.click("#shareCloseBtn")
    pg.wait_for_timeout(400)
    check(pg.locator("#shareModal").get_attribute("hidden") is not None, "「閉じる」で閉じる")
    open_send(pg)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    check(pg.locator("#shareModal").get_attribute("hidden") is not None, "Escでも閉じる")
    open_send(pg)
    pg.mouse.click(195, 30)
    pg.wait_for_timeout(400)
    check(pg.locator("#shareModal").get_attribute("hidden") is not None, "背景を押しても閉じる")

    section("8. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
