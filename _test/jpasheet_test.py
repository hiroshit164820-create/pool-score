# -*- coding: utf-8 -*-
"""jpasheet_test.py — JPAスコアシートの手直し（本人の指示 2026-08-22）

指示:
  1. ラックの区切り線に、何ラック目かが分かる札を出す
  2. ラックの終わりの斜線は、9番を入れた側にだけ付ける
     （両者に付くと、どちらが取ったのか読めない）
  3. 無効球もラックごとにいくつあったかシートに書く
  4. シートの中の「死球」を「無効球」に変える

進行中の試合（ui_sheet.js）と、終わった試合（ui_sheetview.js）の
両方で同じに見えることを確かめる。

実行: python _test/jpasheet_test.py
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


# シートの中の、印が付いたマスと文字を読む
SHEET_PROBE = """() => {
  const out = { a: [], b: [] };
  ['a','b'].forEach(sd => {
    const box = document.querySelector('.sheet-side.side-' + sd);
    if (!box) return;
    out[sd] = [...box.querySelectorAll('.sheet-cell')]
      .filter(c => c.classList.contains('rack-end') || c.classList.contains('rack-open'))
      .map(c => ({
        n: c.textContent.trim(),
        end: c.classList.contains('rack-end'),
        endLabel: c.getAttribute('data-rack-end'),
        open: c.classList.contains('rack-open'),
        openLabel: c.getAttribute('data-rack'),
      }));
  });
  const root = document.querySelector('.sheet-side')
      ? document.querySelector('.sheet-side').closest('div[id],section') : null;
  out.dead = document.querySelector('.sheet-dead')
      ? document.querySelector('.sheet-dead').innerText.replace(/\\n/g, ' ') : '';
  out.foot = document.querySelector('.sheet-foot')
      ? document.querySelector('.sheet-foot').innerText.replace(/\\n/g, ' ') : '';
  out.all = (root ? root.innerText : document.body.innerText);
  return out;
}"""

# 斜線が実際に描かれているか（背景の模様が入っているか）を見る。
# B側は塗りの指定と競合して消えたことがあるので、両側とも確かめる
STRIPE_PROBE = """() => {
  const out = {};
  ['a','b'].forEach(sd => {
    const c = document.querySelector('.sheet-side.side-' + sd + ' .sheet-cell.rack-end');
    out[sd] = c ? (getComputedStyle(c).backgroundImage || 'none') : '無し';
  });
  return out;
}"""


def rack_count(pg):
    return pg.evaluate("""() => {
      const m = STORE.findOngoing();
      const mm = m ? STORE.loadMatch(m.id) : null;
      return mm ? mm.events.filter(e => e.t === 'RACK_START').length : 0;
    }""")


def take_rack(pg, side, limit=14):
    """その側で押し続けてラックを1つ終わらせる"""
    start = rack_count(pg)
    for _ in range(limit):
        if rack_count(pg) > start:
            return True
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            return False
        pg.click("#panel" + side)
        pg.wait_for_timeout(110)
    return rack_count(pg) > start


errs = []

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 430, "height": 932})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept(""))
    pg.goto(URL)
    pg.wait_for_timeout(900)

    helpers.goto_setup(pg)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "いっちょ")
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)

    # ラック1は A が取る。途中で無効球を1つ入れる
    pg.click("#panelA")
    pg.wait_for_timeout(110)
    pg.click("#panelA")
    pg.wait_for_timeout(110)
    void_btn = pg.locator("#screenMatch button", has_text="無効球").first
    if void_btn.count():
        void_btn.click()
        pg.wait_for_timeout(250)
    check(take_rack(pg, "A"), "下ごしらえ: ラック1をAが取れた")
    # ラック2は B が取る
    check(take_rack(pg, "B"), "下ごしらえ: ラック2をBが取れた")

    sheet_btn = pg.locator("#screenMatch button", has_text="スコアシート").first
    check(sheet_btn.count() > 0, "下ごしらえ: スコアシートのボタンがある")
    sheet_btn.click()
    pg.wait_for_timeout(700)

    # ============ 進行中の試合 ============
    section("進行中の試合（試合画面のシート）")
    info = pg.evaluate(SHEET_PROBE)
    endsA = [c for c in info["a"] if c["end"]]
    endsB = [c for c in info["b"] if c["end"]]

    check(len(endsA) == 1, "2. ラック1を取ったA側に区切りが1つ付く", endsA)
    check(len(endsB) == 1, "2. ラック2を取ったB側に区切りが1つ付く", endsB)
    labelsA = set(c["endLabel"] for c in endsA)
    labelsB = set(c["endLabel"] for c in endsB)
    check(not (labelsA & labelsB),
          "2. 同じラックの区切りが両側には付かない", str(labelsA) + " / " + str(labelsB))
    check(labelsA == {"R1"}, "1. A側の区切りの札が R1", labelsA)
    check(labelsB == {"R2"}, "1. B側の区切りの札が R2", labelsB)

    stripe = pg.evaluate(STRIPE_PROBE)
    check("gradient" in stripe["a"], "2. A側の区切りに斜線が描かれる", stripe["a"])
    check("gradient" in stripe["b"], "2. B側の区切りにも斜線が描かれる", stripe["b"])

    check("R1" in info["dead"] and "1個" in info["dead"],
          "3. ラックごとの無効球が出る", info["dead"])
    check("死球" not in info["all"], "4. 「死球」と書かれていない")
    check("無効球" in info["all"], "4. 「無効球」と書かれている")

    # 札がマスに切られて読めなくなっていないこと（overflow:hidden に潰された件）
    vis = pg.evaluate("""() => {
      const c = document.querySelector('.sheet-cell.rack-end');
      if (!c) return null;
      return { overflow: getComputedStyle(c).overflow };
    }""")
    check(vis and vis["overflow"] != "hidden",
          "1. 区切りの札がマスに切られない", vis)

    # ============ 終わった試合 ============
    section("終わった試合（履歴から開くスコア表）")
    # シートは画面に重ねて開くので、閉じないと下のボタンが押せない
    close_btn = pg.locator(".sheet-bar .st-close").first
    if close_btn.count():
        close_btn.click()
        pg.wait_for_timeout(500)
    pg.click("#finishBtn")
    pg.wait_for_timeout(500)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)

    saved = pg.evaluate("""() => {
      const m = STORE.listMatches()[0];
      const s = STORE.sheetOf(m.id);
      return s ? { 区切り: s.series && s.series.A ? s.series.A.filter(x=>x.rackEnd).length : null,
                   無効球: s.rackDead, 合計無効球: s.deadBalls } : null;
    }""")
    check(saved is not None, "終わった試合のスコア表データが取れる", saved)
    check(saved and saved["無効球"] and saved["無効球"][0] > 0,
          "3. 終わった試合にもラックごとの無効球が残る", saved)

    pg.click("#tabHistory")
    pg.wait_for_timeout(800)
    view_btn = pg.locator("#historyList button", has_text="スコア表").first
    check(view_btn.count() > 0, "履歴に「スコア表」のボタンがある")
    view_btn.click()
    pg.wait_for_timeout(800)
    info2 = pg.evaluate(SHEET_PROBE)
    endsA2 = [c for c in info2["a"] if c["end"]]
    endsB2 = [c for c in info2["b"] if c["end"]]
    check(len(endsA2) == 1 and len(endsB2) == 1,
          "2. 終わった試合でも区切りは片側だけ", str(endsA2) + " / " + str(endsB2))
    check(all(c["endLabel"] for c in endsA2 + endsB2),
          "1. 終わった試合でも区切りに札が付く", [c["endLabel"] for c in endsA2 + endsB2])
    check("R1" in info2["dead"], "3. 終わった試合にもラックごとの無効球が出る", info2["dead"])
    check("死球" not in info2["all"], "4. 終わった試合でも「死球」と書かれていない")

    check(not errs, "JSエラーが出ない", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "-" * 50)
print("合計 %d件 / NG %d件" % (len(results), len(ng)))
sys.exit(1 if ng else 0)
