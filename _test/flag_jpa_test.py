# -*- coding: utf-8 -*-
"""flag_jpa_test.py — 球単位の種目のマスワリ・ブレイクエースの数え方

本人の指示（2026-08-22。2026-08-21の指示を差し替える）:
  「エースを押すとマスワリも増えるので切り離してください。別物です」
  「マスワリもエースも押してもスコアボードの点数が増えないようにしてください。
    カウントを記録するのみのボタンとします」

2026-08-21 は「押したら9番ぶんの点も入る」形にしていた（下の履歴）。
本人の 08-22 の指示で、JPAでは**回数だけ**を数える形に変えた。

  旧: 押すと POCKET が積まれ、スコアが 2点／10点 増えていた
  新: MARK（回数だけの記録）を積む。点・盤面・ラックは動かさない

対象:
  1. JPA 9ボールでブレイクエースを押すと、回数が1増える
  2. そのときスコアは増えない（0点のまま）／球の記録も積まない
  3. ブレイクエースを押してもマスワリは増えない（別物）
  4. JPA 9ボールでマスワリを押すと、回数が1増える。スコアは増えない
  5. マスワリを押してもブレイクエースは増えない
  6. 記録が保存され、読み直しても残る
  7. ラック単位の種目（9ボール）は今までどおり（1ラックぶん＝1点）

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
    check(after["scoreA"] == "0", "点は増えない（カウントのみ）", after["scoreA"])
    check(n_of(after, "A", "マスワリ") == 0,
          "エースを押してもマスワリは増えない（別物）", after["A"])
    check(not after["pockets"], "球の記録（POCKET）は積まない", after["pockets"])
    check(after["lastEvent"] and after["lastEvent"]["t"] == "MARK",
          "回数だけの記録（MARK）になっている", after["lastEvent"])

    section("2. 記録に残る（成績にも出る）")
    saved = pg.evaluate("""() => {
      const m = STORE.findOngoing();
      return {events: m.events.length,
              marks: m.events.filter(e => e.t === 'MARK').length};
    }""")
    check(saved["marks"] == 1, "記録が1件保存されている", saved)

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
    check(m2["scoreA"] == "0", "点は増えない（カウントのみ）", m2["scoreA"])
    check(n_of(m2, "A", "ブレイクエース") == 0,
          "マスワリを押してもエースは増えない（別物）", m2["A"])
    check(not m2["pockets"], "球の記録（POCKET）は積まない", m2["pockets"])

    # ラックも進まない（点の記録ではないため）
    rack = pg2.inner_text("#rackInfo")
    check("1" in rack, "ラックも進まない", rack)

    section("4. 読み直しても残る")
    pg2.reload()
    pg2.wait_for_timeout(900)
    resumed = pg2.evaluate("() => !!STORE.findOngoing()")
    check(resumed, "試合が残っている", resumed)
    kept = pg2.evaluate("""() => {
      const m = STORE.findOngoing();
      return m.events.filter(e => e.t === 'MARK' && e.d && e.d.masuwari).length;
    }""")
    check(kept == 1, "マスワリの記録が残っている", kept)

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
    check(n_of(n9, "A", "マスワリ") == 0,
          "9ボールでもエースとマスワリは切り離されている", n9["A"])

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
