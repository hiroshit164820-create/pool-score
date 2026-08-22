# -*- coding: utf-8 -*-
"""tune10_test.py — 履歴の複数選択・ボタンの文字切れ・成績2項目（本人の指示 2026-08-22）

指示:
  1. 履歴の「選ぶ」だけでは何のことか分からないので「複数選択」に変える
  2. 複数選択しても、まとめて送る・まとめてメモ・まとめて削除のやり方が分からない
     → 操作の帯が下のタブバーの裏に隠れて、3つのボタンが見えていなかった
  3. 「相手に送る」「メモを追加」の文字がボタンの途中で切れる
  4. 14-1 のくわしい成績に「平均得点（1イニングあたり）」を足す
  5. 5-9 のくわしい成績に「1ラック内最大得点」を足す

実行: python _test/tune10_test.py
"""
import sys, io, os, re
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


SEED_SELF = """() => {
  const p = STORE.upsertPlayer('たいら');
  const id = (p && p.id) ? p.id : p;
  STORE.setSelf(id);
  return id;
}"""

# ボタンの中の文字が枠に収まっているか。
# button は中身がはみ出しても scrollWidth が伸びないので、
# 文字そのものの幅を Range で測って中身の幅と比べる
CUT_PROBE = """() => {
  const bad = [];
  document.querySelectorAll('#historyList .mc-foot button').forEach(b => {
    const r = document.createRange();
    r.selectNodeContents(b);
    const textW = r.getBoundingClientRect().width;
    const cs = getComputedStyle(b);
    const inner = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (textW > inner + 0.5) {
      bad.push((b.textContent || '').trim()
        + ' 文字' + Math.round(textW) + ' > 枠' + Math.round(inner));
    }
  });
  return bad;
}"""

# 操作の帯が下のタブバーに隠れていないか
BULK_PROBE = """() => {
  const bar = document.getElementById('bulkBar');
  const tab = document.querySelector('.tab-bar');
  const send = document.getElementById('bulkSendBtn');
  if (!bar || !tab || !send) return null;
  const r = bar.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  const s = send.getBoundingClientRect();
  return {
    hidden: bar.hidden,
    かぶり: Math.round(r.bottom - t.top),
    ボタン下端: Math.round(s.bottom),
    タブ上端: Math.round(t.top),
  };
}"""


def play_9ball(pg, a, b):
    """9ボール2先を1試合こなして終わらせる"""
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(400)
    pg.fill("#inNameA", a)
    pg.fill("#inNameB", b)
    pg.wait_for_timeout(150)
    helpers.set_goal(pg, 2)
    pg.wait_for_timeout(150)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)
    for _ in range(10):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        pg.click("#panelA")
        pg.wait_for_timeout(160)
    pg.wait_for_timeout(250)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)


def open_my_detail(pg):
    """成績→「種目別でさらに詳しく」を開いて中身の文字を返す"""
    pg.click("#tabStats")
    pg.wait_for_timeout(800)
    pg.locator(".detail-card > summary").first.click()
    pg.wait_for_timeout(500)
    pg.evaluate("""() => {
      document.querySelectorAll('.detail-card details').forEach(d => { d.open = true; });
    }""")
    pg.wait_for_timeout(300)
    return pg.inner_text(".detail-card")


def near(txt, word):
    m = re.search(word + r"[^\n]*\n?[^\n]*", txt)
    return m.group(0).replace("\n", " / ") if m else "(見つからず)"


errs = []

