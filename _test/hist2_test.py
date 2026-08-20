# -*- coding: utf-8 -*-
"""hist2_test.py — 履歴ページの作り直し（本人の指示 2026-08-21・F）

対象:
  1. 「直近10件 / 50件 / 100件」を選べる（既定は10件）
  2. 選んだ件数より多いぶんはページ切り替えで見られる
  3. 1ページに収まるときはページ送りを出さない
  4. ダブルスの履歴はプレーヤー名を2段で表示する
  5. スキルレベルの札は名前の横ではなく、下の段（JPAポイントの横）に出る
  6. 名前が「1文字だけ」まで潰れない
  7. 押せる大きさ（44px）を守る

実行: python _test/hist2_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOTS, exist_ok=True)

PORT = {"width": 390, "height": 844}

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def finish_by(pg, side):
    for _ in range(40):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        if pg.eval_on_selector("#panel" + side, "e => e.disabled"):
            break
        pg.click("#panel" + side)
        pg.wait_for_timeout(110)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport=PORT)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ---- 下ごしらえ: 12件ぶんの記録を作る（10件を超えさせる） ----
    section("下ごしらえ")
    made = pg.evaluate("""() => {
      const me = STORE.upsertPlayer('たいら');
      STORE.setSelf(me.id);
      STORE.upsertPlayer('ながいなまえのあいて', null, {cls: 'A'});
      for (let i = 0; i < 12; i++) {
        const m = {
          id: 'test_' + i,
          gameId: '9ball',
          sides: [{name: 'たいら', playerIds: [me.id]},
                  {name: 'ながいなまえのあいて',
                   playerIds: [STORE.findPlayerByName('ながいなまえのあいて').id]}],
          createdAt: new Date(2026, 7, 1 + i, 12, 0, 0).toISOString(),
          events: [],
          goal: {type: 'race', targets: {A: 3, B: 3}},
          finished: true,
          result: {winner: 'A', scores: {A: 3, B: 1}, racks: {A: 3, B: 1},
                   inningsPlayed: 5, perSide: {A: {}, B: {}}},
        };
        STORE.saveMatch(m);
      }
      return STORE.listMatches().length;
    }""")
    check(made >= 12, "12件の記録を作った", made)

    pg.click("#tabHistory")
    pg.wait_for_timeout(800)

    # ================= 1. 表示件数 =================
    section("1. 表示件数を選べる")
    sizes = pg.eval_on_selector_all(".hist-size button", "e => e.map(x => x.textContent.trim())")
    check(sizes == ["直近10件", "直近50件", "直近100件"], "3つの選択がある", sizes)
    hs = pg.eval_on_selector_all(".hist-size button",
                                 "e => e.map(x => Math.round(x.getBoundingClientRect().height))")
    check(hs and min(hs) >= 44, "どれも44px以上", hs)
    pressed = pg.eval_on_selector_all(
        ".hist-size button", "e => e.map(x => x.getAttribute('aria-pressed'))")
    check(pressed == ["true", "false", "false"], "既定は直近10件", pressed)
    cards = pg.eval_on_selector_all("#historyList .match-card", "e => e.length")
    check(cards == 10, "10件だけ出る", cards)

    # ================= 2. ページ切り替え =================
    section("2. ページ切り替え")
    check(pg.locator(".hist-pager").count() == 1, "ページ送りが出る")
    now = pg.text_content(".hist-pager .hp-now") or ""
    check("1 / 2" in now and "全12件" in now, "何ページ目かが分かる", now)
    prev_disabled = pg.eval_on_selector('.hist-pager button:text-is("← 前")', "e => e.disabled")
    check(prev_disabled, "1ページ目では「前」を押せない")
    pg.click('.hist-pager button:text-is("次 →")')
    pg.wait_for_timeout(600)
    cards2 = pg.eval_on_selector_all("#historyList .match-card", "e => e.length")
    check(cards2 == 2, "2ページ目に残り2件が出る", cards2)
    now2 = pg.text_content(".hist-pager .hp-now") or ""
    check("2 / 2" in now2, "2ページ目と分かる", now2)
    next_disabled = pg.eval_on_selector('.hist-pager button:text-is("次 →")', "e => e.disabled")
    check(next_disabled, "最後のページでは「次」を押せない")

    # ================= 3. 100件にすると1ページ =================
    section("3. 件数を増やすとページ送りが消える")
    pg.click('.hist-size button:text-is("直近100件")')
    pg.wait_for_timeout(600)
    cards3 = pg.eval_on_selector_all("#historyList .match-card", "e => e.length")
    check(cards3 == 12, "12件すべて出る", cards3)
    check(pg.locator(".hist-pager").count() == 0, "1ページに収まればページ送りは出さない")
    pg.click('.hist-size button:text-is("直近10件")')
    pg.wait_for_timeout(500)

    # ================= 6. 名前が潰れない =================
    section("6. 名前が潰れない")
    w = pg.eval_on_selector("#historyList .match-card .mc-nm:last-child", """e => {
      const r = e.getBoundingClientRect();
      return {w: Math.round(r.width), text: e.innerText.trim()};
    }""")
    check(w["w"] >= 70, "相手の名前の欄が70px以上ある", w)
    pg.screenshot(path=os.path.join(SHOTS, "hist2_list.png"), full_page=True)

    # ================= 4〜5. ダブルスとスキルレベル =================
    section("4. ダブルスは2段")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball_doubles")
    pg.wait_for_timeout(450)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameA2", "きりの")
    pg.fill("#inNameB", "ながいなまえのあいて")
    pg.fill("#inNameB2", "もうひとりのあいて")
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    finish_by(pg, "A")
    pg.click("#tabHistory")
    pg.wait_for_timeout(800)
    dbl = pg.evaluate("""() => {
      const card = [...document.querySelectorAll('#historyList .match-card')]
        .find(c => (c.textContent || '').indexOf('ダブルス') >= 0);
      if (!card) return null;
      const cells = [...card.querySelectorAll('.mc-nm')];
      return cells.map(c => ({
        doubles: c.classList.contains('is-doubles'),
        lines: c.querySelectorAll('.mc-nm-line').length,
        tops: [...c.querySelectorAll('.mc-nm-line')]
          .map(x => Math.round(x.getBoundingClientRect().top)),
      }));
    }""")
    check(dbl is not None, "ダブルスのカードがある", dbl)
    check(dbl and all(c["doubles"] for c in dbl), "両チームとも2段の形になる", dbl)
    check(dbl and all(c["lines"] == 2 for c in dbl), "1チーム2人ぶんの行が出る", dbl)
    check(dbl and all(c["tops"][0] != c["tops"][1] for c in dbl),
          "2人が上下に分かれている（同じ行に並ばない）", dbl)

    section("5. スキルレベルは下の段")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(450)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "ながいなまえのあいて")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL7").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    pg.click("#finishBtn")
    pg.wait_for_timeout(600)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(800)
    pg.click("#tabHistory")
    pg.wait_for_timeout(800)
    jpa = pg.evaluate("""() => {
      const card = [...document.querySelectorAll('#historyList .match-card')]
        .find(c => (c.textContent || '').indexOf('JPA') >= 0);
      if (!card) return null;
      const nm = card.querySelector('.mc-nm');
      const slInName = nm.querySelectorAll('.mc-sl').length;
      const slRow = card.querySelector('.mc-jpa');
      const sl = slRow ? slRow.querySelectorAll('.mc-sl').length : 0;
      const nmTop = Math.round(nm.getBoundingClientRect().top);
      const slTop = slRow ? Math.round(slRow.getBoundingClientRect().top) : 0;
      return {slInName: slInName, slBelow: sl, nmTop: nmTop, slTop: slTop};
    }""")
    check(jpa is not None, "JPAのカードがある", jpa)
    check(jpa and jpa["slInName"] == 0, "名前の横にスキルレベルは出さない", jpa)
    check(jpa and jpa["slBelow"] == 2, "下の段に両者のスキルレベルが出る", jpa)
    check(jpa and jpa["slTop"] > jpa["nmTop"], "スキルレベルは名前より下にある", jpa)
    pg.screenshot(path=os.path.join(SHOTS, "hist2_jpa.png"), full_page=True)

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("==== %d/%d 成功 ====" % (len(results) - len(ng), len(results)))
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
