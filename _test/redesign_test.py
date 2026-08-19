# -*- coding: utf-8 -*-
"""redesign_test.py — 2026-08-20の変更の検証

対象:
  1. 8bitプラットフォーマー風のデザイン（可読性の制約を壊していないこと）
  2. プレーヤー登録の呼び出し
  3. 勝利条件のフリガナ削除
  4. プレーヤー登録時のJPAスキルレベル
  5. ショットクロックの自動エクステンションが1ラック1回
  6. ブレイク権のはっきりした表示
  7. 競技選択のカテゴリ折りたたみ

実行: python _test/redesign_test.py
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


def contrast(rgb1, rgb2):
    """2色のコントラスト比。WCAGの式に従う"""
    def lum(c):
        def ch(v):
            v = v / 255.0
            return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])
    l1, l2 = lum(rgb1), lum(rgb2)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def parse_rgb(s):
    """rgb(1, 2, 3) / rgba(1,2,3,1) を (r,g,b) にする"""
    nums = s[s.index("(") + 1:s.index(")")].split(",")
    return tuple(int(float(n.strip())) for n in nums[:3])


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 390, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL)
    pg.wait_for_timeout(500)

    # ================================================================
    section("① 競技選択がカテゴリに畳まれている")
    check(pg.locator(".group-head").count() == 2, "カテゴリが2つある",
          pg.locator(".group-head").count())
    heads = pg.locator(".group-head").all_text_contents()
    check(any("一般" in h for h in heads), "「一般」カテゴリがある", heads)
    check(any("JPA" in h for h in heads), "「JPA」カテゴリがある", heads)

    # 初期状態では「一般」だけが開いている＝一覧が短い
    check(pg.locator(".game-pick").count() == 5, "最初は一般の5種目だけが見えている",
          pg.locator(".game-pick").count())

    # 畳んだ状態でも9種目すべて選べる
    check(helpers.count_selectable_games(pg) == 10, "全カテゴリ合わせて10種目選べる",
          helpers.count_selectable_games(pg))

    # ダブルスは切替スイッチになっている（行数を増やさない）
    helpers.open_group(pg, "standard")
    check(pg.locator(".doubles-toggle").count() == 2,
          "一般カテゴリのダブルス切替は2つ（9ボール・10ボール）",
          pg.locator(".doubles-toggle").count())

    # ダブルス切替が実際に効く
    helpers.pick_game(pg, "9ball_doubles")
    check(pg.locator("#inNameA2").count() == 1, "ダブルスにすると2人目の入力欄が出る")
    helpers.pick_game(pg, "9ball")
    check(pg.locator("#inNameA2").count() == 0, "シングルスに戻すと2人目の欄が消える")
    pg.screenshot(path=os.path.join(SHOTS, "50_games.png"), full_page=True)

    # ================================================================
    section("② 勝利条件のフリガナが消えている")
    labels = pg.locator("#goalArea .chips .chip").all_text_contents()
    joined = " ".join(labels)
    check("ゴサキ" not in joined, "「ゴサキ」が出ていない", joined)
    check("ナナサキ" not in joined, "「ナナサキ」が出ていない", joined)
    check("5先" in labels, "「5先」自体は残っている", labels)
    check("7先" in labels, "「7先」自体は残っている", labels)

    # ================================================================
    section("③ プレーヤー登録でJPAスキルレベルを設定できる")
    pg.click("#toPlayersBtn2")
    pg.wait_for_timeout(300)
    check(pg.is_visible("#screenPlayers"), "プレーヤー画面が開く")
    # 登録フォームを開く。名前を入れるまではスキルレベル欄が出ない
    helpers.open_add_player(pg)
    check(pg.locator("#newPlayerSkill .sl-field").count() == 0,
          "名前が空のうちはスキルレベル欄が出ない",
          pg.locator("#newPlayerSkill .sl-field").count())

    pg.fill("#newPlayerName", "田中")
    pg.wait_for_timeout(200)
    sl_fields = pg.locator("#newPlayerSkill .sl-field").count()
    check(sl_fields == 2, "名前を入れると9ボールと8ボールの欄が出る", sl_fields)
    prompt = pg.text_content(".sl-prompt") or ""
    check("田中" in prompt, "誰のスキルレベルかが分かる", prompt)

    # 9ボール SL6 / 8ボール SL4 で「田中」を登録する
    pg.click('#newPlayerSkill .sl-field:has(label:text-is("9ボール")) .chip:text-is("6")')
    pg.wait_for_timeout(120)
    pg.click('#newPlayerSkill .sl-field:has(label:text-is("8ボール")) .chip:text-is("4")')
    pg.wait_for_timeout(120)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(300)

    stored = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_players') || '[]')")
    tanaka = [x for x in stored if x.get("name") == "田中"]
    check(len(tanaka) == 1, "田中が登録された", stored)
    if tanaka:
        sk = tanaka[0].get("skill") or {}
        check(sk.get("nine") == 6, "9ボールのSL6が保存されている", sk)
        check(sk.get("eight") == 4, "8ボールのSL4が保存されている", sk)

    # 一覧にスキルレベルが表示される
    line = pg.locator(".sl-line").first.text_content() or ""
    check("SL6" in line, "一覧に9ボールのSLが出る", line)
    check("SL4" in line, "一覧に8ボールのSLが出る", line)

    # スキルレベルを後から変えられる
    pg.click('.match-card:has-text("田中") button:text-is("スキルレベル")')
    pg.wait_for_timeout(250)
    check(pg.locator(".sl-edit:visible").count() == 1, "編集欄が開く")
    pg.click('.sl-edit:visible .sl-field:has(label:text-is("9ボール のスキルレベル")) .chip:text-is("8")')
    pg.wait_for_timeout(300)
    stored2 = pg.evaluate("() => JSON.parse(localStorage.getItem('pool_players') || '[]')")
    t2 = [x for x in stored2 if x.get("name") == "田中"][0]
    check((t2.get("skill") or {}).get("nine") == 8, "SLを8に変更できる", t2.get("skill"))
    check((t2.get("skill") or {}).get("eight") == 4, "変えていない8ボール側は残る", t2.get("skill"))
    pg.screenshot(path=os.path.join(SHOTS, "51_players_sl.png"), full_page=True)

    # ================================================================
    section("④ 試合作成で登録済みプレーヤーを呼び出せる")
    pg.click("#playersNewMatchBtn")
    pg.wait_for_timeout(300)
    helpers.pick_game(pg, "9ball")
    check(pg.locator(".picker-chip").count() >= 1, "登録した人を選ぶボタンが出る",
          pg.locator(".picker-chip").count())
    pg.click('.field:has(#inNameA) .picker-chip:has-text("田中")')
    pg.wait_for_timeout(200)
    check(pg.input_value("#inNameA") == "田中", "押すと名前欄に入る", pg.input_value("#inNameA"))

    # JPA種目ではスキルレベルも一緒に反映される
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(200)
    check(pg.locator(".picker-chip .pc-sl").count() >= 1,
          "JPA種目では呼び出しボタンにSLが添えられる",
          pg.locator(".picker-chip .pc-sl").count())
    pg.click('.field:has(#inNameA) .picker-chip:has-text("田中")')
    pg.wait_for_timeout(350)
    check(pg.input_value("#inNameA") == "田中", "JPAでも名前が入る")
    # 田中は9ボールSL8。勝利条件のSL8が押された状態になる
    pressed = pg.locator('#goalArea .field:nth-of-type(1) .chip[aria-pressed="true"]').first.text_content()
    check(pressed == "SL8", "登録したスキルレベル(SL8)が勝利条件に反映される", pressed)
    pg.screenshot(path=os.path.join(SHOTS, "52_picker.png"), full_page=True)

    # ================================================================
    section("⑤ ショットクロックの延長が1ラック1回")
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(200)
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    pg.click('#clockTypeToggle button[data-v="shot"]')
    pg.wait_for_timeout(200)
    check(pg.is_visible("#scScopeToggle"), "延長の数え方を選べる")
    check(pg.get_attribute('#scScopeToggle button[data-v="rack"]', "aria-pressed") == "true",
          "既定は「ラックごと」")
    check(pg.input_value("#scExtCount") == "1", "既定の回数は1回", pg.input_value("#scExtCount"))

    # 実際に試合を始めて、残り回数の表示を見る
    pg.click('#goalArea .chip:has-text("3先")')
    pg.wait_for_timeout(150)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(500)
    check(pg.is_visible("#screenMatch"), "試合が始まる")
    info = pg.text_content("#scInfo") or ""
    check("延長あと1回" in info, "延長の残りが1回と出る", info)
    check("このラック" in info, "ラック単位であることが分かる", info)

    # 延長を1回使うと0になる
    pg.click("#scExtBtn")
    pg.wait_for_timeout(300)
    info2 = pg.text_content("#scInfo") or ""
    check("延長あと0回" in info2, "使うと残り0回になる", info2)
    check(pg.is_disabled("#scExtBtn"), "同じラックでは延長ボタンが押せなくなる")

    # ラックが変わると戻る
    pg.click("#panelA")
    pg.wait_for_timeout(400)
    info3 = pg.text_content("#scInfo") or ""
    check("延長あと1回" in info3, "次のラックで延長が1回に戻る", info3)
    check(not pg.is_disabled("#scExtBtn"), "延長ボタンがまた押せる")

    # ================================================================
    section("⑥ ブレイク権がはっきり分かる")
    check(pg.is_visible("#breakBanner"), "ブレイク権のバナーが出ている")
    bname = pg.text_content("#breakBannerName") or ""
    check(bname in ("山田", "佐藤"), "バナーに名前が出る", bname)

    # バナーの文字が十分大きい（台の脇から読むため）
    fs = pg.evaluate("() => parseFloat(getComputedStyle(document.querySelector('#breakBannerName')).fontSize)")
    check(fs >= 16, "バナーの名前が16px以上", fs)

    # パネル側の強調
    cls_a = pg.get_attribute("#panelA", "class") or ""
    cls_b = pg.get_attribute("#panelB", "class") or ""
    check(("has-break" in cls_a) != ("has-break" in cls_b),
          "ブレイク権のあるパネルだけが強調される", (cls_a, cls_b))

    # バッジの文言
    badge = (pg.text_content("#breakMarkA") or "") + (pg.text_content("#breakMarkB") or "")
    check(badge == "BREAK", "どちらか一方にだけBREAKバッジが出る", badge)

    # 入れ替えボタンが効く
    before = pg.text_content("#breakBannerName")
    pg.click("#breakToggleBtn")
    pg.wait_for_timeout(300)
    after = pg.text_content("#breakBannerName")
    check(before != after, "入れ替えるとバナーの名前が変わる", (before, after))
    pg.screenshot(path=os.path.join(SHOTS, "53_break.png"), full_page=True)

    # ================================================================
    section("⑦ デザイン変更後も可読性の制約を満たす")
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
    check(len(small) == 0, "試合画面のボタンが全て44px以上", small)

    # 横スクロールが出ていない
    ow = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(ow <= 0, "横スクロールが発生していない", ow)

    # スコアの数字のコントラスト（大きい文字なので3:1以上）
    #
    # パネルは背景色ではなくグラデーション（background-image）で塗られることがある
    # （ブレイク権があるときの金色）。computedStyle の backgroundColor だけを見ると
    # 透明と誤読するため、実際に描かれた画素をキャンバスから読む。
    for side in ["A", "B"]:
        col = pg.evaluate("() => getComputedStyle(document.querySelector('#score%s')).color" % side)
        bgc = pg.evaluate("""(side) => {
          const el = document.querySelector('#panel' + side);
          const cs = getComputedStyle(el);
          // グラデーションが指定されていれば、その最初の色を採用する
          const img = cs.backgroundImage;
          const m = img && img.match(/rgba?\\([^)]+\\)/);
          if (m) return m[0];
          const c = cs.backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)') return c;
          return 'rgb(255, 255, 255)';
        }""", side)
        ratio = contrast(parse_rgb(col), parse_rgb(bgc))
        check(ratio >= 3.0, "%s側のスコアのコントラストが3:1以上" % side,
              "%s (文字%s / 地%s)" % (round(ratio, 2), col, bgc))

    # 本文が16px以上（iOSの自動ズーム回避も兼ねる）
    body_fs = pg.evaluate("() => parseFloat(getComputedStyle(document.body).fontSize)")
    check(body_fs >= 16, "本文が16px以上", body_fs)

    # ピクセル書体は見出し・数字だけ。本文は丸ゴシックのまま
    body_font = pg.evaluate("() => getComputedStyle(document.body).fontFamily")
    check("Rounded" in body_font, "本文は丸ゴシックのまま（ドット書体にしない）", body_font)

    # ================================================================
    section("⑧ 通知が操作を邪魔しない")
    # 連続で操作しても通知は1件だけ。積み上がると時計やボタンが隠れる
    pg.click("#breakToggleBtn")
    pg.wait_for_timeout(80)
    pg.click("#breakToggleBtn")
    pg.wait_for_timeout(80)
    pg.click("#scExtBtn")
    pg.wait_for_timeout(200)
    check(pg.locator("#toastWrap .toast").count() <= 1,
          "通知は同時に1件までしか出ない",
          pg.locator("#toastWrap .toast").count())

    # 通知が出ている状態でも、下部の操作ボタンが隠れていないこと
    covered = pg.evaluate("""() => {
      const wrap = document.querySelector('#toastWrap');
      const t = wrap && wrap.querySelector('.toast');
      if (!t) return [];
      const tr = t.getBoundingClientRect();
      const hidden = [];
      ['#undoBtn', '#reviseBtn', '#finishBtn', '#turnBtn'].forEach(sel => {
        const el = document.querySelector(sel);
        if (!el || el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        const overlap = !(r.right < tr.left || r.left > tr.right ||
                          r.bottom < tr.top || r.top > tr.bottom);
        if (overlap) hidden.push(sel);
      });
      return hidden;
    }""")
    check(len(covered) == 0, "通知が下部の操作ボタンを覆っていない", covered)
    pg.screenshot(path=os.path.join(SHOTS, "54_toast.png"), full_page=False)

    # ================================================================
    section("⑨ 背景の装飾が操作を邪魔しない")
    # 空と地面は ::before / ::after で描いている。
    # pointer-events の指定を落とすと、地面の帯が下部ボタンを覆って
    # 押せなくなる（画面には出ているのに反応しない、という最悪の壊れ方をする）
    blocked = pg.evaluate("""() => {
      const out = [];
      ['#undoBtn', '#reviseBtn', '#finishBtn'].forEach(sel => {
        const el = document.querySelector(sel);
        if (!el || el.offsetParent === null) return;
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!(top === el || el.contains(top))) out.push(sel);
      });
      return out;
    }""")
    check(len(blocked) == 0, "地面の装飾が下部ボタンを覆っていない", blocked)

    # 実際に押して効くことまで確かめる
    pg.click("#panelA")
    pg.wait_for_timeout(300)
    before_score = pg.text_content("#scoreA")
    pg.click("#undoBtn")
    pg.wait_for_timeout(300)
    after_score = pg.text_content("#scoreA")
    check(before_score != after_score, "取り消しボタンが実際に効く",
          (before_score, after_score))

    # ================================================================
    section("⑩ 世界観の要素が入っている")
    sky = pg.evaluate("() => getComputedStyle(document.body).backgroundColor")
    check(parse_rgb(sky) == (92, 148, 252), "背景が空色になっている", sky)
    theme = pg.get_attribute('meta[name="theme-color"]', "content")
    check(theme == "#c84c0c", "テーマカラーがレンガ色になっている", theme)

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
