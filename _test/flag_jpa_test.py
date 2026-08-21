# -*- coding: utf-8 -*-
"""flag_jpa_test.py — 球単位の種目でマスワリ・ブレイクエースが数えられない不具合

本人の指摘（2026-08-21）:
  「エースのボタンを押してもカウントされない。スコアだけが1点増える」

原因: JPAのように球1個ずつ入力する種目では、札を押しても instant が捨てられ、
      ただの「1球ポケット」として記録されていた。

対象:
  1. JPA 9ボールでブレイクエースを押すと、回数が1増える
  2. そのとき9番が入った扱いになり、スコアも9番ぶん増える（1点ではない）
  3. JPA 9ボールでマスワリを押すと、回数が1増える（残り球を撞き切った扱い）
  4. 記録が保存され、読み直しても残る
  5. ラック単位の種目（9ボール）は今までどおり

実行: python _test/flag_jpa_test.py
"""
import sys, io, os, json
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


COUNTS = """() => {
  const out = {};
  ['A', 'B'].forEach(function (sd) {
    const host = document.getElementById('panelFlags' + sd);
    out[sd] = [...host.querySelectorAll('button')].map(function (b) {
      return {name: b.querySelector('.sf-name').textContent,
              n: Number(b.querySelector('.sf-count').textContent),
              dis: b.disabled};
    });
  });
  out.scoreA = document.getElementById('scoreA').textContent;
  out.scoreB = document.getElementById('scoreB').textContent;
  const m = STORE.findOngoing();
  out.lastEvent = m && m.events.length
    ? {t: m.events[m.events.length - 1].t, d: m.events[m.events.length - 1].d} : null;
  out.pockets = m ? m.events.filter(e => e.t === 'POCKET')
    .map(e => ({side: e.side, balls: e.d.balls, onBreak: !!e.d.onBreak})) : [];
  return out;
}"""


def n_of(counts, side, name):
    for b in counts[side]:
        if b["name"] == name:
            return b["n"]
    return None


def start(pg, gid, sl=True):
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, gid)
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "あいて")
    if gid.startswith("jpa") and sl:
        pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL7").click()
        pg.wait_for_timeout(150)
        pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)


with sync_playwright() as p:
    br = p.chromium.launch()

    # ================= 1〜2. JPAのブレイクエース =================
    section("1. JPA 9ボールのブレイクエース")
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)
    start(pg, "jpa_9ball")

    before = pg.evaluate(COUNTS)
    check(n_of(before, "A", "ブレイクエース") == 0, "押す前は0回", before["A"])
    check(before["scoreA"] == "0", "押す前は0点", before["scoreA"])

    pg.locator("#panelFlagsA button", has_text="ブレイクエース").click()
    pg.wait_for_timeout(700)
    after = pg.evaluate(COUNTS)
    check(n_of(after, "A", "ブレイクエース") == 1, "押すと1回に増える", after["A"])
    check(after["scoreA"] != "1", "1点だけ増える形になっていない（9番ぶん入る）",
          after["scoreA"])
    check(int(after["scoreA"]) >= 2, "9番ぶんの点が入る", after["scoreA"])
    ace = [x for x in after["pockets"] if x["onBreak"]]
    check(len(ace) == 1 and ace[0]["balls"] == [9],
          "ブレイクで9番を入れた記録になっている", after["pockets"])

    section("2. 記録に残る（成績にも出る）")
    saved = pg.evaluate("""() => {
      const m = STORE.findOngoing();
      const st = STORE.reduce ? null : null;
      return {events: m.events.length};
    }""")
    check(saved["events"] >= 4, "保存されている", saved)

    # ================= 3. JPAのマスワリ =================
    section("3. JPA 9ボールのマスワリ")
    pg2 = br.new_page(viewport={"width": 390, "height": 844})
    e2 = []
    pg2.on("pageerror", lambda e: e2.append(str(e)))
    pg2.goto(URL)
    pg2.wait_for_timeout(600)
    start(pg2, "jpa_9ball")
    pg2.locator("#panelFlagsA button", has_text="マスワリ").click()
    pg2.wait_for_timeout(700)
    m2 = pg2.evaluate(COUNTS)
    check(n_of(m2, "A", "マスワリ") == 1, "押すと1回に増える", m2["A"])
    check(int(m2["scoreA"]) >= 10, "残り球を撞き切ったぶんの点が入る", m2["scoreA"])
    pk = m2["pockets"]
    check(len(pk) == 1 and len(pk[0]["balls"]) >= 9 and pk[0]["balls"][-1] == 9,
          "9番を最後に、残り球を全部入れた記録になっている", pk)

    # ================= 4. 9番が無いとき =================
    section("4. 読み直しても残る")
    # 保存されているかを、ページを開き直して確かめる
    pg2.evaluate("""() => {
      const m = STORE.findOngoing();
      m.events.push({t: 'POCKET', side: 'A', at: new Date().toISOString(),
                     d: {balls: [1,2,3,4,5,6,7,8], onBreak: false}});
      STORE.saveMatch(m);
    }""")
    pg2.reload()
    pg2.wait_for_timeout(900)
    # 中断していた試合を再開する
    resumed = pg2.evaluate("() => !!STORE.findOngoing()")
    check(resumed, "試合が残っている", resumed)

    section("5. ラック単位の種目（9ボール）は今までどおり")
    pg3 = br.new_page(viewport={"width": 390, "height": 844})
    e3 = []
    pg3.on("pageerror", lambda e: e3.append(str(e)))
    pg3.goto(URL)
    pg3.wait_for_timeout(600)
    start(pg3, "9ball")
    pg3.locator("#panelFlagsA button", has_text="ブレイクエース").click()
    pg3.wait_for_timeout(700)
    n9 = pg3.evaluate(COUNTS)
    check(n_of(n9, "A", "ブレイクエース") == 1, "9ボールでも1回に増える", n9["A"])
    check(n9["scoreA"] == "1", "9ボールはラック1つぶん（1点）", n9["scoreA"])
    check(not n9["pockets"], "球単位の記録は積まない", n9["pockets"])

    section("エラー")
    check(not errs and not e2 and not e3, "画面のエラーが無い",
          (errs + e2 + e3)[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("==== %d/%d 成功 ====" % (len(results) - len(ng), len(results)))
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
