# -*- coding: utf-8 -*-
"""compactui_test.py — 「保存を軽くする」の入口（本人の指示 2026-08-22）

本人の指示:
  「保存容量をもっと軽くしたいけどできる？」
  → 実削除と、古い試合の1球ごとの記録の間引きを採用。
    自動では走らせず、**押したときだけ**動かす（取り返しがつかないため）。

対象:
  1. 履歴に「保存を軽くする」がある
  2. 押すと確認が出て、何が起きるか・何が残るかが書いてある
  3. 取り消したら**何も変わらない**
  4. 実行すると容量が減り、減った量が知らされる
  5. **成績の数字が1つも変わらない**
  6. **スコア表が同じものを返す**
  7. **進行中の試合は残る（再開できる）**
  8. 2回目は「減らせるものはありませんでした」で、壊れない
  9. 絞り込み中はボタンを出さない（対象がまぎらわしいため）
 10. JSエラーが無い

実行: python _test/compactui_test.py
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
dialogs = []

# 40試合ぶんの記録を直接作る（画面から40試合こなすと時間がかかりすぎるため）。
# 中身は engine が作るものと同じ形にそろえる
SEED = """(n) => {
  const me = STORE.upsertPlayer('たいら');
  const opp = STORE.upsertPlayer('いっちょ');
  for (let i = 0; i < n; i++) {
    const t0 = new Date(2026, 0, 1 + i, 12, 0, 0);
    const id = 'm_seed_' + String(i).padStart(3, '0');
    const events = [
      {seq: 1, t: 'MATCH_START', side: null, at: t0.toISOString(),
       voided: false, d: {firstSide: 'A'}},
      {seq: 2, t: 'RACK_START', side: null, at: t0.toISOString(),
       voided: false, d: {rackNo: 1, breakSide: 'A'}}
    ];
    // 1球ごとの記録をたっぷり入れる（間引きの効き目が見えるように）
    for (let k = 0; k < 60; k++) {
      events.push({seq: 3 + k, t: 'POCKET', side: k % 2 ? 'B' : 'A',
        at: new Date(t0.getTime() + k * 1000).toISOString(),
        voided: false, d: {balls: [(k % 9) + 1], onBreak: false}});
    }
    STORE.saveMatch({
      id: id, schemaVersion: 1, ownerId: 'me',
      createdAt: t0.toISOString(), updatedAt: t0.toISOString(),
      syncState: 'local', deletedAt: null,
      gameId: '9ball', rulesetVersion: '2026-06',
      sides: [
        {sideId: 'A', name: 'たいら', playerIds: [me.id], guest: false},
        {sideId: 'B', name: 'いっちょ', playerIds: [opp.id], guest: false}
      ],
      goal: {type: 'racks', targets: {A: 3, B: 3}, meta: {}},
      options: {countInnings: false},
      events: events,
      recordedBy: 'A',
      result: {
        winner: 'A', endedAt: t0.toISOString(),
        racks: {A: 3, B: 1}, scores: {A: 0, B: 0},
        innings: 8, inningsPlayed: 9,
        perSide: {A: {safety: 1, masuwari: 1, breakAce: 0, breaks: 3, fouls: 0, highRun: 3},
                  B: {safety: 0, masuwari: 0, breakAce: 0, breaks: 1, fouls: 1, highRun: 1}}
      },
      note: ''
    });
  }
  return STORE.listMatches().length;
}"""

SNAPSHOT = """() => {
  const out = {};
  STORE.listPlayers().forEach(p => {
    out[p.name] = JSON.stringify(STORE.playerStats(p.id));
  });
  return out;
}"""


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def wait_toast(pg, ms=8000):
    """出た通知の文を拾う。

    通知は1.3秒で自動的に消えるので、待ってから読むと空になる。
    出た瞬間を捉えて中身を返す。
    """
    try:
        pg.wait_for_function(
            "() => (document.getElementById('toastWrap').textContent || '').trim().length > 0",
            timeout=ms)
    except Exception:
        return ""
    return (pg.inner_text("#toastWrap") or "").strip()


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    section("1. 40試合ぶんの記録と、進行中の試合を用意する")
    n = pg.evaluate(SEED, 40)
    check(n == 40, "40件の記録ができた", n)
    # 進行中の試合を1つ作る（間引かれないことを確かめるため）
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "いっちょ")
    helpers.set_goal(pg, 5)
    pg.wait_for_timeout(200)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(600)
    ongoing = pg.evaluate("() => { const m = STORE.findOngoing(); return m ? m.id : null; }")
    check(bool(ongoing), "進行中の試合がある", ongoing)

    section("2. 履歴に「保存を軽くする」がある")
    pg.click("#tabHistory")
    pg.wait_for_timeout(900)
    btn = pg.locator("#historyList button", has_text="保存を軽くする")
    check(btn.count() == 1, "ボタンがある", btn.count())
    before_kb = pg.evaluate("() => STORE.usageKB()")
    before_bytes = pg.evaluate("() => STORE.bytesUsed ? STORE.bytesUsed() : null")
    print("   いま 約%dKB" % before_kb)
    snap_before = pg.evaluate(SNAPSHOT)

    section("3. 確認が出て、取り消せる")
    pg.once("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    btn.click()
    pg.wait_for_timeout(800)
    msg = dialogs[-1] if dialogs else ""
    print("   " + msg.replace("\n", " / ")[:200])
    check("元に戻せません" in msg, "元に戻せないと書いてある", msg[:120])
    check("成績" in msg and "スコア表" in msg, "何が残るか書いてある", msg[:200])
    check("30" in msg, "何試合ぶん残るか書いてある", msg[:200])
    after_cancel = pg.evaluate("() => STORE.usageKB()")
    check(after_cancel == before_kb, "取り消したら容量が変わらない",
          {"前": before_kb, "後": after_cancel})
    ev_before = pg.evaluate("""() => STORE.loadMatch('m_seed_000').events.length""")
    check(ev_before > 2, "古い試合の記録もそのまま", ev_before)

    section("4. 実行すると減る")
    pg.once("dialog", lambda d: d.accept())
    pg.locator("#historyList button", has_text="保存を軽くする").click()
    toast = wait_toast(pg)
    pg.wait_for_timeout(400)
    after_bytes = pg.evaluate("() => STORE.bytesUsed ? STORE.bytesUsed() : null")
    after_kb = pg.evaluate("() => STORE.usageKB()")
    print("   %d バイト → %d バイト" % (before_bytes, after_bytes))
    check(after_bytes < before_bytes, "バイト数が減っている",
          {"前": before_bytes, "後": after_bytes})
    rate = round((before_bytes - after_bytes) / before_bytes * 100, 1)
    print("   減った割合 %.1f%%" % rate)
    check(rate > 5, "目に見えて減っている（5%%超）", rate)
    print("   " + toast.replace(chr(10), " "))
    check("減りました" in toast, "減った量が知らされる", toast[:100])
    check("KB" in toast, "何KB減ったか出る", toast[:100])

    section("5. 成績の数字が変わらない")
    snap_after = pg.evaluate(SNAPSHOT)
    same = [k for k in snap_before if snap_before[k] == snap_after.get(k)]
    diff = [k for k in snap_before if snap_before[k] != snap_after.get(k)]
    check(not diff, "全員の成績が1文字も変わらない", diff)
    print("   %d人ぶん一致" % len(same))

    section("6. 古い試合は間引かれ、直近30試合は残る")
    trimmed = pg.evaluate("""() => {
      const list = STORE.listMatches().filter(m => m.finished);
      const old = list[list.length - 1];
      const recent = list[0];
      return {
        oldId: old.id, oldEvents: STORE.loadMatch(old.id).events.length,
        recentId: recent.id, recentEvents: STORE.loadMatch(recent.id).events.length
      };
    }""")
    print("   " + str(trimmed))
    check(trimmed["oldEvents"] == 1, "いちばん古い試合は1件だけ残る", trimmed)
    check(trimmed["recentEvents"] > 2, "いちばん新しい試合はそのまま", trimmed)

    section("7. 進行中の試合は残り、再開できる")
    still = pg.evaluate("""(id) => {
      const m = STORE.loadMatch(id);
      return m ? {events: m.events.length, finished: !!m.result} : null;
    }""", ongoing)
    print("   " + str(still))
    check(still and still["events"] > 2, "進行中の記録は間引かれない", still)
    pg.click("#tabHome")
    pg.wait_for_timeout(600)
    resume = pg.locator("#homeBody .home-card.resume button", has_text="続きから記録する")
    check(resume.count() == 1, "ホームから続きを記録できる")
    resume.click()
    pg.wait_for_timeout(900)
    check(pg.is_visible("#screenMatch"), "試合画面が開く")
    check(pg.text_content("#scoreA") == "1", "スコアが残っている", pg.text_content("#scoreA"))
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(600)

    section("8. 2回目は何も起きない")
    pg.click("#tabHistory")
    pg.wait_for_timeout(800)
    kb2 = pg.evaluate("() => STORE.usageKB()")
    pg.once("dialog", lambda d: d.accept())
    pg.locator("#historyList button", has_text="保存を軽くする").click()
    toast2 = wait_toast(pg)
    pg.wait_for_timeout(300)
    kb3 = pg.evaluate("() => STORE.usageKB()")
    check(kb3 == kb2, "もう減らない（何度押しても壊れない）", {"前": kb2, "後": kb3})
    check("ありません" in toast2 or "減りました" in toast2, "何が起きたか知らせる", toast2[:80])

    section("9. 絞り込み中はボタンを出さない")
    pg.select_option("#histGameFilter", "9ball")
    pg.wait_for_timeout(700)
    check(pg.locator("#historyList button", has_text="保存を軽くする").count() == 0,
          "絞り込み中は出さない")
    pg.click("#histFilterClear")
    pg.wait_for_timeout(700)
    check(pg.locator("#historyList button", has_text="保存を軽くする").count() == 1,
          "絞り込みを外すとまた出る")
    pg.screenshot(path=os.path.join(SHOTS, "compact_ui.png"), full_page=False)

    section("10. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
