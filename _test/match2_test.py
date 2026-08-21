# -*- coding: utf-8 -*-
"""match2_test.py — 試合画面の作り直し（本人の指示 2026-08-21・画像1）

対象:
  1. 下の帯に「スコア修正・スコアシート・無効球・次のラック」が1行で並ぶ
  2. 「訂正」→「スコア修正」に変わり、アイコンが付く
  3. スコアシートは下の帯のボタンで開閉し、横向きでも中身が見える
  4. スコアシートを閉じているあいだはスコアボードが潰れない
  5. スコアシートにラックの区切り線とラック番号が出る
  6. 無効球ボタンで無効球を数えられる（点は増えない）
  7. 無効球と両者のスコアの合計が1ラックぶん（10点）になると次のラックへ進む
  8. 交代ボタンを押さなくても、A→B→A の入力でイニングが1増える
  9. スコア修正の一覧が「○○が N点 追加」になる
 10. スコア修正からイニングを増減できる

実行: python _test/match2_test.py
"""
import sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
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


FIT = """() => {
  const sec = document.getElementById('screenMatch');
  const bb = sec.querySelector('.bottom-bar').getBoundingClientRect();
  const sb = sec.querySelector('.scoreboard').getBoundingClientRect();
  const fa = document.getElementById('panelFlagsA');
  const clip = (fa && !fa.hidden && fa.getClientRects().length)
    ? Math.round(fa.getBoundingClientRect().bottom - sb.bottom) : 0;
  return {botOut: Math.round(bb.bottom - window.innerHeight),
          clip: clip,
          scoreboardH: Math.round(sb.height),
          sheetH: Math.round(sec.querySelector('.sheet-area').getBoundingClientRect().height),
          hScroll: document.documentElement.scrollWidth > window.innerWidth + 1};
}"""

STATE = """() => ({
  scoreA: Number(document.getElementById('scoreA').textContent),
  scoreB: Number(document.getElementById('scoreB').textContent),
  rack: (document.getElementById('rackInfo') || {}).textContent,
  inning: (document.getElementById('inningInfo') || {}).textContent,
  dead: (() => { const m = STORE.findOngoing();
    return (m.events || []).filter(e => e.t === 'DEAD_BALLS' && !e.voided).length; })(),
})"""


def start_jpa(pg):
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(500)
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "あいて")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL7").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)