with sync_playwright() as p:
    br = p.chromium.launch()

    # ============ 1〜3. 履歴の画面（幅を変えて確かめる） ============
    section("1〜3. 履歴の複数選択とボタンの文字")
    for w in [320, 375, 430]:
        pg = br.new_page(viewport={"width": w, "height": 844})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL)
        pg.wait_for_timeout(800)
        play_9ball(pg, "たいら", "いっちょ")
        pg.click("#tabHistory")
        pg.wait_for_timeout(800)

        if w == 430:
            label = pg.inner_text("#histSelectBtn").strip()
            check(label == "複数選択", "1. ボタンが「複数選択」", label)

        check(not pg.evaluate(CUT_PROBE),
              "3. %dpx で履歴カードのボタンの文字が切れない" % w,
              pg.evaluate(CUT_PROBE))

        pg.click("#histSelectBtn")
        pg.wait_for_timeout(500)
        if w == 430:
            label = pg.inner_text("#histSelectBtn").strip()
            check(label == "複数選択をやめる", "1. 押すと「複数選択をやめる」", label)

        bb = pg.evaluate(BULK_PROBE)
        check(bb and bb["かぶり"] <= 0 and bb["ボタン下端"] <= bb["タブ上端"],
              "2. %dpx でまとめて操作するボタンがタブバーに隠れない" % w, bb)
        pg.close()

    # ============ 4. 14-1 の平均得点 ============
    section("4. 14-1 の平均得点（1イニングあたり）")
    pg = br.new_page(viewport={"width": 390, "height": 844})
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("dialog", lambda d: d.accept(""))
    pg.goto(URL)
    pg.wait_for_timeout(800)
    pg.evaluate(SEED_SELF)
    pg.wait_for_timeout(300)

    helpers.goto_setup(pg)
    helpers.pick_game(pg, "straight")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.locator("#goalArea .chip", has_text="50点先取").first.click()
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(700)
    # 14-1 は球の一覧ではなく、自分のスコアを押して1点ずつ入れる。
    # 途中で手番を渡し、イニングが1より大きい状態を作る
    for i in range(60):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        if i in (12, 26, 40):
            pg.click("#turnBtn")
            pg.wait_for_timeout(200)
            pg.click("#turnBtn")
            pg.wait_for_timeout(200)
        pg.click("#panelA")
        pg.wait_for_timeout(60)
    pg.wait_for_timeout(400)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(900)

    agg = pg.evaluate("""() => {
      const d = STORE.gameDetail(STORE.getSelfId());
      const g = d && d.byGame && d.byGame['straight'];
      return g ? { 得点: g.inningScore, イニング: g.innings } : null;
    }""")
    check(agg and agg["得点"] > 0 and agg["イニング"] > 0,
          "4. 得点とイニングの両方が集計に入る", agg)
    # 「数えない」を選んだ試合の得点まで分子に足すと平均が膨らむので、
    # 分子と分母が同じ試合ぶんで揃っていることを確かめる
    check(agg and agg["得点"] == 50, "4. 分子は自分の得点そのもの（50点）", agg)

    txt = open_my_detail(pg)
    check("平均得点" in txt, "4. 成績に「平均得点」が出る")
    check("（1イニングあたり）" in txt.replace("\n", ""), "4. 条件が「1イニングあたり」")
    print("   表示:", near(txt, "平均得点"))

    # ============ 5. 5-9 の1ラック内最大得点 ============
    section("5. 5-9 の1ラック内最大得点")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.open_group(pg, "house")
    pg.wait_for_timeout(300)
    pg.click('.game-pick:has(.gp-name:text-is("5-9"))')
    pg.wait_for_timeout(600)
    for i, nm in enumerate(["たいら", "いっちょ"]):
        pg.locator(".money-name").nth(i).fill(nm)
        pg.wait_for_timeout(120)
    pg.click("#moneyStartBtn")
    pg.wait_for_timeout(600)
    # ラック1で+2、ラックを終えて、ラック2で+1。合計3点だが1ラック最大は2点
    pg.click('.money-pick:text-is("たいら")')
    pg.wait_for_timeout(200)
    pg.click('#moneyPlus button[data-pts="2"]')
    pg.wait_for_timeout(250)
    pg.click("#moneyRackBtn")
    pg.wait_for_timeout(400)
    pg.click('.money-pick:text-is("たいら")')
    pg.wait_for_timeout(200)
    pg.click('#moneyPlus button[data-pts="1"]')
    pg.wait_for_timeout(250)
    pg.click("#moneyQuitBtn")
    pg.wait_for_timeout(900)

    saved = pg.evaluate("""() => {
      const r = STORE.listMoneyResults()[0];
      const me = r.players.find(x => x.name === 'たいら');
      return { 合計: me.score, ラック最大: me.maxRackScore };
    }""")
    check(saved["合計"] == 3, "5. 試合の合計は3点", saved)
    check(saved["ラック最大"] == 2,
          "5. 1ラック内の最大は2点（合計とは別に持つ）", saved)

    txt = open_my_detail(pg)
    check("1ラック内最大得点" in txt, "5. 成績に「1ラック内最大得点」が出る")
    check("2点" in near(txt, "1ラック内最大得点"),
          "5. 値が2点と出る", near(txt, "1ラック内最大得点"))
    print("   表示:", near(txt, "1ラック内最大得点"))

    # 古い記録（この項目を持たない試合）は「記録なし」と断る
    pg.evaluate("""() => {
      localStorage.clear();
      const p = STORE.upsertPlayer('たいら');
      STORE.setSelf((p && p.id) ? p.id : p);
      STORE.saveMoneyResult({gameId:'59', gameLabel:'5-9', racks:1,
        players:[{name:'たいら', score:1, handicapBalls:[], masuwari:0, breakAce:0}]});
    }""")
    pg.reload()
    pg.wait_for_timeout(900)
    txt = open_my_detail(pg)
    check("記録なし" in near(txt, "1ラック内最大得点"),
          "5. 古い記録は「記録なし」と断る", near(txt, "1ラック内最大得点"))

    check(not errs, "JSエラーが出ない", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "-" * 50)
print("合計 %d件 / NG %d件" % (len(results), len(ng)))
sys.exit(1 if ng else 0)
