# -*- coding: utf-8 -*-
"""class_test.py — 選手のクラス（本人の指示 2026-08-21・C）

対象:
  1. 登録フォームでクラスを選べる（Be / C / B / A / SA / P・任意）
  2. 選ばずに登録できる（任意項目）
  3. 一覧の名前の横にクラスのバッジが出る
  4. 「スキルレベル」ボタンが「プロフィール編集」になっている
  5. プロフィール編集で 名前・クラス・所属店舗・スキルレベル を直せる
  6. 成績表（一覧・個人）の名前の横にもクラスが出る
  7. 履歴では一般種目にクラス、JPAはスキルレベルだけが出る
  8. バッジは押せる大きさの邪魔をせず、名前が長くても消えない

実行: python _test/class_test.py
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
    """スコアを押して勝たせ、確認の窓が出たら通す（detail_test と同じ手順）"""
    for _ in range(40):
        if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
            break
        panel = "#panel" + side
        if pg.eval_on_selector(panel, "e => e.disabled"):
            break
        pg.click(panel)
        pg.wait_for_timeout(110)
    pg.wait_for_timeout(300)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(700)


def open_form(pg):
    """選手一覧を開いて登録フォームを開く"""
    pg.click("#tabPlayers")
    pg.wait_for_timeout(500)
    pg.click("#toggleAddPlayerBtn")
    pg.wait_for_timeout(300)


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport=PORT)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================= 1. 登録フォームのクラス欄 =================
    section("1. 登録フォームでクラスを選べる")
    open_form(pg)
    check(pg.locator(".cls-chips").count() == 0,
          "名前が空のうちはクラスの選択が出ない",
          pg.locator(".cls-chips").count())
    pg.fill("#newPlayerName", "フーチーウェイ")
    pg.wait_for_timeout(400)
    check(pg.locator(".cls-chips").count() >= 1, "名前を入れるとクラスの選択が出る")
    labels = pg.eval_on_selector_all(".cls-chips .chip", "e => e.map(x => x.textContent.trim())")
    check(labels == ["未設定", "Be", "C", "B", "A", "SA", "P"],
          "6種類＋未設定が並ぶ", labels)
    check("フーチーウェイ" in (pg.text_content(".cls-prompt") or ""),
          "誰のクラスなのかが書かれている", pg.text_content(".cls-prompt"))
    small = pg.eval_on_selector_all(
        ".cls-chips .chip",
        "e => e.map(x => Math.round(x.getBoundingClientRect().height))")
    check(min(small) >= 44, "クラスの札が44px以上", small)

    pg.click('.cls-chips .chip:text-is("P")')
    pg.wait_for_timeout(250)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(600)

    # ================= 2. 一覧のバッジ =================
    section("2. 一覧の名前の横にバッジ")
    txt = pg.text_content('.player-card:has-text("フーチーウェイ")') or ""
    check("P" in txt, "一覧にクラスが出る", txt[:80])
    badge = pg.locator('.player-card:has-text("フーチーウェイ") .cls-badge')
    check(badge.count() == 1, "バッジが1つ出る", badge.count())
    check((badge.text_content() or "").strip() == "P", "バッジの中身が P",
          badge.text_content())
    order = pg.eval_on_selector(
        '.player-card:has-text("フーチーウェイ") .pc-name',
        """e => { const t = e.querySelector('.pc-name-text').getBoundingClientRect();
                 const b = e.querySelector('.cls-badge').getBoundingClientRect();
                 return {right: Math.round(b.left - t.right), sameLine: Math.abs(b.top - t.top) < 24}; }""")
    check(order["right"] >= -1, "バッジは名前の右にある", order)
    check(order["sameLine"], "バッジと名前が同じ行にある", order)
    pg.screenshot(path=os.path.join(SHOTS, "class_list.png"), full_page=True)

    # ================= 3. クラス無しでも登録できる =================
    section("3. クラスは任意")
    pg.click("#toggleAddPlayerBtn")
    pg.wait_for_timeout(300)
    pg.fill("#newPlayerName", "クラスなしさん")
    pg.wait_for_timeout(350)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(600)
    check(pg.locator('.player-card:has-text("クラスなしさん")').count() == 1,
          "クラスを選ばなくても登録できる")
    check(pg.locator('.player-card:has-text("クラスなしさん") .cls-badge').count() == 0,
          "未設定の人にはバッジを出さない")

    # ================= 4〜5. プロフィール編集 =================
    section("4. プロフィール編集")
    check(pg.locator('.player-card:has-text("クラスなしさん") button:text-is("プロフィール編集")').count() == 1,
          "「スキルレベル」が「プロフィール編集」になっている")
    check(pg.locator('button:text-is("スキルレベル")').count() == 0,
          "「スキルレベル」という表記のボタンは無い")
    pg.click('.player-card:has-text("クラスなしさん") button:text-is("プロフィール編集")')
    pg.wait_for_timeout(400)
    panel = '.player-card:has-text("クラスなしさん") .sl-edit'
    ptxt = pg.text_content(panel) or ""
    for key in ["名前", "クラス", "所属店舗", "9ボール のスキルレベル", "8ボール のスキルレベル"]:
        check(key in ptxt, "プロフィール編集に「" + key + "」がある")

    section("5. プロフィール編集で直せる")
    # クラスを付ける
    pg.click(panel + ' .cls-chips .chip:text-is("SA")')
    pg.wait_for_timeout(500)
    check(pg.locator('.player-card:has-text("クラスなしさん") .cls-badge').count() == 1,
          "あとからクラスを付けられる")
    # 直したあとも編集欄は開いたままになる（続けて直せるように）
    check(pg.locator(panel + " .pf-shop").count() == 1
          and pg.locator(panel + " .pf-shop").is_visible(),
          "直したあとも編集欄が開いたまま")
    # 所属店舗
    pg.fill(panel + " .pf-shop", "○○ビリヤード")
    pg.click(panel + ' button:text-is("所属を保存")')
    pg.wait_for_timeout(500)
    check("○○ビリヤード" in (pg.text_content('.player-card:has-text("クラスなしさん")') or ""),
          "所属店舗が一覧に出る")
    # スキルレベル
    pg.click(panel + ' .sl-field:has(label:text-is("9ボール のスキルレベル")) .chip:text-is("6")')
    pg.wait_for_timeout(500)
    check("SL6" in (pg.text_content('.player-card:has-text("クラスなしさん")') or ""),
          "スキルレベルも直せる")
    # 名前
    pg.fill(panel + " .pf-name", "改名した人")
    pg.click(panel + ' button:text-is("名前を保存")')
    pg.wait_for_timeout(600)
    check(pg.locator('.player-card:has-text("改名した人")').count() == 1, "名前を直せる")
    check(pg.locator('.player-card:has-text("クラスなしさん")').count() == 0,
          "古い名前は残らない")
    saved = pg.evaluate("""() => {
      const p = STORE.listPlayers().find(x => x.name === '改名した人');
      return p ? {cls: p.cls || null, shop: p.shop || null, sk: (p.skill||{}).nine || null} : null;
    }""")
    check(saved and saved["cls"] == "SA" and saved["shop"] == "○○ビリヤード"
          and saved["sk"] == 6, "名前を変えても他の項目が消えない", saved)

    # ================= 6. 成績表 =================
    section("6. 成績表にもクラス")
    pg.click('.player-card:has-text("フーチーウェイ") button:text-is("成績")')
    pg.wait_for_timeout(600)
    head = pg.text_content("#statsBody h2") or ""
    check("フーチーウェイ" in head and "P" in head, "個人の成績の見出しにクラスが出る", head)
    check(pg.locator("#statsBody h2 .cls-badge").count() == 1,
          "見出しのバッジが1つ", pg.locator("#statsBody h2 .cls-badge").count())
    pg.click("#backFromStatsBtn")
    pg.wait_for_timeout(500)

    # ================= 7. 履歴 =================
    section("7. 履歴（一般種目はクラス、JPAはSLだけ）")
    # 一般種目の試合を1つ終える
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(450)
    pg.fill("#inNameA", "フーチーウェイ")
    pg.fill("#inNameB", "改名した人")
    pg.wait_for_timeout(300)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)
    finish_by(pg, "A")
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    hb = pg.locator(".mc-nm .cls-badge")
    check(hb.count() >= 1, "一般種目の履歴に名前の横のクラスが出る", hb.count())

    # JPA の試合はスキルレベルだけを出す（クラスは出さない）
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(450)
    pg.fill("#inNameA", "フーチーウェイ")
    pg.fill("#inNameB", "改名した人")
    pg.locator("#goalArea .field").nth(0).locator(".chip", has_text="SL7").click()
    pg.wait_for_timeout(150)
    pg.locator("#goalArea .field").nth(1).locator(".chip", has_text="SL4").click()
    pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(900)
    # JPAは球の入力で進めるので、スコアのタップでは終わらない。
    # 「試合終了」から確定させる（0-0でも履歴には残る）
    pg.click("#finishBtn")
    pg.wait_for_timeout(600)
    if not pg.eval_on_selector("#finishModal", "e => e.hidden"):
        pg.click("#confirmFinishBtn")
        pg.wait_for_timeout(800)
    pg.click("#tabHistory")
    pg.wait_for_timeout(700)
    jpa = pg.evaluate("""() => {
      const card = [...document.querySelectorAll('#historyList .match-card')]
        .find(c => (c.textContent || '').indexOf('JPA') >= 0);
      if (!card) return null;
      return {sl: card.querySelectorAll('.mc-sl').length,
              cls: card.querySelectorAll('.mc-nm .cls-badge').length};
    }""")
    check(jpa is not None, "JPAの履歴カードがある", jpa)
    check(jpa and jpa["sl"] >= 1, "JPAはスキルレベルが出る", jpa)
    check(jpa and jpa["cls"] == 0, "JPAにはクラスを出さない", jpa)
    pg.screenshot(path=os.path.join(SHOTS, "class_history.png"), full_page=True)

    section("エラー")
    check(not errs, "画面のエラーが無い", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n" + "=" * 44)
print("==== %d/%d 成功 ====" % (len(results) - len(ng), len(results)))
for r in ng:
    print("NG: " + r[1] + "  -> " + str(r[2]))
sys.exit(1 if ng else 0)