with sync_playwright() as p:
    br = p.chromium.launch()

    # ================= 1〜2. 下の帯 =================
    section("1. 下の帯のボタン")
    pg = br.new_page(viewport=PORT)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)
    start_jpa(pg)

    bb = pg.evaluate("""() => [...document.querySelectorAll('#screenMatch .bottom-bar button')]
      .filter(b => !b.hidden)
      .map(b => ({id: b.id,
                  tx: (b.querySelector('.bb-tx') || {}).textContent,
                  ico: (b.querySelector('.bb-ico') || {}).textContent,
                  y: Math.round(b.getBoundingClientRect().y),
                  h: Math.round(b.getBoundingClientRect().height)}))""")
    ids = [b["id"] for b in bb]
    check(ids == ["reviseBtn", "sheetBtn", "deadBallBtn", "nextRackBtn"],
          "4つが下の帯に並ぶ", ids)
    check(len(set(b["y"] for b in bb)) == 1, "4つとも同じ行にある", bb)
    check(min(b["h"] for b in bb) >= 44, "どれも44px以上", bb)

    section("2. 「訂正」→「スコア修正」")
    rev = [b for b in bb if b["id"] == "reviseBtn"][0]
    check(rev["tx"] == "スコア修正", "文言が「スコア修正」", rev)
    check(bool((rev["ico"] or "").strip()), "アイコンが付いている", rev)
    check(pg.locator("#screenMatch .bottom-bar button:text-is('⋯ 訂正')").count() == 0,
          "「訂正」という表記は無い")

    # ================= 4. 閉じているとスコアが広い =================
    section("4. シートを閉じているとスコアボードが潰れない")
    closed = pg.evaluate(FIT)
    check(closed["sheetH"] == 0, "閉じている間シートは場所を取らない", closed)
    check(closed["clip"] <= 1, "記録のボタンがスコア欄からはみ出さない", closed)
    check(closed["botOut"] <= 1, "下の帯が画面の中", closed)

    # ================= 3. 開閉 =================
    section("3. スコアシートの開閉")
    pg.click("#sheetBtn")
    pg.wait_for_timeout(600)
    opened = pg.evaluate(FIT)
    check(opened["sheetH"] > 100, "開くとシートが見える大きさになる", opened)
    check(opened["botOut"] <= 1, "開いても下の帯が画面の中", opened)
    check(pg.locator(".sheet-grid").count() >= 1, "得点マスが出る")
    check((pg.text_content("#sheetBtn") or "").find("閉じる") >= 0,
          "ボタンの文言が「閉じる」に変わる", pg.text_content("#sheetBtn"))
    pg.click("#sheetBtn")
    pg.wait_for_timeout(500)
    check(pg.evaluate("() => document.getElementById('sheetArea').hidden"),
          "もう一度押すと閉じる")

    # ================= 8. イニング自動 =================
    section("8. 交代を押さなくてもイニングが増える")
    s0 = pg.evaluate(STATE)
    check("1イニング目" in (s0["inning"] or ""), "はじめは1イニング目", s0)
    pg.click("#panelA")
    pg.wait_for_timeout(350)
    s1 = pg.evaluate(STATE)
    check(s1["scoreA"] == 1 and "1イニング目" in s1["inning"],
          "A が入れてもイニングは変わらない", s1)
    pg.click("#panelB")
    pg.wait_for_timeout(350)
    s2 = pg.evaluate(STATE)
    check(s2["scoreB"] == 1 and "1イニング目" in s2["inning"],
          "B に移ってもまだ1イニング目", s2)
    pg.click("#panelA")
    pg.wait_for_timeout(350)
    s3 = pg.evaluate(STATE)
    check("2イニング目" in (s3["inning"] or ""),
          "A→B→A で2イニング目になる", s3)

    # ================= 6〜7. 無効球とラック送り =================
    section("6. 無効球")
    before = pg.evaluate(STATE)
    pg.click("#deadBallBtn")
    pg.wait_for_timeout(500)
    after = pg.evaluate(STATE)
    check(after["dead"] == before["dead"] + 1, "無効球が1つ増える", [before, after])
    check(after["scoreA"] == before["scoreA"] and after["scoreB"] == before["scoreB"],
          "点は増えない", [before, after])

    section("7. 合計が10点ぶんになったら次のラック")
    # いま A=2 B=1 無効球=1 の合計4点。あと6点ぶん入れると10点
    st = pg.evaluate(STATE)
    check(st["scoreA"] + st["scoreB"] + st["dead"] == 4, "ここまでで4点ぶん使った", st)
    # 残りを無効球で埋める。9番は2点なので、最後の1個で10点に届く
    for _ in range(8):
        if "ラック 2" in (pg.evaluate(STATE)["rack"] or ""):
            break
        pg.click("#deadBallBtn")
        pg.wait_for_timeout(300)
    end = pg.evaluate(STATE)
    check("ラック 2" in (end["rack"] or ""),
          "10点ぶん出そろったら次のラックへ進む", end)

    # ================= 5. 区切り線 =================
    section("5. ラックの区切り線")
    pg.click("#panelA")
    pg.wait_for_timeout(350)
    pg.click("#sheetBtn")
    pg.wait_for_timeout(600)
    marks = pg.eval_on_selector_all(".sheet-cell.rack-open",
                                    "e => e.map(x => x.getAttribute('data-rack'))")
    check(len(marks) >= 2, "ラックごとに区切りが出る", marks)
    check(marks[0] == "R1" and "R2" in marks, "ラック番号が読める", marks)
    border = pg.eval_on_selector(".sheet-cell.rack-open",
                                 "e => getComputedStyle(e).borderLeftWidth")
    check(border and border != "0px", "区切りの線が引かれている", border)
    pg.screenshot(path=os.path.join(SHOTS, "match2_sheet.png"), full_page=True)
    pg.click("#sheetBtn")
    pg.wait_for_timeout(400)

    # ================= 9〜10. スコア修正 =================
    section("9. スコア修正の一覧の表記")
    pg.click("#reviseBtn")
    pg.wait_for_timeout(600)
    descs = pg.eval_on_selector_all(".ev-item .ev-desc", "e => e.map(x => x.textContent)")
    check(any("点 追加" in d for d in descs), "「○○が N点 追加」の形で出る", descs[:5])
    check(not any("番をポケット" in d for d in descs), "球の番号では出さない", descs[:5])
    check(any("無効球" in d for d in descs), "無効球も一覧に出る", descs[:8])

    section("10. スコア修正からイニングを直せる")
    check(not pg.eval_on_selector("#reviseInning", "e => e.hidden"),
          "イニングの調整が出る")
    now0 = pg.text_content("#reviseInningNow") or ""
    pg.click("#inningPlusBtn")
    pg.wait_for_timeout(500)
    now1 = pg.text_content("#reviseInningNow") or ""
    check(now0 != now1, "＋1でイニングが増える", [now0, now1])
    pg.click("#inningMinusBtn")
    pg.wait_for_timeout(500)
    now2 = pg.text_content("#reviseInningNow") or ""
    check(now2 == now0, "−1で戻る", [now0, now2])
    pg.click("#closeReviseBtn")
    pg.wait_for_timeout(300)

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    pg.close()

    # ================= 横向き =================
    section("横向きでも同じように動く")
    pg2 = br.new_page(viewport=LAND)
    e2 = []
    pg2.on("pageerror", lambda e: e2.append(str(e)))
    pg2.goto(URL)
    pg2.wait_for_timeout(600)
    start_jpa(pg2)
    c2 = pg2.evaluate(FIT)
    check(c2["clip"] <= 1, "横: 記録のボタンがはみ出さない", c2)
    check(c2["botOut"] <= 1, "横: 下の帯が画面の中", c2)
    check(c2["scoreboardH"] >= 180, "横: スコアボードが潰れていない", c2)
    pg2.click("#sheetBtn")
    pg2.wait_for_timeout(600)
    o2 = pg2.evaluate(FIT)
    check(o2["sheetH"] >= 100, "横: 開くとシートが見える", o2)
    check(o2["botOut"] <= 1, "横: 開いても下の帯が画面の中", o2)
    check(pg2.locator(".sheet-grid").count() >= 1, "横: 得点マスが出る")
    pg2.screenshot(path=os.path.join(SHOTS, "match2_land.png"))
    check(not e2, "横: 画面のエラーが無い", e2[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("==== %d/%d 成功 ====" % (len(results) - len(ng), len(results)))
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
