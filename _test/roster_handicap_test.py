# -*- coding: utf-8 -*-
"""roster_handicap_test.py — 選手一覧・ボールハンデ・アプリ化の検証

対象:
  1. 名前を入れるとJPAスキルレベルの選択が出る
  2. 選手一覧（検索・並び替え・登録フォームの開閉）
  3. ボールハンデの設定と、試合中の常時表示
  4. アプリ（PWA）としての体裁

実行: python _test/roster_handicap_test.py
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

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n── " + name + " ──")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("① 名前を入れるとスキルレベルの選択が出る")
    pg.click("#toPlayersBtn2")
    pg.wait_for_timeout(300)
    check(pg.is_visible("#screenPlayers"), "選手一覧が開く")
    title = (pg.text_content("#screenPlayers .topbar h1") or "").strip()
    check(title == "選手一覧", "画面名が「選手一覧」になっている", title)

    # 登録フォームはふだん畳んである
    check(pg.locator("#addPlayerBody").get_attribute("hidden") is not None,
          "登録フォームは最初は畳まれている")

    helpers.open_add_player(pg)
    check(pg.is_visible("#newPlayerName"), "開くと名前欄が出る")
    check(pg.locator("#newPlayerSkill .sl-field").count() == 0,
          "名前が空のうちはスキルレベルの選択が出ない")

    pg.fill("#newPlayerName", "山田")
    pg.wait_for_timeout(200)
    check(pg.locator("#newPlayerSkill .sl-field").count() == 2,
          "名前を入れるとスキルレベルの選択が出る",
          pg.locator("#newPlayerSkill .sl-field").count())
    check("山田" in (pg.text_content(".sl-prompt") or ""),
          "誰のスキルレベルなのかが書かれている", pg.text_content(".sl-prompt"))

    # 消すとまた引っ込む
    pg.fill("#newPlayerName", "")
    pg.wait_for_timeout(200)
    check(pg.locator("#newPlayerSkill .sl-field").count() == 0,
          "名前を消すとスキルレベルの選択も引っ込む")
    pg.screenshot(path=os.path.join(SHOTS, "60_name_skill.png"), full_page=True)

    # ================================================================
    section("② 選手一覧")
    # 5人登録する（検索・並び替えが出る人数）
    for nm, n9 in [("山田", 6), ("佐藤", 4), ("鈴木", None), ("高橋", 9), ("田中", 2)]:
        helpers.add_player(pg, nm, skill_nine=n9)

    check(pg.locator("#playerList .player-card").count() == 5, "5人が一覧に出る",
          pg.locator("#playerList .player-card").count())
    check("5人" in (pg.text_content("#playersCount") or ""), "登録人数が出る",
          pg.text_content("#playersCount"))
    check(pg.locator("#addPlayerBody").get_attribute("hidden") is not None,
          "登録するとフォームは自動で畳まれる")

    # 4人以上で検索・並び替えが出る
    check(pg.is_visible("#playerTools"), "人数が増えると絞り込みと並び替えが出る")

    # 名前で絞り込める
    pg.fill("#playerSearch", "山")
    pg.wait_for_timeout(250)
    check(pg.locator("#playerList .player-card").count() == 1, "絞り込みが効く",
          pg.locator("#playerList .player-card").count())
    check("山田" in (pg.text_content("#playerList") or ""), "絞り込みの結果が正しい")

    pg.fill("#playerSearch", "存在しない名前")
    pg.wait_for_timeout(250)
    check(pg.locator("#playerList .empty").count() == 1, "一致しないときは案内が出る")

    pg.fill("#playerSearch", "")
    pg.wait_for_timeout(250)
    check(pg.locator("#playerList .player-card").count() == 5, "絞り込みを消すと全員に戻る")

    # 並び替え（名前順が既定）
    names_by_name = pg.locator("#playerList .mc-main > span:first-child").all_text_contents()
    # 並び替えの規則はブラウザの localeCompare("ja") なので、
    # 同じ規則で並べ直した結果と一致するかで確かめる
    expected = pg.evaluate(
        "(names) => names.slice().sort((a, b) => a.localeCompare(b, 'ja'))", names_by_name)
    check(names_by_name == expected, "名前順に並んでいる",
          {"実際": names_by_name, "期待": expected})

    # 勝率順に切り替えられる
    pg.click('#playerSortToggle button[data-v="wins"]')
    pg.wait_for_timeout(300)
    check(pg.locator("#playerList .player-card").count() == 5, "勝率順でも全員出る")
    pg.click('#playerSortToggle button[data-v="recent"]')
    pg.wait_for_timeout(300)
    check(pg.locator("#playerList .player-card").count() == 5, "最近順でも全員出る")
    pg.click('#playerSortToggle button[data-v="name"]')
    pg.wait_for_timeout(300)

    # スキルレベルの編集欄は開いたままになる（連続で設定できる）
    # ボタン名は 2026-08-21 に「プロフィール編集」へ変えた（本人の指示・C）
    pg.click('.player-card:has-text("鈴木") button:text-is("プロフィール編集")')
    pg.wait_for_timeout(250)
    check(pg.locator(".sl-edit:visible").count() == 1, "スキルレベルの編集欄が開く")
    pg.click('.sl-edit:visible .sl-field:has(label:text-is("9ボール のスキルレベル")) .chip:text-is("5")')
    pg.wait_for_timeout(300)
    check(pg.locator(".sl-edit:visible").count() == 1,
          "設定しても編集欄は開いたまま（続けて8ボールも設定できる）")
    pg.click('.sl-edit:visible .sl-field:has(label:text-is("8ボール のスキルレベル")) .chip:text-is("3")')
    pg.wait_for_timeout(300)
    stored = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_players') || '[]')")
    suzuki = [x for x in stored if x.get("name") == "鈴木"][0]
    check((suzuki.get("skill") or {}).get("nine") == 5, "9ボールのSLが入る", suzuki.get("skill"))
    check((suzuki.get("skill") or {}).get("eight") == 3, "続けて8ボールのSLも入る", suzuki.get("skill"))
    pg.screenshot(path=os.path.join(SHOTS, "61_roster.png"), full_page=True)

    # ================================================================
    section("③ ボールハンデはハンデありのときだけ出る")
    pg.click("#tabSetup")  # 選手一覧の「新しい試合」は撤去したので下部タブから
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)

    # ハンデなしのうちはボールハンデも左右別の入力も出さない
    check(pg.locator("#ballHandicapSection").get_attribute("hidden") is not None,
          "ハンデなしのときはボールハンデの欄を出さない")
    check(pg.locator("#goalArea .goal-picker").count() == 1,
          "ハンデなしのときは勝利条件の入力は1つだけ",
          pg.locator("#goalArea .goal-picker").count())

    # ハンデありにすると両方出る
    helpers.set_handicap_mode(pg, True)
    check(pg.is_visible("#ballHandicapSection"), "ハンデありにするとボールハンデが出る")
    check(pg.locator("#goalArea .goal-picker").count() == 2,
          "ハンデありのときは左右別に選べる",
          pg.locator("#goalArea .goal-picker").count())

    # 9ボールなら「7番以上」「8番以上」が選べる（キーボール9の手前2つ）
    bh_labels = pg.locator("#ballHandicapArea .bh-chips").first.all_text_contents()
    check("7番以上" in " ".join(bh_labels), "「7番以上」が選べる", bh_labels)
    check("8番以上" in " ".join(bh_labels), "「8番以上」が選べる", bh_labels)

    # ハンデなしに戻すと、付けたボールハンデも外れる
    helpers.set_handicap_mode(pg, False)
    check(pg.locator("#ballHandicapSection").get_attribute("hidden") is not None,
          "ハンデなしに戻すと欄が消える")

    # 14-1には出ない（元から球単位で数える種目のため）
    helpers.pick_game(pg, "straight")
    pg.wait_for_timeout(200)
    helpers.set_handicap_mode(pg, True)
    check(pg.locator("#ballHandicapSection").get_attribute("hidden") is not None,
          "14-1にはハンデありでもボールハンデの欄を出さない")

    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    pg.wait_for_timeout(150)
    helpers.set_handicap_mode(pg, True)

    # Bに「7番以上」のハンデを付ける
    pg.click('#ballHandicapArea .field:nth-of-type(2) .chip:text-is("7番以上")')
    pg.wait_for_timeout(300)
    summary = pg.text_content(".bh-summary") or ""
    # 1行に収めるため「7番以上」→「7番〜」、「9番のみ」→「9番」に短くした（2026-08-21）
    check("7番〜" in summary, "設定内容が文章で確認できる", summary)
    check("9番" in summary, "ハンデなし側の基準も出る", summary)

    # 単位が「点」に変わることが伝わる
    warn = pg.locator("#ballHandicapArea .hint.warn").count()
    check(warn >= 1, "点数先取に変わることが書かれている")
    goal_label = pg.text_content("#goalArea") or ""
    check("点" in goal_label, "勝利条件の単位が「点」になる", goal_label[:80])

    # 保存された内容を確認する
    helpers.set_goal(pg, 5, side="A")
    helpers.set_goal(pg, 5, side="B")
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenMatch"), "試合が始まる")

    goal = pg.evaluate("""() => {
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
      return m.goal;
    }""")
    check(goal["type"] == "score", "点数制になっている", goal["type"])
    check(goal["ballHandicap"]["A"] is None, "Aはハンデなし", goal["ballHandicap"]["A"])
    check(goal["ballHandicap"]["B"]["from"] == 7, "Bは7番以上", goal["ballHandicap"]["B"])
    check(goal["ballHandicap"]["B"]["scoringBalls"] == [7, 8, 9],
          "得点になる球が展開されている", goal["ballHandicap"]["B"]["scoringBalls"])

    # ================================================================
    section("④ 試合中にボールハンデが表示される")
    check(pg.is_visible("#handicapB"), "Bのハンデが表示されている")
    check("7番以上" in (pg.text_content("#handicapB") or ""),
          "Bのハンデ内容が読める", pg.text_content("#handicapB"))
    check(pg.is_visible("#handicapA"), "Aにも基準が表示されている")
    check("9番のみ" in (pg.text_content("#handicapA") or ""),
          "Aは9番のみと分かる", pg.text_content("#handicapA"))
    sub = pg.text_content("#matchSubtitle") or ""
    check("ボールハンデ" in sub, "副題にもボールハンデと出る", sub)
    hint = pg.text_content("#tapHint") or ""
    check("得点になる球" in hint, "タップの意味が案内される", hint)

    # ================================================================
    section("⑤ ボールハンデが実際に得点に効く")
    # Bをタップ → 7番が入って1点（若い球ではなく得点になる球を消費する）
    pg.click("#panelB")
    pg.wait_for_timeout(400)
    check(pg.text_content("#scoreB") == "1", "Bのタップで1点入る", pg.text_content("#scoreB"))

    ev = pg.evaluate("""() => {
      const idx = JSON.parse(localStorage.getItem('pool_matches_index') || '[]');
      const m = JSON.parse(localStorage.getItem('pool_match_' + idx[0].id));
      return m.events.filter(e => e.t === 'POCKET').map(e => e.d.balls[0]);
    }""")
    check(ev and ev[-1] == 7, "得点にならない1番ではなく7番が消費される", ev)

    # Aをタップ → 1番が入るが0点（ハンデなし側は9番のみ得点）
    pg.click("#panelA")
    pg.wait_for_timeout(400)
    check(pg.text_content("#scoreA") == "0", "Aは9番以外では点が入らない",
          pg.text_content("#scoreA"))

    pg.screenshot(path=os.path.join(SHOTS, "62_handicap_match.png"), full_page=False)

    # ================================================================
    section("⑥ アプリ（PWA）としての体裁")
    # 画面いっぱいに使えているか（横スクロールが出ない）
    ow = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(ow <= 0, "横スクロールが発生していない", ow)

    # 長押しでテキスト選択が始まらない（ネイティブアプリらしさ）
    sel = pg.evaluate("() => getComputedStyle(document.body).webkitUserSelect || getComputedStyle(document.body).userSelect")
    check(sel == "none", "本文の長押し選択が抑えられている", sel)

    # ただし入力欄は選択できる必要がある
    # 中断すると設定画面に戻る（履歴を経由しない）
    pg.click("#quitMatchBtn")
    pg.wait_for_timeout(400)
    pg.wait_for_timeout(300)
    insel = pg.evaluate("""() => {
      const el = document.querySelector('#inNameA');
      const s = getComputedStyle(el);
      return s.webkitUserSelect || s.userSelect;
    }""")
    check(insel == "text", "入力欄は文字を選べる", insel)

    # セーフエリアの指定が入っている
    # style.css の本文に指定があるかを直接見る。
    # cssRules は env() を含む宣言を落とすことがあり、
    # 「指定してあるのに無い」と誤判定するため
    css_text = io.open(os.path.join(ROOT, "style.css"), encoding="utf-8").read()
    has_safe = "safe-area-inset" in css_text
    check(has_safe, "セーフエリアの指定がある（ノッチ・ホームバー対応）")

    # PWAとして必要なものが揃っている
    manifest = pg.evaluate("() => { const l=document.querySelector('link[rel=manifest]'); return l ? l.getAttribute('href') : null; }")
    check(manifest is not None, "マニフェストが指定されている")
    check(pg.get_attribute('meta[name="apple-mobile-web-app-capable"]', "content") == "yes",
          "iOSで全画面起動する指定がある")
    check(pg.locator('link[rel="apple-touch-icon"]').count() == 1,
          "iOSのホーム画面アイコンが指定されている")

    # タップ領域
    small = pg.evaluate("""() => {
      const out = [];
      document.querySelectorAll('button:not([hidden])').forEach(b => {
        if (b.offsetParent === null) return;
        const r = b.getBoundingClientRect();
        if (r.height > 0 && r.height < 44) out.push((b.textContent||'').trim().slice(0,16) + ':' + Math.round(r.height));
      });
      return out;
    }""")
    check(len(small) == 0, "ボタンが全て44px以上", small)

    # ================================================================
    real = [e for e in errs if "favicon" not in e.lower()]
    check(len(real) == 0, "JavaScriptエラーが出ていない", real[:3])

    b.close()

print("\n" + "=" * 44)
ok = sum(1 for r in results if r[0])
ng = len(results) - ok
print("成功: %d / 失敗: %d" % (ok, ng))
if ng:
    print("\n【失敗した項目】")
    for good, label, detail in results:
        if not good:
            print("  - " + label + (("  -> " + str(detail)) if detail else ""))
    sys.exit(1)
else:
    print("すべて成功")
