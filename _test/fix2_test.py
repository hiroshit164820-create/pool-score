# -*- coding: utf-8 -*-
"""fix2_test.py — 本人の指摘2件（2026-08-21）

  画像1: 履歴で名前が長いと「W-L」の札に重なる
  画像2: ホーム／種目の中断中カードの「×」が横いっぱいに伸びている

実行: python _test/fix2_test.py
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

LONG_A = "フーチーウェイ"
LONG_B = "ジュリアンサンチェス"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ---- 長い名前で1試合、決着まで ----
    section("長い名前の試合を作る")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    for n in [LONG_A, LONG_B]:
        helpers.add_player(pg, n)
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    pg.fill("#inNameA", LONG_A)
    pg.fill("#inNameB", LONG_B)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    for _ in range(30):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        if pg.eval_on_selector("#panelB", "e => e.disabled"):
            break
        pg.click("#panelB")
        pg.wait_for_timeout(110)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)
    check(pg.evaluate("() => STORE.listMatches().filter(m => m.finished).length") == 1,
          "試合が1つできた")

    # ================= 画像1: 名前とW-Lが重ならない =================
    section("画像1: 履歴で名前がW-Lに重ならない")
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    over = pg.evaluate("""() => {
      const out = [];
      document.querySelectorAll('.match-card .mc-main').forEach(row => {
        const names = row.querySelectorAll('.mc-nm');
        const score = row.querySelector('.mc-score');
        if (!score || !names.length) return;
        const s = score.getBoundingClientRect();
        names.forEach(n => {
          const r = n.getBoundingClientRect();
          // 名前の欄とスコアの欄が横で重なっていないか
          if (r.right > s.left + 0.5 && r.left < s.right - 0.5) {
            out.push({name: n.textContent, nameRight: Math.round(r.right),
                      scoreLeft: Math.round(s.left)});
          }
        });
      });
      return out;
    }""")
    check(not over, "名前の欄とスコアの欄が重ならない", over)

    inner = pg.evaluate("""() => {
      const out = [];
      document.querySelectorAll('.match-card .mc-nm').forEach(n => {
        const sp = n.querySelector('span');
        if (!sp) return;
        const r = sp.getBoundingClientRect(), nr = n.getBoundingClientRect();
        // 中の文字が枠からはみ出していないか（はみ出すと札に被って見える）
        if (r.right > nr.right + 1 || r.left < nr.left - 1) {
          out.push(sp.textContent);
        }
      });
      return out;
    }""")
    check(not inner, "名前の文字が欄からはみ出さない", inner)

    cut = pg.evaluate("""() => [...document.querySelectorAll('.match-card .mc-nm > span:first-child')]
      .map(e => ({t: e.textContent, ell: getComputedStyle(e).textOverflow}))""")
    check(all(x["ell"] == "ellipsis" for x in cut) if cut else True,
          "長い名前は「…」で切る指定になっている", cut)
    check(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"),
          "横スクロールが出ない")
    pg.screenshot(path=os.path.join(SHOTS, "fix2_history.png"))

    # W-Lの札そのものが読めること
    wl = pg.eval_on_selector_all(".match-card .mc-score .mc-wl",
                                 "e => e.map(x => x.textContent)")
    check("W" in wl and "L" in wl, "W と L が出ている", wl)

    # ================= 画像2: ×が44px角 =================
    section("画像2: 中断中カードの×")
    # 中断中の試合を作る（決着させずにホームへ戻る）
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    pg.fill("#inNameA", LONG_A)
    pg.fill("#inNameB", LONG_B)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(700)

    pg.click("#tabHome")
    pg.wait_for_timeout(700)
    close = pg.locator(".home-card.resume .hc-close")
    check(close.count() == 1, "ホームに×がある", close.count())
    box = close.bounding_box()
    check(box and 40 <= box["width"] <= 56, "×の幅が44px前後（横いっぱいでない）", box)
    check(box and 40 <= box["height"] <= 56, "×の高さも44px前後", box)
    card = pg.locator(".home-card.resume").bounding_box()
    check(box and card and box["width"] < card["width"] * 0.5,
          "カード幅の半分より小さい", (box, card))
    # 右上にあること
    check(box and card and (card["x"] + card["width"] - (box["x"] + box["width"])) < 20,
          "カードの右端に寄っている", (box, card))
    check(box and card and (box["y"] - card["y"]) < 20, "カードの上端に寄っている", (box, card))
    # 見出しが札の下に隠れていないこと
    # 見出しの箱はカード幅いっぱいだが、右に余白（padding-right）を取って
    # 文字が×の下に入らないようにしてある。文字の右端で見る
    tEnd = pg.evaluate("""() => {
      const t = document.querySelector('.home-card.resume .hc-title');
      if (!t) return null;
      const r = document.createRange(); r.selectNodeContents(t);
      return Math.round(r.getBoundingClientRect().right);
    }""")
    check(tEnd is not None and box and tEnd <= box["x"] + 1,
          "見出しの文字が×に重ならない", (tEnd, box))
    # カードの中の文字が、どれも×の四角に食い込んでいないこと
    # （名前が長いと2行になり、2行目が×に潜り込んでいた）
    bite = pg.evaluate("""() => {
      const card = document.querySelector('.home-card.resume');
      const btn = card.querySelector('.hc-close').getBoundingClientRect();
      const out = [];
      card.querySelectorAll('.hc-title, .hc-main, .hc-sub').forEach(el => {
        const r = document.createRange(); r.selectNodeContents(el);
        [...r.getClientRects()].forEach(x => {
          if (x.right > btn.left + 1 && x.left < btn.right - 1
              && x.bottom > btn.top + 1 && x.top < btn.bottom - 1) {
            out.push(el.className + ':' + el.textContent.slice(0, 12));
          }
        });
      });
      return out;
    }""")
    check(not bite, "カードの文字が×に食い込まない", bite)
    pg.screenshot(path=os.path.join(SHOTS, "fix2_home.png"))

    # 種目ページの×も同じ
    section("種目ページの×")
    pg.click("#tabSetup")
    pg.wait_for_timeout(700)
    rc = pg.locator(".resume-card .rc-close")
    if rc.count():
        rbox = rc.first.bounding_box()
        check(rbox and 40 <= rbox["width"] <= 56, "種目ページの×も44px前後", rbox)
    else:
        check(True, "種目ページに中断中カードは出ていない（この画面では確認しない）")

    # ×で閉じられること
    pg.click("#tabHome")
    pg.wait_for_timeout(600)
    pg.locator(".home-card.resume .hc-close").click()
    pg.wait_for_timeout(700)
    check(pg.locator(".home-card.resume").count() == 0, "×で閉じられる")

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
