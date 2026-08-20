# -*- coding: utf-8 -*-
"""tune3_test.py — 2026-08-20 第3便の指示の検証

対象:
  1. 配置図: 球の上下に線が入らない／台が大きくなった／球が少し小さい
  2. 「使うボール（ボールセット）」の項目が消えている
  3. 通知: 短くなった／試合画面ではスコアや名前に重ならない
  4. 終了画面: スコアの重複が無い
  5. 終了画面: JPAポイントが1行で、名前の途中で折り返さない
  6. 終了画面: ポイントの決まり方の説明文が無い
  7. 14-1で「3先」などのラック用ボタンを出さない
  8. ボウラードで勝利条件・ブレイクの項目を出さない

実行: python _test/tune3_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOTS, exist_ok=True)

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
    pg.wait_for_timeout(500)

    # ================= 1. 配置図 =================
    section("1 配置図（線・台の大きさ・球の大きさ）")
    pg.click("#tabLayout")
    pg.wait_for_timeout(400)
    for n in ["0", "1", "2", "9"]:
        pg.click(".tray-ball[data-ball='%s']" % n)
    pg.wait_for_timeout(300)

    # 球の上下の線は button::after（8bit風の明暗）が四角のまま乗っていたのが原因。
    # 角の丸みを受け継がせて、線ではなく球の陰影に見えるようにした
    radius = pg.eval_on_selector(".tb-ball", "e => getComputedStyle(e, '::after').borderRadius")
    check(radius not in ("", "0px"), "台の球の陰影が円に沿っている（上下の線にならない）", radius)
    radius2 = pg.eval_on_selector(".tray-ball", "e => getComputedStyle(e, '::after').borderRadius")
    check(radius2 not in ("", "0px"), "一覧の球も同じ", radius2)

    geo = pg.evaluate("""() => {
      const t = document.getElementById('poolTable').getBoundingClientRect();
      const b = document.querySelector('.tb-ball').getBoundingClientRect();
      return {tw: Math.round(t.width), th: Math.round(t.height),
              bw: Math.round(b.width), ratio: b.width / t.width};
    }""")
    # 変更前は幅218px（390幅の端末）。台をできる限り大きくする指示への対応
    check(geo["tw"] >= 235, "台が前（218px）より大きい", geo)
    check(geo["bw"] <= 40, "球は40px以下（44pxから少し小さくした）", geo)
    check(geo["ratio"] < 0.18, "台に対する球の大きさが1/6未満", round(geo["ratio"], 3))
    check(pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"),
          "横にはみ出していない")
    pg.screenshot(path=os.path.join(SHOTS, "tune3_layout.png"))

    # ================= 2. 使うボールの項目 =================
    section("2 「使うボール」の項目を削除")
    pg.click("#tabSetup")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(300)
    check(pg.locator("#ballSetSection").count() == 0, "欄そのものが無い")
    check(pg.locator(".ballset-chip").count() == 0, "ボタンも無い")
    check("使うボール" not in pg.inner_text("#screenSetup"), "見出しも無い")
    check("ボールセット" not in pg.inner_text("#startSummary"), "まとめにも出さない")

    # ================= 7. 14-1のボタン =================
    section("7 14-1で「3先」を出さない")
    helpers.pick_game(pg, "straight")
    pg.wait_for_timeout(300)
    chips = pg.locator("#goalArea .goal-picker .chip").all_text_contents()
    check(not any(c.endswith("先") and "点" not in c for c in chips),
          "「3先」〜「7先」のボタンが無い", chips)
    check(chips == ["50点先取", "100点先取", "150点先取"],
          "代わりに14-1で実際に使う点数が出る", chips)
    # 9ボールは今までどおりラック先取のボタン
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(300)
    chips9 = pg.locator("#goalArea .goal-picker .chip").all_text_contents()
    check(chips9 == ["3先", "4先", "5先", "6先", "7先"], "9ボールは3〜7先のまま", chips9)

    # ================= 8. ボウラード =================
    section("8 ボウラードで勝利条件・ブレイクを出さない")
    helpers.pick_game(pg, "bowlard")
    pg.wait_for_timeout(300)
    vis = pg.evaluate("""() => {
      const seen = {};
      ['goalTitle','goalArea','breakTitle','firstSideField','breakTypeToggle'].forEach(id => {
        const el = document.getElementById(id);
        seen[id] = el ? el.getBoundingClientRect().height > 0 : false;
      });
      return seen;
    }""")
    check(not vis["goalTitle"], "「勝利条件」の見出しが出ない", vis)
    check(not vis["goalArea"], "勝利条件の欄が出ない", vis)
    check(not vis["breakTitle"], "「ブレイク」の見出しが出ない", vis)
    check(not vis["breakTypeToggle"], "ブレイク方式の欄が出ない", vis)
    check(not vis["firstSideField"], "「先にブレイクする人」も出ない", vis)
    txt = pg.inner_text("#startSummary")
    check("勝利条件" not in txt and "ブレイク" not in txt, "まとめにも出さない", txt[:150])
    pg.screenshot(path=os.path.join(SHOTS, "tune3_bowlard.png"), full_page=True)

    # ================= 3. 通知 =================
    section("3 通知（長さと重なり）")
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "たかのぶ")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL3").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL5").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(600)

    pg.evaluate("() => UI.toast('9番を落として1点入りました。')")
    pg.wait_for_timeout(200)
    check(pg.locator("#toastWrap .toast").count() == 1, "通知が出る")

    over = pg.evaluate("""() => {
      const t = document.querySelector('#toastWrap .toast');
      if (!t) return null;
      const tr = t.getBoundingClientRect();
      const hit = [];
      ['#panelA', '#panelB', '.bottom-bar', '.topbar'].forEach(sel => {
        const el = document.querySelector(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (!(r.right <= tr.left || r.left >= tr.right ||
              r.bottom <= tr.top || r.top >= tr.bottom)) hit.push(sel);
      });
      const sc = document.getElementById('screenMatch');
      return {hit: hit, fits: sc.scrollHeight <= sc.clientHeight + 1};
    }""")
    check(over and not over["hit"], "スコア・名前・上下の帯に重なっていない",
          over and over["hit"])
    check(over and over["fits"], "通知を出しても試合画面が1画面に収まる", over)
    pg.screenshot(path=os.path.join(SHOTS, "tune3_toast.png"))

    # 2.6秒は長いという指摘への対応（1.3秒）
    pg.wait_for_timeout(900)
    still = pg.locator("#toastWrap .toast").count()
    check(still == 1, "1.1秒の時点ではまだ出ている", still)
    pg.wait_for_timeout(800)
    check(pg.locator("#toastWrap .toast").count() == 0, "1.9秒までには消える")

    # ================= 4/5/6. 終了画面 =================
    section("4/5/6 終了画面（重複・1行・説明文）")
    for _ in range(80):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        cur = pg.inner_text("#breakBannerName").strip()
        pn = "#panelA" if cur == "たいら" else "#panelB"
        if pg.eval_on_selector(pn, "e => e.disabled"):
            break
        pg.click(pn)
        pg.wait_for_timeout(90)
    pg.wait_for_timeout(400)
    check(not pg.eval_on_selector("#finishModal", "e => e.hidden"), "終了画面が出る")

    ftxt = pg.inner_text("#finishSummary")
    check("対 たかのぶ" not in ftxt, "上側の重複したスコア行が消えている", ftxt[:200])
    check(ftxt.count("獲得スコア") == 1, "スコアの行は1つだけ", ftxt[:200])
    check("JPAポイント" in ftxt, "JPAポイントは出る", ftxt[:200])
    check("スコンク" not in ftxt and "早見表" not in ftxt,
          "ポイントの決まり方の説明文が消えている", ftxt[:250])

    # JPAポイントの行が1行に収まっているか（他の行と同じ高さ）
    rows = pg.evaluate("""() => {
      const out = [];
      document.querySelectorAll('#finishSummary .ss-row').forEach(r => {
        out.push({t: r.textContent.trim(), h: Math.round(r.getBoundingClientRect().height)});
      });
      return out;
    }""")
    jpa = [r for r in rows if r["t"].startswith("JPAポイント")]
    base = min(r["h"] for r in rows)
    check(len(jpa) == 1 and jpa[0]["h"] <= base + 2, "JPAポイントが1行に収まる", (jpa, base))

    # 名前と点数の塊は途中で折り返さない指定になっているか
    wrapped = pg.evaluate("""() => {
      const parts = document.querySelectorAll('#finishSummary .ss-part');
      if (!parts.length) return 'no-part';
      const bad = [];
      parts.forEach(el => {
        if (getComputedStyle(el).whiteSpace !== 'nowrap') bad.push(el.textContent);
      });
      return bad;
    }""")
    check(wrapped == [], "名前と点数の塊は折り返さない指定になっている", wrapped)
    pg.screenshot(path=os.path.join(SHOTS, "tune3_finish.png"))

    check(not errs, "画面のエラーが出ていない", errs)
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("成功 %d / %d" % (len(results) - len(ng), len(results)))
if ng:
    for _, label, detail in ng:
        print("  NG: " + label + (("  -> " + str(detail)) if detail else ""))
    sys.exit(1)
print("すべて成功しました")
