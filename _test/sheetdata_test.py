# -*- coding: utf-8 -*-
"""sheetdata_test.py — 終わった試合のスコア表データ（result.sheet）の検証

本人の指示（2026-08-22）:
  「ボウラードの履歴はスコア表そのまま。10フレーム、各投球で何本倒したかを
    履歴から見れるようにしたい。JPAのスコアシートを保存して履歴から見れるように」

試合中のスコア表（ui_sheet.js）は1球ごとのイベント列から組み立てている。
終わった試合を開けるようにするため、また古い試合のイベント列を間引いても
表を描けるようにするため、確定時に result.sheet として最小限を保存する。

ここで確かめること:
  1. ボウラード1試合で、各投球の数が結果に入り、画面のスコア表と一致する
  2. JPA1試合で、各側の得点の並びが結果に入り、試合中のスコア表と一致する
  3. イベント列を空にしても、保存したデータから同じ表が組み立てられる
  4. スコア表データの無い古い記録に移行処理を走らせると埋まる
  5. 移行の前後で STORE.playerStats の数字が1つも変わらない
  6. 1試合あたり増えた保存容量（実測）

実行: python _test/sheetdata_test.py
"""
import sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n== " + name + " ==")


# ボウラードの投球（ストライク・スペア・オープンを1つずつ含む）
BOWL_THROWS = [10, 6, 4] + [3, 4] * 7 + [3, 4]

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("1 ボウラード：各投球の数が結果に入る")
    helpers.pick_game(pg, "bowlard")
    pg.fill("#inNameA", "山田")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)

    for pins in BOWL_THROWS:
        pg.click('#bowlPad .bp-btn[data-pins="%d"]' % pins)
        pg.wait_for_timeout(120)
    pg.wait_for_timeout(400)

    # 画面のスコア表（終了画面の裏に残っている）を控える
    screen_bowl = pg.eval_on_selector_all(
        ".bowl-frame",
        "els => els.map(e => ({no: e.querySelector('.bf-no').textContent,"
        " marks: Array.from(e.querySelectorAll('.bf-m')).map(m => m.textContent),"
        " score: e.querySelector('.bf-score').textContent}))")
    screen_total = pg.text_content(".bowl-total") or ""
    check(len(screen_bowl) == 10, "画面のスコア表は10フレーム", len(screen_bowl))

    check(not pg.eval_on_selector("#finishModal", "e => e.hidden"), "10フレームで終了画面が出る")
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(700)

    bowl_id = pg.evaluate("() => STORE.listMatches()[0].id")
    saved = pg.evaluate("(id) => (STORE.loadMatch(id).result || {}).sheet || null", bowl_id)
    check(saved is not None, "結果にスコア表データが入っている", saved)
    check(saved and saved.get("k") == "b", "種類はボウラード（k=b）", saved)
    check(saved and saved.get("t") == BOWL_THROWS,
          "各投球で入れた球数がそのまま入っている", saved.get("t") if saved else None)

    sheet = pg.evaluate("(id) => STORE.sheetOf(id)", bowl_id)
    check(sheet["kind"] == "bowlard", "sheetOf の種類はボウラード", sheet["kind"])
    check([f["score"] for f in sheet["frames"]]
          == [int(f["score"]) for f in screen_bowl],
          "フレームごとの点が画面のスコア表と一致する",
          ([f["score"] for f in sheet["frames"]], [f["score"] for f in screen_bowl]))
    check(str(sheet["total"]) in screen_total,
          "合計が画面と一致する", (sheet["total"], screen_total))
    check(sheet["complete"] is True, "10フレーム確定として読める")
    check(sheet["name"] == "山田", "誰の記録かが分かる", sheet["name"])

    # ================================================================
    section("2 JPA：得点の並びが試合中のスコア表と一致する")
    helpers.goto_setup(pg)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "タイラ")
    pg.fill("#inNameB", "岸川")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL2").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL2").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)

    def tap_current():
        who = pg.inner_text("#breakBannerName").strip()
        pn = "#panelA" if who == "タイラ" else "#panelB"
        if pg.eval_on_selector(pn, "e => e.disabled"):
            return False
        pg.click(pn)
        pg.wait_for_timeout(110)
        return True

    for _ in range(6):
        tap_current()
    # ラックの区切りも作る（区切りの印が保存できているかを見るため）
    pg.click("#nextRackBtn")
    pg.wait_for_timeout(300)
    for _ in range(4):
        tap_current()

    # 試合中のスコア表を開いて、画面に出ている並びを読む
    pg.click("#sheetBtn")
    pg.wait_for_timeout(400)
    screen_series = {}
    for side in ("a", "b"):
        screen_series[side.upper()] = pg.eval_on_selector_all(
            ".sheet-side.side-%s .sheet-cell.filled" % side,
            "els => els.map(e => ({title: e.getAttribute('title'),"
            " rackEnd: e.classList.contains('rack-end')}))")
    # 2026-08-22: シートは画面に重ねて開くので、閉じるのはシートの中の「閉じる」
    pg.click(".sheet-bar .st-close")
    pg.wait_for_timeout(200)

    live_id = pg.evaluate("() => STORE.findOngoing().id")
    live = pg.evaluate("(id) => STORE.sheetOf(id)", live_id)
    check(live["kind"] == "jpa", "途中でも sheetOf は JPA として読める", live["kind"])

    ok_series = True
    detail = ""
    for side in ("A", "B"):
        want = screen_series[side]
        got = live["series"][side]
        if len(want) != len(got):
            ok_series = False
            detail = (side, len(want), len(got))
            break
        for i, w in enumerate(want):
            title = "ラック%d／%d番" % (got[i]["rackNo"], got[i]["ball"])
            if w["title"] != title or w["rackEnd"] != got[i]["rackEnd"]:
                ok_series = False
                detail = (side, i, w, got[i])
                break
        if not ok_series:
            break
    check(ok_series, "画面のスコア表の並び（ラック番号・球番号・区切り）と一致する", detail)
    check(sum(len(screen_series[s]) for s in ("A", "B")) >= 10,
          "10点ぶん以上を突き合わせた",
          sum(len(screen_series[s]) for s in ("A", "B")))
    check(any(c["rackEnd"] for c in screen_series["A"] + screen_series["B"]),
          "ラックの区切りの印も突き合わせた")

    # 決着まで進める
    for _ in range(80):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        if not tap_current():
            break
    pg.wait_for_timeout(300)
    check(not pg.eval_on_selector("#finishModal", "e => e.hidden"), "JPAが決着した")
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(700)

    jpa_id = live_id
    jsheet = pg.evaluate("(id) => (STORE.loadMatch(id).result || {}).sheet || null", jpa_id)
    check(jsheet is not None, "結果にスコア表データが入っている")
    check(jsheet and jsheet.get("k") == "j", "種類はJPA（k=j）", jsheet)
    check(jsheet and "b" in jsheet.get("A", {}) and "c" in jsheet.get("A", {}),
          "各側に球の並び（b）とラックごとの点数（c）がある", jsheet)
    check(jsheet and sum(jsheet["A"]["c"]) == len(jsheet["A"]["b"]),
          "ラックごとの点数の合計＝球の並びの長さ", jsheet)

    fin = pg.evaluate("(id) => STORE.sheetOf(id)", jpa_id)
    check(fin["kind"] == "jpa", "終わった試合も sheetOf で読める")
    # 途中で控えた並びは、終わったあとの並びの先頭と同じはず（記録は足すだけ）
    prefix_ok = True
    for side in ("A", "B"):
        n = len(live["series"][side])
        for i in range(n):
            a = live["series"][side][i]
            c = fin["series"][side][i]
            if a["ball"] != c["ball"] or a["rackNo"] != c["rackNo"]:
                prefix_ok = False
    check(prefix_ok, "終了後の並びの先頭が、試合中に画面で見えていた並びと同じ")
    check(fin["got"]["A"] + fin["got"]["B"] >= 10, "得点の並びが最後まで入っている", fin["got"])
    check(fin["targets"]["A"] and fin["targets"]["B"], "目標点も読める", fin["targets"])
    check(fin["skillLevel"] is not None, "スキルレベルも読める", fin["skillLevel"])

    # ================================================================
    section("3 イベント列を空にしても同じ表が組み立てられる")
    for label, mid in (("ボウラード", bowl_id), ("JPA", jpa_id)):
        before = pg.evaluate("(id) => STORE.sheetOf(id)", mid)
        pg.evaluate("""(id) => {
          const m = STORE.loadMatch(id);
          m.events = [];
          localStorage.setItem('pool_match_' + id, JSON.stringify(m));
        }""", mid)
        after = pg.evaluate("(id) => STORE.sheetOf(id)", mid)
        # イニング・死球は結果から読むので、イベント列が無くても同じ値になる
        check(json.dumps(before, sort_keys=True) == json.dumps(after, sort_keys=True),
              label + "：イベント列が空でも同じ表になる",
              (json.dumps(before)[:200], json.dumps(after)[:200]))

    # ================================================================
    section("4/5 古い記録の移行と、成績が変わらないこと")
    # 3 でイベント列を消しているので、試合をやり直して素材を作る
    pg.evaluate("() => { localStorage.clear(); }")
    pg.reload()
    pg.wait_for_timeout(600)

    helpers.pick_game(pg, "bowlard")
    pg.fill("#inNameA", "山田")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    for pins in BOWL_THROWS:
        pg.click('#bowlPad .bp-btn[data-pins="%d"]' % pins)
        pg.wait_for_timeout(110)
    pg.wait_for_timeout(300)
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(600)

    helpers.goto_setup(pg)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "タイラ")
    pg.fill("#inNameB", "岸川")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL2").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL2").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    for _ in range(80):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        if not tap_current():
            break
    pg.wait_for_timeout(300)
    pg.click("#confirmFinishBtn")
    pg.wait_for_timeout(600)

    def stats_snapshot():
        return pg.evaluate("""() => {
          const ids = STORE.listPlayers().map(p => p.id);
          const out = {};
          ids.forEach(id => { out[id] = STORE.playerStats(id); });
          out['__all__'] = STORE.gameStats(null);
          ids.forEach(id => { out['g_' + id] = STORE.gameStats(id); });
          ids.forEach(id => { out['d_' + id] = STORE.gameDetail(id); });
          return out;
        }""")

    # いま保存されているスコア表データを外して「古い記録」を作る
    made = pg.evaluate("""() => {
      const ids = STORE.listMatches().map(m => m.id);
      let stripped = 0;
      ids.forEach(id => {
        const m = STORE.loadMatch(id);
        if (m && m.result && m.result.sheet) {
          delete m.result.sheet;
          localStorage.setItem('pool_match_' + id, JSON.stringify(m));
          stripped++;
        }
      });
      const s = STORE.getSettings() || {};
      delete s.sheetDataMigratedAt;
      STORE.saveSettings(s);
      return { ids: ids, stripped: stripped };
    }""")
    check(made["stripped"] == 2, "スコア表データを外した古い記録を2件作った", made["stripped"])

    before_stats = stats_snapshot()

    mig = pg.evaluate("() => STORE.migrateSheetData()")
    print("   移行の結果: " + json.dumps(mig, ensure_ascii=False))
    check(mig["ran"] is True, "移行が走った")
    filled_ok = pg.evaluate("""(ids) => ids.map(id => {
      const m = STORE.loadMatch(id);
      return { id: id, ev: ((m || {}).events || []).length,
               has: !!(m && m.result && m.result.sheet) };
    })""", made["ids"])
    check(all(r["has"] for r in filled_ok), "古い記録のスコア表データが埋まった", filled_ok)
    check(mig["filled"] == 2, "埋めた件数が合っている", mig)

    # 埋めた内容が、試合を終えたときに保存されるものと同じか
    same_as_build = pg.evaluate("""(ids) => ids.every(id => {
      const m = STORE.loadMatch(id);
      return JSON.stringify(m.result.sheet) === JSON.stringify(buildSheetData(m));
    })""", made["ids"])
    check(same_as_build, "埋めた内容が、確定時に保存する形と同じ")

    # 壊れた記録・イベントの無い記録を混ぜても例外で止まらない
    broke = pg.evaluate("""() => {
      localStorage.setItem('pool_match_m_broken_test', '{ this is not json');
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      idx.push({ id: 'm_broken_test', gameId: 'bowlard', finished: true });
      idx.push({ id: 'm_missing_test', gameId: 'bowlard', finished: true });
      localStorage.setItem('pool_matches_index', JSON.stringify(idx));
      try { return { ok: true, r: STORE.migrateSheetData(true) }; }
      catch (e) { return { ok: false, err: String(e) }; }
    }""")
    check(broke["ok"] is True, "壊れた記録があっても移行が例外で止まらない", broke)

    after_stats = stats_snapshot()
    same = json.dumps(before_stats, sort_keys=True, ensure_ascii=False) == \
        json.dumps(after_stats, sort_keys=True, ensure_ascii=False)
    check(same, "移行の前後で成績の数字が1つも変わらない")
    if not same:
        for k in before_stats:
            a = json.dumps(before_stats[k], sort_keys=True, ensure_ascii=False)
            c = json.dumps(after_stats.get(k), sort_keys=True, ensure_ascii=False)
            if a != c:
                print("   違い: " + k + "\n    前: " + a[:300] + "\n    後: " + c[:300])

    # 印が残り、2回目は走らない
    again = pg.evaluate("() => STORE.migrateSheetData()")
    check(again["ran"] is False, "一度やったら二度と全件を読み直さない", again)
    flag = pg.evaluate("() => (STORE.getSettings() || {}).sheetDataMigratedAt || null")
    check(bool(flag), "移行済みの印が設定に残る", flag)

    # ================================================================
    section("6 増えた保存容量（実測）")
    sizes = pg.evaluate("""(ids) => ids.map(id => {
      const m = STORE.loadMatch(id);
      if (!m || !m.result || !m.result.sheet) return null;
      const withSheet = JSON.stringify(m).length;
      const copy = JSON.parse(JSON.stringify(m));
      delete copy.result.sheet;
      return { id: id, gameId: m.gameId, add: withSheet - JSON.stringify(copy).length,
               total: withSheet };
    }).filter(Boolean)""", made["ids"])
    for s in sizes:
        print("   %-12s +%d バイト（試合まるごと %d バイト）"
              % (s["gameId"], s["add"], s["total"]))
    check(all(s["add"] > 0 for s in sizes), "どの試合も1試合ぶんのデータが増えている", sizes)
    check(all(s["add"] < 400 for s in sizes), "1試合あたり400バイト未満に収まっている", sizes)

    check(not errs, "画面のエラーが出ていない", errs[:3])

    b.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 60)
print("合計 %d件 / NG %d件" % (len(results), len(ng)))
for r in ng:
    print("NG " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
