# -*- coding: utf-8 -*-
"""storage_test.py — 保存容量の掃除（STORE.compact）の検証

本人の指示（2026-08-22）:
  「保存容量をもっと軽くしたいけどできる？」
  → 採用した決め
     1. 実削除にする（いまは deletedAt を立てるだけで本体が残っている）
     2. 古い試合の1球ごとの記録（events）を間引く。
        直近30試合は残す。イベント列の最初の1件（MATCH_START）は必ず残す
        （js/store.js の gameDetail が m.events[0].d.firstSide を読んでいる）

ここで確かめること:
  1. 削除した試合の本体が localStorage から実際に消える
  2. 間引いたあとも STORE.playerStats と種目別集計の数字が1つも変わらない
  3. 間引いたあとも STORE.sheetOf が同じ表を返す
  4. 進行中の試合は間引かれない（再開できる）
  5. 直近30試合は間引かれない
  6. 実測: 50試合ぶんで compact() したときの前後のバイト数と削減率

素材はUIを通さず、engine.js の関数を直接呼んで作る（50試合ぶんの操作を
画面から流すと現実的な時間で終わらないため）。作り方は本番と同じで、
createMatch → appendEvent → buildResult → STORE.saveMatch の順に通す。

実行: python _test/storage_test.py
"""
import sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n== " + name + " ==")


# ------------------------------------------------------------------
# 素材づくり（ブラウザの中で動かす）
#
# ・9ボール       … ふつうの試合（イベント列が長い）
# ・ボウラード    … スコア表あり（result.sheet が要る）
# ・JPA 9ボール   … スコア表あり
# 3種類を順番に作って、種目ごとの違いをまとめて見る。
# ------------------------------------------------------------------
MAKE_MATCHES = r"""
(arg) => {
  const n = arg.n;
  // 選手を2人だけ登録し、全試合で使い回す（成績の突き合わせに要る）
  const pa = STORE.upsertPlayer('タイラ', { nine: 5 });
  const pb = STORE.upsertPlayer('岸川', { nine: 5 });
  const ids = [];

  // ui_setup.js の buildGoal と同じ形を作る（画面を通さずに素材を作るため）
  function goalOf(gameId, targets, meta) {
    const g = GAMES[gameId];
    const baseType = (g.goalType === 'racks' || g.goalType === 'games') ? 'racks' : 'score';
    const isJpa = g.goal === 'jpaSL' || g.goal === 'jpaSL8';
    return {
      type: baseType,
      targets: targets,
      source: isJpa ? g.goal : 'free',
      meta: meta || {},
      ballHandicap: { A: null, B: null },
      memberHandicap: { A: [], B: [] },
      sets: 1,
      raceType: 'raceTo',
    };
  }

  function day(i) {
    // 1日1試合ずつ、古いものから並ぶようにする
    const d = new Date(Date.UTC(2026, 0, 1 + i, 12, 0, 0));
    return d;
  }

  for (let i = 0; i < n; i++) {
    const at = day(i);
    const kind = i % 3;
    let m;
    if (kind === 0) {
      m = createMatch({
        gameId: '9ball',
        sides: [{ name: 'タイラ', playerIds: [pa.id] },
                { name: '岸川', playerIds: [pb.id] }],
        goal: goalOf('9ball', { A: 3, B: 3 }),
        options: { breakType: 'winner', countInnings: true },
        firstSide: (i % 2) ? 'B' : 'A',
        now: at,
      });
      // 3ラック先取。A が 3-1 で勝つ形にする
      const order = ['A', 'B', 'A', 'A'];
      order.forEach(function (w) {
        appendEvent(m, { t: 'RACK_WIN', side: w, d: { winner: w } }, at);
      });
    } else if (kind === 1) {
      m = createMatch({
        gameId: 'bowlard',
        sides: [{ name: 'タイラ', playerIds: [pa.id] },
                { name: '', playerIds: [] }],
        goal: goalOf('bowlard', { A: 300, B: 300 }),
        options: {},
        firstSide: 'A',
        now: at,
      });
      // ストライク・スペア・オープンを混ぜた20投
      const throws = [10, 6, 4].concat([3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4], [3, 4]);
      throws.forEach(function (pins) {
        const balls = [];
        for (let k = 0; k < pins; k++) balls.push(k + 1);
        appendEvent(m, { t: 'POCKET', side: 'A', d: { balls: balls } }, at);
      });
    } else {
      m = createMatch({
        gameId: 'jpa_9ball',
        sides: [{ name: 'タイラ', playerIds: [pa.id] },
                { name: '岸川', playerIds: [pb.id] }],
        goal: goalOf('jpa_9ball', { A: 14, B: 14 }, { skillLevel: { A: 2, B: 2 } }),
        options: {},
        firstSide: 'A',
        now: at,
      });
      // A が 9番まで通しで入れるのを2ラック＋αで 14点まで
      let got = 0;
      let rack = 1;
      while (got < 14) {
        for (let b = 1; b <= 9 && got < 14; b++) {
          appendEvent(m, { t: 'POCKET', side: 'A', d: { balls: [b] } }, at);
          got += (b === 9 ? 2 : 1);
        }
        if (got < 14) {
          rack++;
          appendEvent(m, { t: 'RACK_START', side: null,
                           d: { rackNo: rack, breakSide: 'A' } }, at);
        }
      }
    }
    const st = reduceMatch(m);
    appendEvent(m, { t: 'MATCH_END', side: null,
                     d: { winner: st.winner, by: st.winner ? 'goal' : 'manual',
                          hasUnresolvedError: false } }, at);
    m.result = buildResult(m, at);
    m.createdAt = at.toISOString();
    m.updatedAt = at.toISOString();
    STORE.saveMatch(m);
    ids.push(m.id);
  }
  return ids;
}
"""

