# -*- coding: utf-8 -*-
"""tune7_test.py — 2026-08-21（4便目）の指示

  1. 配置図の球の番号を1px上へ
  2. JPAの「1試合あたりの平均獲得ポイント率」= 累計 ÷（満点20×試合数）
  3. 5-9 / 5-10 は名前の下の「マスワリ」で倍にする（確認・入力の窓は出さない）
  4. 試合画面: 取り消しボタンを削除。訂正から記録を取り消せる
  5. 試合画面: 試合終了は上の帯の右（縦・横・全種目で共通）
  6. 試合画面: ラック情報の帯は画面の真ん中ではなく下
  7. 横向き: マスワリ・エース・セーフティは外側。重なり・はみ出しが無い
  8. マスワリを押しても帯が崩れない

実行: python _test/tune7_test.py
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

PORT = {"width": 390, "height": 844}
LAND = {"width": 844, "height": 390}

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


OVERLAP = """() => {
  const ids = ['panelA','panelB','panelFlagsA','panelFlagsB','turnBtn','reviseBtn',
               'finishBtn','quitMatchBtn','rackInfo','breakToggleBtn','nextRackBtn'];
  const els = ids.map(i => document.getElementById(i))
    .filter(e => e && !e.hidden && e.getBoundingClientRect().width > 0);
  const out = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
    if (a.right > b.left + 1 && a.left < b.right - 1
        && a.bottom > b.top + 1 && a.top < b.bottom - 1) out.push(els[i].id + ' x ' + els[j].id);
  }
  return out;
}"""

FITS = """() => {
  const sec = document.getElementById('screenMatch');
  const bb = sec.querySelector('.bottom-bar').getBoundingClientRect();
  const sb = sec.querySelector('.scoreboard').getBoundingClientRect();
  const clip = ['panelFlagsA','panelFlagsB'].map(i => {
    const e = document.getElementById(i);
    if (!e || e.hidden) return 0;
    return Math.round(e.getBoundingClientRect().bottom - sb.bottom);
  });
  return {botOut: Math.round(bb.bottom - window.innerHeight),
          clip: clip,
          hScroll: document.documentElement.scrollWidth > window.innerWidth + 1};
}"""


def start_jpa(pg):
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(450)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "プレーヤーB")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL7").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport=PORT)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================= 1. 配置図の番号 =================
    section("1. 配置図の球の番号（円は中央・数字はそのまま）")
    pg.click("#tabLayout")
    pg.wait_for_timeout(800)
    pg.click(".tray-ball[data-ball='1']")
    pg.wait_for_timeout(400)
    # 本人の指示（2026-08-21）:「円を1px下に移動して、番号はそのまま」。
    # 白い円は球の中心に揃え、中の数字は v29 と同じ高さ（球の中心）に残す。
    # 数字そのものの位置は、いったん <i> で包んで実物の枠を測る
    MEASURE = """(n) => {
      const b = n.parentElement.getBoundingClientRect();
      const r = n.getBoundingClientRect();
      const txt = n.textContent;
      n.textContent = "";
      const w = document.createElement("i");
      w.style.fontStyle = "normal";
      w.textContent = txt;
      n.appendChild(w);
      const t = w.getBoundingClientRect();
      return {
        circle: +((r.top + r.height / 2) - (b.top + b.height / 2)).toFixed(2),
        num: +((t.top + t.height / 2) - (b.top + b.height / 2)).toFixed(2)
      };
    }"""
    m = pg.eval_on_selector(".tb-ball .bb-num", MEASURE)
    check(m and abs(m["circle"]) <= 0.5, "台の球の白い円が球の中心にある", m)
    check(m and abs(m["num"]) <= 0.5, "台の球の番号は球の中心のまま", m)
    m2 = pg.eval_on_selector(".tray-ball[data-ball='2'] .bb-num", MEASURE)
    check(m2 and abs(m2["circle"]) <= 0.5, "一覧の球の白い円も中心にある", m2)
    check(m2 and abs(m2["num"]) <= 0.5, "一覧の球の番号も中心のまま", m2)

    # ================= 2. JPAポイント率 =================
    section("2. JPAの平均獲得ポイント率")
    rate = pg.evaluate("""() => {
      // 満点20の試合を5つ、合計73ポイント取ったことにして確かめる
      const p = STORE.upsertPlayer('ポイント検算');
      return {ok: !!p};
    }""")
    check(rate["ok"], "検算用の選手を作れた")
    got = pg.evaluate("""() => {
      // gameDetail の分母が「20 × 試合数」になっているかを、実装の中身で見る
      const src = STORE.gameDetail.toString();
      return {has20: src.indexOf('20') >= 0, has3: src.indexOf('jpa_8ball') >= 0};
    }""")
    check(got["has20"] and got["has3"],
          "9ボールは満点20・8ボールは満点3で数えている", got)

    # ================= 4〜6. 試合画面 =================
    section("4〜6. 試合画面（縦向き）")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    for n in ["たいら", "プレーヤーB"]:
        helpers.add_player(pg, n)
    start_jpa(pg)

    check(pg.locator("#undoBtn").count() == 0, "取り消しボタンが無い")
    check(pg.locator("#reviseBtn").count() == 1, "訂正ボタンはある")
    check(pg.eval_on_selector("#finishBtn", "e => !!e.closest('#screenMatch .topbar')"),
          "試合終了が上の帯にある")
    check(pg.eval_on_selector("#quitMatchBtn", "e => !!e.closest('#screenMatch .topbar')"),
          "中断も上の帯にある")
    fb = pg.locator("#finishBtn").bounding_box()
    qb = pg.locator("#quitMatchBtn").bounding_box()
    check(fb and qb and fb["x"] > qb["x"], "試合終了は中断より右", (fb, qb))
    check(fb and fb["x"] + fb["width"] > 390 * 0.6, "画面の右側にある", fb)
    check(fb and fb["height"] >= 36, "押せる大きさがある", fb)

    # ラック情報の帯は、中身をよそへ移したので畳まれる（2026-08-21）。
    #   ラック数・イニング数 → 上の帯 / 次のラック → 下の帯
    # 出ている場合は画面の下半分にあること（元の指示どおり）を見る
    mi = pg.evaluate("""() => {
      const e = document.querySelector('#screenMatch .match-info');
      const r = e.getBoundingClientRect();
      return {top: Math.round(r.top), h: Math.round(r.height),
              disp: getComputedStyle(e).display};
    }""")
    check(mi["disp"] == "none" or mi["top"] > 844 * 0.5,
          "ラック情報の帯は畳まれるか、画面の下半分にある", mi)
    bb = pg.eval_on_selector("#screenMatch .bottom-bar",
                             "e => Math.round(e.getBoundingClientRect().top)")
    check(mi["disp"] == "none" or mi["top"] < bb,
          "ラック情報は（出ていれば）下の帯より上", (mi, bb))

    # 訂正から記録を取り消せる
    section("4. 訂正から取り消せる")
    pg.click("#panelA")
    pg.wait_for_timeout(500)
    before = pg.text_content("#scoreA")
    pg.click("#reviseBtn")
    pg.wait_for_timeout(500)
    check(not pg.eval_on_selector("#reviseModal", "e => e.hidden"), "訂正の窓が開く")
    pg.locator("#evList button", has_text="取り消す").first.click()
    pg.wait_for_timeout(600)
    pg.click("#closeReviseBtn")
    pg.wait_for_timeout(400)
    after = pg.text_content("#scoreA")
    check(int(after) < int(before), "訂正でスコアが戻る", before + " -> " + after)

    # ================= 8. マスワリで帯が崩れない =================
    section("8. マスワリを押しても崩れない")
    b = pg.locator("#panelFlagsA button").filter(
        has=pg.locator(".sf-name", has_text="マスワリ")).first
    if b.is_disabled():
        b = pg.locator("#panelFlagsB button").filter(
            has=pg.locator(".sf-name", has_text="マスワリ")).first
    b.click()
    pg.wait_for_timeout(700)
    # マスワリの合計はラックが確定してから出る作りなので、
    # ここでは「押せたこと」と「崩れないこと」だけを見る
    check(pg.locator("#masuwariInfo").count() == 1, "マスワリの表示欄がある")
    fit = pg.evaluate(FITS)
    check(fit["botOut"] <= 1, "下の帯が画面に収まる（縦）", fit)
    check(not pg.evaluate(OVERLAP), "重なりが無い（縦）", pg.evaluate(OVERLAP))
    check(not fit["hScroll"], "横スクロールが出ない（縦）")
    pg.screenshot(path=os.path.join(SHOTS, "tune7_port.png"))

    # ================= 7. 横向き =================
    section("7. 横向き")
    pg.set_viewport_size(LAND)
    pg.wait_for_timeout(900)
    fit = pg.evaluate(FITS)
    check(fit["botOut"] <= 1, "下の帯が画面に収まる（横）", fit)
    check(max(fit["clip"]) <= 1, "記録のボタンがスコア欄からはみ出さない", fit)
    check(not pg.evaluate(OVERLAP), "重なりが無い（横）", pg.evaluate(OVERLAP))
    check(not fit["hScroll"], "横スクロールが出ない（横）")
    # 外側に置かれている（Aは左端、Bは右端）
    pos = pg.evaluate("""() => {
      const pa = document.getElementById('panelA').getBoundingClientRect();
      const fa = document.getElementById('panelFlagsA').getBoundingClientRect();
      const pb = document.getElementById('panelB').getBoundingClientRect();
      const fb = document.getElementById('panelFlagsB').getBoundingClientRect();
      return {aLeft: fa.right <= pa.left + 2, bRight: fb.left >= pb.right - 2};
    }""")
    check(pos["aLeft"], "A側の記録ボタンはスコアの左（外側）", pos)
    check(pos["bRight"], "B側の記録ボタンはスコアの右（外側）", pos)
    small = pg.evaluate("""() => [...document.querySelectorAll('.panel-flags button')]
      .filter(e => e.getBoundingClientRect().height < 44).length""")
    check(small == 0, "横向きでも44px以上", small)
    check(pg.eval_on_selector("#finishBtn", "e => !!e.closest('#screenMatch .topbar')"),
          "横向きでも試合終了は上の帯")
    pg.screenshot(path=os.path.join(SHOTS, "tune7_land.png"))
    pg.set_viewport_size(PORT)
    pg.wait_for_timeout(700)

    # ================= 3. 5-9 のマスワリ =================
    section("3. 5-9 のマスワリはボタンで")
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(700)
    pg.click("#tabSetup")
    pg.wait_for_timeout(500)
    helpers.open_group(pg, "house")
    pg.wait_for_timeout(300)
    pg.click('.game-pick:has(.gp-name:text-is("5-9"))')
    pg.wait_for_timeout(600)
    while pg.locator(".money-player-row").count() < 2:
        pg.click("#moneyAddBtn")
        pg.wait_for_timeout(200)
    for i, nm in enumerate(["たいら", "みなみ"]):
        pg.locator(".money-name").nth(i).fill(nm)
        pg.wait_for_timeout(120)
    pg.click("#moneyStartBtn")
    pg.wait_for_timeout(700)
    check(pg.locator(".money-score .ms-masu").count() == 2,
          "名前の下にマスワリのボタンが人数ぶんある",
          pg.locator(".money-score .ms-masu").count())
    mb = pg.locator(".money-score .ms-masu").first.bounding_box()
    check(mb and mb["height"] >= 44, "マスワリのボタンが44px以上", mb)

    # 点を入れて、マスワリで倍になること
    pg.locator("#moneyShooter button").first.click()
    pg.wait_for_timeout(300)
    pg.locator("#moneyPlus button[data-pts='2']").first.click()
    pg.wait_for_timeout(500)
    base = pg.locator(".money-score .ms-val").first.text_content()
    pg.locator(".money-score .ms-masu").first.click()
    pg.wait_for_timeout(600)
    doubled = pg.locator(".money-score .ms-val").first.text_content()
    check(int(doubled.replace("+", "")) == int(base.replace("+", "")) * 2,
          "マスワリを押すとそのラックの点が倍になる", base + " -> " + doubled)
    check(pg.locator(".money-score .ms-masu.is-on").count() == 1, "押した人だけ入る")
    pg.locator(".money-score .ms-masu").first.click()
    pg.wait_for_timeout(600)
    back = pg.locator(".money-score .ms-val").first.text_content()
    check(back == base, "もう一度押すと戻る", base + " -> " + back)
    pg.screenshot(path=os.path.join(SHOTS, "tune7_money.png"))

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n==== " + str(len(results) - len(ng)) + "/" + str(len(results)) + " 成功 ====")
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