SNAPSHOT = r"""
() => {
  const ids = STORE.listPlayers().map(p => p.id);
  const out = {};
  ids.forEach(id => { out['s_' + id] = STORE.playerStats(id); });
  ids.forEach(id => { out['g_' + id] = STORE.gameStats(id); });
  ids.forEach(id => { out['d_' + id] = STORE.gameDetail(id); });
  out['__all__'] = STORE.gameStats(null);
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("0 掃除の入口が用意されている")
    api = pg.evaluate("""() => ({
      compact: typeof STORE.compact,
      purge: typeof STORE.purgeDeleted,
      trim: typeof STORE.trimOldEvents,
      keep: STORE.KEEP_RECENT_DEFAULT,
    })""")
    check(api["compact"] == "function", "STORE.compact がある", api)
    check(api["purge"] == "function", "STORE.purgeDeleted がある", api)
    check(api["trim"] == "function", "STORE.trimOldEvents がある", api)
    check(api["keep"] == 30, "既定で直近30試合を残す", api["keep"])

    # ================================================================
    section("1 削除した試合の本体が実際に消える")
    pg.evaluate("() => localStorage.clear()")
    pg.reload()
    pg.wait_for_timeout(500)
    ids = pg.evaluate(MAKE_MATCHES, {"n": 6})
    check(len(ids) == 6, "素材を6試合つくった", len(ids))

    target = ids[0]
    pg.evaluate("(id) => STORE.deleteMatch(id)", target)
    still = pg.evaluate("(id) => localStorage.getItem('pool_match_' + id) !== null", target)
    check(still, "削除の直後は本体がまだ残っている（論理削除）")

    res1 = pg.evaluate("() => STORE.compact()")
    print("   compact(): " + json.dumps(res1, ensure_ascii=False))
    gone = pg.evaluate("(id) => localStorage.getItem('pool_match_' + id) === null", target)
    check(gone, "compact のあと本体が localStorage から消えている")
    in_index = pg.evaluate(
        "(id) => JSON.parse(localStorage.getItem('pool_matches_index')||'[]')"
        ".some(e => e.id === id)", target)
    check(not in_index, "索引からも消えている")
    check(res1["purged"] == 1, "purged が1件", res1)
    check(res1["saved"] > 0, "バイト数が減っている", res1)
    check(sorted(res1.keys()) == sorted(
        ["before", "after", "saved", "purged", "trimmed",
         "orphans", "scanned", "skipped", "keepRecent"]),
        "compact が返す形", sorted(res1.keys()))

    # 索引から辿れない残骸も片付く
    pg.evaluate("() => localStorage.setItem('pool_match_m_orphan_test', '{\"id\":\"x\"}')")
    res_o = pg.evaluate("() => STORE.compact()")
    check(pg.evaluate("() => localStorage.getItem('pool_match_m_orphan_test') === null"),
          "索引に無い残骸も片付く", res_o)

    # ================================================================
    section("2/3/4/5 間引きの前後で成績・スコア表・進行中が変わらない")
    pg.evaluate("() => localStorage.clear()")
    pg.reload()
    pg.wait_for_timeout(500)
    all_ids = pg.evaluate(MAKE_MATCHES, {"n": 50})
    check(len(all_ids) == 50, "素材を50試合つくった", len(all_ids))

    # 進行中の試合を1つ足す（間引かれてはいけない）
    live_id = pg.evaluate(r"""
    () => {
      const pa = STORE.findPlayerByName('タイラ');
      const pb = STORE.findPlayerByName('岸川');
      const at = new Date(Date.UTC(2020, 0, 1, 12, 0, 0)); // わざといちばん古くする
      const m = createMatch({
        gameId: '9ball',
        sides: [{ name: 'タイラ', playerIds: [pa.id] },
                { name: '岸川', playerIds: [pb.id] }],
        goal: { type: 'racks', targets: { A: 5, B: 5 }, source: 'free', meta: {},
                ballHandicap: { A: null, B: null }, sets: 1, raceType: 'raceTo' },
        options: { breakType: 'winner' },
        firstSide: 'A',
        now: at,
      });
      appendEvent(m, { t: 'RACK_WIN', side: 'A', d: { winner: 'A' } }, at);
      appendEvent(m, { t: 'RACK_WIN', side: 'B', d: { winner: 'B' } }, at);
      m.createdAt = at.toISOString();
      m.updatedAt = at.toISOString();
      STORE.saveMatch(m);
      return m.id;
    }""")
    live_before = pg.evaluate("(id) => STORE.loadMatch(id).events.length", live_id)
    check(live_before == 4, "進行中の試合をいちばん古い日付で作った", live_before)

    before_stats = pg.evaluate(SNAPSHOT)
    before_sheets = pg.evaluate(
        "(ids) => { const o={}; ids.forEach(id => { o[id] = STORE.sheetOf(id); }); return o; }",
        all_ids)
    before_ev = pg.evaluate(
        "(ids) => { const o={}; ids.forEach(id => "
        "{ o[id] = (STORE.loadMatch(id)||{}).events.length; }); return o; }", all_ids)

    res = pg.evaluate("() => STORE.compact()")
    print("   compact(): " + json.dumps(res, ensure_ascii=False))

    after_stats = pg.evaluate(SNAPSHOT)
    same = json.dumps(before_stats, sort_keys=True, ensure_ascii=False) == \
        json.dumps(after_stats, sort_keys=True, ensure_ascii=False)
    check(same, "間引きの前後で playerStats／gameStats／gameDetail が1つも変わらない")
    if not same:
        for k in before_stats:
            a = json.dumps(before_stats[k], sort_keys=True, ensure_ascii=False)
            c = json.dumps(after_stats.get(k), sort_keys=True, ensure_ascii=False)
            if a != c:
                print("     ちがう: " + k + "\n       前: " + a[:400] + "\n       後: " + c[:400])

    after_sheets = pg.evaluate(
        "(ids) => { const o={}; ids.forEach(id => { o[id] = STORE.sheetOf(id); }); return o; }",
        all_ids)
    sheet_same = json.dumps(before_sheets, sort_keys=True, ensure_ascii=False) == \
        json.dumps(after_sheets, sort_keys=True, ensure_ascii=False)
    check(sheet_same, "間引きの前後で STORE.sheetOf が同じ表を返す")
    if not sheet_same:
        for k in before_sheets:
            a = json.dumps(before_sheets[k], sort_keys=True, ensure_ascii=False)
            c = json.dumps(after_sheets.get(k), sort_keys=True, ensure_ascii=False)
            if a != c:
                print("     ちがう: " + k + "\n       前: " + a[:300] + "\n       後: " + c[:300])
                break
    kinds = set(v.get("kind") for v in before_sheets.values())
    check("bowlard" in kinds and "jpa" in kinds,
          "確かめた中にボウラードとJPAのスコア表が入っている", kinds)

    after_ev = pg.evaluate(
        "(ids) => { const o={}; ids.forEach(id => "
        "{ o[id] = (STORE.loadMatch(id)||{}).events.length; }); return o; }", all_ids)

    # 新しい順（createdAt）に並べ直して、どれが残ったかを見る。
    # 進行中の1件がいちばん古いので、終わった50件のうち直近29件が「直近30」に入る
    order = pg.evaluate(r"""
    () => JSON.parse(localStorage.getItem('pool_matches_index') || '[]')
      .filter(e => !e.deletedAt)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
                      || String(b.id).localeCompare(String(a.id)))
      .map(e => e.id)
    """)
    keep_ids = set(order[:30])
    old_ids = [i for i in order[30:]]

    kept_ok = all(after_ev.get(i) == before_ev.get(i) for i in keep_ids if i in after_ev)
    check(kept_ok, "直近30試合のイベント列は1件も減っていない",
          [(i, before_ev.get(i), after_ev.get(i)) for i in keep_ids
           if i in after_ev and after_ev.get(i) != before_ev.get(i)][:5])

    trimmed_ok = all(after_ev.get(i) == 1 for i in old_ids if i in after_ev)
    check(trimmed_ok, "それより古い終わった試合のイベント列は1件だけになっている",
          [(i, after_ev.get(i)) for i in old_ids
           if i in after_ev and after_ev.get(i) != 1][:5])
    check(res["trimmed"] == len([i for i in old_ids if i in after_ev]),
          "間引いた件数が数と合っている",
          (res["trimmed"], len([i for i in old_ids if i in after_ev])))

    first_ok = pg.evaluate(r"""
    (ids) => ids.every(id => {
      const m = STORE.loadMatch(id);
      if (!m || !m.events.length) return false;
      const e = m.events[0];
      return e.t === 'MATCH_START' && e.d && (e.d.firstSide === 'A' || e.d.firstSide === 'B');
    })""", old_ids)
    check(first_ok, "間引いた試合にも MATCH_START が残っていて firstSide が読める")

    # 進行中の試合
    live_after = pg.evaluate("(id) => STORE.loadMatch(id).events.length", live_id)
    check(live_after == live_before,
          "進行中の試合（いちばん古い）は間引かれていない", (live_before, live_after))
    resumable = pg.evaluate(r"""
    (id) => {
      const m = STORE.findOngoing();
      if (!m || m.id !== id) return { ok: false, why: 'findOngoing で見つからない' };
      const st = reduceMatch(m);
      return { ok: st.racks.A === 1 && st.racks.B === 1, racks: st.racks };
    }""", live_id)
    check(resumable["ok"], "進行中の試合が再開でき、途中経過も同じ", resumable)

    # ================================================================
    section("6 実測：50試合ぶんの削減率")
    rate = (res["saved"] / res["before"] * 100) if res["before"] else 0
    print("   前  : %d バイト（%.1f KB）" % (res["before"], res["before"] / 1024.0))
    print("   後  : %d バイト（%.1f KB）" % (res["after"], res["after"] / 1024.0))
    print("   減り: %d バイト（%.1f%%）" % (res["saved"], rate))
    print("   内訳: 実削除 %d 件 / 間引き %d 件 / 見送り %d 件"
          % (res["purged"], res["trimmed"], res["skipped"]))
    per = (res["saved"] / res["trimmed"]) if res["trimmed"] else 0
    print("   間引き1試合あたり %.0f バイト減" % per)
    check(res["saved"] > 0, "50試合ぶんで容量が減っている", res)
    check(rate > 10, "50試合では削減率が1割を超える（実測 %.1f%%）" % rate, res)

    # 直近30試合は残す決めなので、試合数が少ないうちは削減率も小さい。
    # ふだん貯まっていく側（試合数が多い状態）でどうなるかも測る
    pg.evaluate("() => localStorage.clear()")
    pg.reload()
    pg.wait_for_timeout(500)
    pg.evaluate(MAKE_MATCHES, {"n": 200})
    res200 = pg.evaluate("() => STORE.compact()")
    rate200 = (res200["saved"] / res200["before"] * 100) if res200["before"] else 0
    print("   200試合のとき: %d → %d バイト（%.1f%% 減・間引き %d 件）"
          % (res200["before"], res200["after"], rate200, res200["trimmed"]))
    # 2026-08-22 の実測は 32.5%。下振れの見張りとして 25% を下限にする
    check(rate200 > 25, "200試合では削減率が25%%を超える（実測 %.1f%%）" % rate200, res200)

    # 2回目は減らない（べき等）
    res2 = pg.evaluate("() => STORE.compact()")
    check(res2["trimmed"] == 0 and res2["purged"] == 0,
          "もう一度 compact しても何も起きない（べき等）", res2)

    # ================================================================
    section("7 スコア表の移行が済むまでは間引かない")
    pg.evaluate("() => localStorage.clear()")
    pg.reload()
    pg.wait_for_timeout(500)
    ids2 = pg.evaluate(MAKE_MATCHES, {"n": 40})
    # スコア表データを外し、移行の印も消して「古い記録」の状態に戻す
    stripped = pg.evaluate(r"""
    () => {
      let n = 0;
      STORE.listMatches().forEach(e => {
        const m = STORE.loadMatch(e.id);
        if (m && m.result && m.result.sheet) {
          delete m.result.sheet;
          localStorage.setItem('pool_match_' + e.id, JSON.stringify(m));
          n++;
        }
      });
      const s = STORE.getSettings() || {};
      delete s.sheetDataMigratedAt;
      STORE.saveSettings(s);
      return n;
    }""")
    check(stripped > 0, "スコア表データを外した古い記録を作った", stripped)

    # trimOldEvents を単体で呼んでも、先に移行が走ってから間引く
    t = pg.evaluate("() => STORE.trimOldEvents(30)")
    print("   trimOldEvents(30): " + json.dumps(t, ensure_ascii=False))
    check(t["ran"] is True, "移行の印が無くても、移行を通してから間引く", t)
    filled = pg.evaluate(r"""
    () => STORE.listMatches().filter(e => {
      const m = STORE.loadMatch(e.id);
      return m && m.result && (typeof sheetKindOf === 'function' ? sheetKindOf(m) : null)
             && !m.result.sheet;
    }).length""")
    check(filled == 0, "スコア表のある種目は全てデータが埋まってから間引かれた", filled)
    lost = pg.evaluate(r"""
    () => STORE.listMatches().filter(e => {
      const s = STORE.sheetOf(e.id);
      return s.reason === 'noData' || s.reason === 'broken';
    }).length""")
    check(lost == 0, "スコア表を失った試合が1件も無い", lost)

    check(not errs, "ページの実行時エラーが無い", errs[:3])
    b.close()

print("\n" + "=" * 50)
ng = [r for r in results if not r[0]]
print("項目 %d 件中 NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
