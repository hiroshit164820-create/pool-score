# -*- coding: utf-8 -*-
"""
browser_test.py — 実ブラウザでの通し検証

初見のユーザーとして「試合作成 → 記録 → 訂正 → 終了 → 履歴」を完走できるかを確認する。
実行: python _test/browser_test.py
"""
import sys
import io
import os
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
SHOT_DIR = os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOT_DIR, exist_ok=True)

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    mark = "OK  " if cond else "NG  "
    print(mark + label + (("  -> " + str(detail)) if detail and not cond else ""))


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # iPhone相当の画面で確認する（実際に使うのはスマホのため）
        page = browser.new_page(viewport={"width": 390, "height": 844})

        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(URL)
        page.wait_for_timeout(400)

        # ---------- 初期表示 ----------
        check(page.is_visible("#screenSetup"), "起動時に試合作成画面が出る")
        # 種目はカテゴリに畳まれている。全部開いたときに9種目選べること
        check(helpers.count_selectable_games(page) == 11, "種目が11選べる（通常8＋JPA3）",
              helpers.count_selectable_games(page))
        check(page.is_visible("#startMatchBtn"), "開始ボタンが見えている")
        page.screenshot(path=os.path.join(SHOT_DIR, "01_setup.png"), full_page=True)

        # ---------- 種目ごとのボタン出し分け ----------
        helpers.pick_game(page, "10ball")
        page.wait_for_timeout(150)
        note = page.text_content("#gameNote") or ""
        check("ブレイクエース" in note, "10ボールでブレイクエースなしの注意が出る", note)
        check("セーフティコール" in note, "10ボールでセーフティ廃止の注意が出る", note)
        check(
            page.get_attribute('#breakTypeToggle button[data-v="alternate"]', "aria-pressed") == "true",
            "10ボールの既定はオルタネート",
        )

        helpers.pick_game(page, "9ball")
        page.wait_for_timeout(150)
        check(
            page.get_attribute('#breakTypeToggle button[data-v="winner"]', "aria-pressed") == "true",
            "9ボールの既定はウィナーズ",
        )

        # ---------- 入力 ----------
        page.fill("#inNameA", "山田")
        page.fill("#inNameB", "佐藤")

        # ハンデあり（4先 vs 2先）
        # 3〜7先はボタン、それ以外はプルダウンから選ぶ
        helpers.set_handicap_mode(page, True)
        helpers.set_goal(page, 4, side="A")
        helpers.set_goal(page, 2, side="B")

        # ショットクロックを使う
        page.click('#clockTypeToggle button[data-v="shot"]')
        page.wait_for_timeout(150)
        check(page.is_visible("#scSeconds"), "ショットクロックONで詳細設定が出る")
        page.fill("#scSeconds", "30")
        page.fill("#scWarn", "10")
        page.screenshot(path=os.path.join(SHOT_DIR, "02_setup_filled.png"), full_page=True)

        page.click("#startMatchBtn")
        page.wait_for_timeout(400)

        # ---------- 試合画面 ----------
        check(page.is_visible("#screenMatch"), "試合画面に移る")
        check(page.text_content("#nameA") == "山田", "Aの名前が出ている")
        check(page.text_content("#nameB") == "佐藤", "Bの名前が出ている")
        check("4" in (page.text_content("#targetA") or ""), "Aの目標4が出ている")
        check("2" in (page.text_content("#targetB") or ""), "Bの目標2が出ている")
        sub = page.text_content("#matchSubtitle") or ""
        check("ハンデ戦" in sub, "ハンデ戦と表示される", sub)
        check("ウィナーズ" in sub, "ブレイク方式が表示される", sub)

        # ブレイク権の表示。3か所（パネルのバッジ・パネルの強調・バナー）で示す
        check(page.text_content("#breakMarkA") == "BREAK", "Aにブレイク権バッジが出ている",
              page.text_content("#breakMarkA"))
        check(page.text_content("#breakMarkB") == "", "Bにはバッジが出ていない")
        check("has-break" in (page.get_attribute("#panelA", "class") or ""),
              "Aのパネルがブレイク権ありとして強調される")
        check("has-break" not in (page.get_attribute("#panelB", "class") or ""),
              "Bのパネルは強調されない")
        # ブレイク権はパネル内の BREAK 札で示す。
        # 帯を別に出すと場所を取ってスコアが小さくなるため出さない（本人指摘）
        check(page.text_content("#breakMarkA") == "BREAK",
              "ブレイク権のある側のパネルに BREAK の札が出る",
              page.text_content("#breakMarkA"))
        check(page.text_content("#breakMarkB") == "",
              "反対側には出ない", page.text_content("#breakMarkB"))
        btxt = page.text_content("#breakToggleBtn") or ""
        check("山田" in btxt, "ブレイク権が名前で表示される", btxt)

        # ショットクロック表示
        check(page.is_visible("#shotClockBar"), "ショットクロックが表示される")

        # スコア欄がタップできること・文字が十分大きいこと
        check(page.is_visible("#panelA"), "スコア欄がボタンになっている")
        font_px = page.evaluate(
            "() => parseFloat(getComputedStyle(document.querySelector('#scoreA')).fontSize)"
        )
        check(font_px >= 60, "スコアの文字が60px以上ある", round(font_px))
        panel_h = page.evaluate(
            "() => Math.round(document.querySelector('#panelA').getBoundingClientRect().height)"
        )
        check(panel_h >= 120, "スコア欄のタップ領域が120px以上ある", panel_h)

        # 種目別ボタン。
        # マスワリ・ブレイクエースはブレイク権のある側のパネル内、
        # セーフティは人ごとの回数カウントに分かれている
        panel_flags = page.locator(".panel-flags button").all_text_contents()
        check("マスワリ" in panel_flags, "マスワリボタンがある", panel_flags)
        check("ブレイクエース" in panel_flags, "ブレイクエースボタンがある", panel_flags)
        check(page.locator(".safety-btn").count() == 2,
              "セーフティが人ごとに2つある", page.locator(".safety-btn").count())
        page.screenshot(path=os.path.join(SHOT_DIR, "03_match.png"), full_page=True)

        # ---------- 記録 ----------
        # マスワリのボタンは、ブレイク権のある側のスコアパネルの中にある。
        # 押した時点でラック取得まで記録される（本人指示9・その後の指示で位置を変更）
        page.click('#panelFlagsA button:has-text("マスワリ")')
        page.wait_for_timeout(400)
        check(page.text_content("#scoreA") == "1", "マスワリを押すとAが1ラック取る")
        # 勝者ブレイクなのでブレイク権はAのまま
        check(page.text_content("#breakMarkA") == "BREAK", "勝者ブレイク: Aがブレイク継続")

        # Bが1ラック取る → ブレイク権がBに移る
        page.click("#panelB")
        page.wait_for_timeout(300)
        check(page.text_content("#scoreB") == "1", "Bが1ラック取った")
        check(page.text_content("#breakMarkB") == "BREAK", "勝者ブレイク: ブレイク権がBに移る")

        # ---------- 取り消し ----------
        page.click("#undoBtn")
        page.wait_for_timeout(300)
        check(page.text_content("#scoreB") == "0", "取り消しでBのスコアが戻る")
        check(page.text_content("#breakMarkA") == "BREAK", "取り消しでブレイク権も戻る")

        # ---------- ブレイク権の手動切替 ----------
        page.click("#breakToggleBtn")
        page.wait_for_timeout(300)
        check(page.text_content("#breakMarkB") == "BREAK", "ブレイク権を手で切り替えられる")
        page.click("#breakToggleBtn")
        page.wait_for_timeout(300)
        check(page.text_content("#breakMarkA") == "BREAK", "もう一度押すと戻る")

        # ---------- 訂正画面 ----------
        page.click("#reviseBtn")
        page.wait_for_timeout(300)
        check(page.is_visible("#reviseModal"), "訂正画面が開く")
        ev_count = page.locator("#evList .ev-item").count()
        check(ev_count > 0, "記録の一覧が出る", ev_count)
        voided = page.locator("#evList .ev-item.voided").count()
        check(voided > 0, "取り消した記録も残っている（規程要件）", voided)
        page.screenshot(path=os.path.join(SHOT_DIR, "04_revise.png"), full_page=True)
        page.click("#closeReviseBtn")
        page.wait_for_timeout(200)

        # ---------- 決着まで記録 ----------
        # Aはあと3ラックで勝ち（目標4）
        for _ in range(3):
            page.click("#panelA")
            page.wait_for_timeout(250)

        check(page.is_visible("#finishModal"), "目標到達で終了確認が出る")
        summary = page.text_content("#finishSummary") or ""
        check("山田" in summary and "勝ち" in summary, "勝者が表示される", summary)
        page.screenshot(path=os.path.join(SHOT_DIR, "05_finish.png"), full_page=True)

        # 決着後はスコアをタップしても増えない
        page.click("#cancelFinishBtn")
        page.wait_for_timeout(200)
        before = page.text_content("#scoreA")
        check(page.get_attribute("#panelA", "disabled") is not None, "決着後はスコア欄を押せない")
        hint = page.text_content("#tapHint") or ""
        check("終了" in hint, "決着後は案内文が変わる", hint)
        page.click("#finishBtn")
        page.wait_for_timeout(200)
        check(page.text_content("#scoreA") == before, "決着後にスコアが増えていない")

        page.click("#confirmFinishBtn")
        page.wait_for_timeout(400)

        # ---------- 履歴 ----------
        check(page.is_visible("#screenHistory"), "終了後は履歴画面に移る")
        cards = page.locator(".match-card").count()
        check(cards == 1, "履歴に1件記録されている", cards)
        card_text = page.text_content(".match-card") or ""
        check("山田" in card_text and "佐藤" in card_text, "履歴に名前が出る")
        check("4 - 0" in card_text or "4-0" in card_text.replace(" ", ""), "スコアが出る", card_text)
        page.screenshot(path=os.path.join(SHOT_DIR, "06_history.png"), full_page=True)

        # ---------- 保存の永続性 ----------
        page.reload()
        page.wait_for_timeout(500)
        stored = page.evaluate("() => Object.keys(localStorage).filter(k => k.indexOf('pool_') === 0).length")
        check(stored >= 2, "リロード後もデータが残っている", stored)

        # 保存された内容の検証
        idx = page.evaluate("() => JSON.parse(localStorage.getItem('pool_matches_index') || '[]')")
        check(len(idx) == 1, "索引に1件ある", len(idx))
        if idx:
            check(idx[0].get("finished") is True, "確定済みとして保存されている")
            check(idx[0].get("winner") == "A", "勝者が保存されている", idx[0].get("winner"))

        mid = idx[0]["id"] if idx else None
        if mid:
            m = page.evaluate("(id) => JSON.parse(localStorage.getItem('pool_match_' + id))", mid)
            check(m.get("result") is not None, "サマリが保存されている")
            check(m["result"]["perSide"]["A"]["masuwari"] == 1, "マスワリが記録されている",
                  m["result"]["perSide"]["A"]["masuwari"])
            # 取り消した記録が消えずに残っているか
            voided_events = [e for e in m["events"] if e.get("voided")]
            check(len(voided_events) > 0, "取り消した記録が保存データにも残る", len(voided_events))
            void_events = [e for e in m["events"] if e.get("t") == "VOID"]
            check(len(void_events) > 0, "VOIDイベントが記録されている", len(void_events))

        # ---------- ダブルスの確認 ----------
        # リロード後は試合作成画面に戻っている（履歴へは上部ボタンで行ける）
        check(page.is_visible("#screenSetup"), "リロード後は試合作成画面に戻る")
        page.click("#toHistoryBtn")
        page.wait_for_timeout(300)
        check(page.is_visible("#screenHistory"), "履歴ボタンで履歴画面に行ける")
        check(page.locator(".match-card").count() == 1, "リロード後も履歴に記録が残っている")

        # ---------- 削除は確認が出る（取り消せない操作） ----------
        page.once("dialog", lambda d: d.dismiss())
        page.click('.match-card button:has-text("削除")')
        page.wait_for_timeout(300)
        check(page.locator(".match-card").count() == 1, "確認でキャンセルすると削除されない")
        page.click("#newMatchBtn")
        page.wait_for_timeout(300)
        helpers.pick_game(page, "9ball_doubles")
        page.wait_for_timeout(250)
        # 2人目は最初から出さず、1人目が決まってから出す
        check(page.locator("#inNameA2").count() == 0,
              "ダブルスでも2人目の欄は最初は出ない")
        check(page.locator(".team-field:has(#inNameA) .add-member").count() == 1,
              "「2人目を選ぶ」ボタンが出ている")
        page.fill("#inNameA", "山田")
        page.wait_for_timeout(300)
        check(page.is_visible("#inNameA2"), "1人目を入れると2人目の欄が出る")

        # ---------- 10ボールでボタンが減ることの確認 ----------
        helpers.pick_game(page, "10ball")
        page.wait_for_timeout(200)
        page.fill("#inNameA", "田中")
        page.fill("#inNameB", "鈴木")
        page.click("#startMatchBtn")
        page.wait_for_timeout(400)
        labels10 = page.locator(".panel-flags button").all_text_contents()
        check("ブレイクエース" not in labels10, "10ボールにブレイクエースボタンが出ない", labels10)
        check(page.locator(".safety-btn").count() == 0,
              "10ボールにセーフティは出ない（規程で廃止）", page.locator(".safety-btn").count())
        check("マスワリ" in labels10, "10ボールでもマスワリはある", labels10)
        check(not page.is_visible("#shotClockBar"), "ショットクロックOFFなら表示されない")
        page.screenshot(path=os.path.join(SHOT_DIR, "07_10ball.png"), full_page=True)

        # ---------- 14-1（球1個=1点・減点あり） ----------
        # 中断すると設定画面に戻る（履歴を経由しない）
        page.click("#quitMatchBtn")
        page.wait_for_timeout(400)
        page.wait_for_timeout(300)
        helpers.pick_game(page, "straight")
        page.wait_for_timeout(250)

        goal_default = helpers.goal_value(page)
        check(goal_default == 50, "14-1の既定は50点先取", goal_default)

        page.fill("#inNameA", "高橋")
        page.fill("#inNameB", "伊藤")
        page.click("#startMatchBtn")
        page.wait_for_timeout(400)

        hint141 = page.text_content("#tapHint") or ""
        check("球を入れたら" in hint141, "14-1は球単位の案内文になる", hint141)

        labels141 = page.locator("#flagButtons button").all_text_contents()
        check(any("ファウル" in l for l in labels141), "14-1にはファウルボタンが出る", labels141)
        check(page.locator(".panel-flags button").count() == 0,
              "14-1にマスワリは出ない", page.locator(".panel-flags button").count())

        # 球を3個入れる → 3点
        for _ in range(3):
            page.click("#panelA")
            page.wait_for_timeout(200)
        check(page.text_content("#scoreA") == "3", "3球で3点", page.text_content("#scoreA"))

        # ファウルで1点減点
        page.click('#flagButtons button:has-text("高橋 ファウル")')
        page.wait_for_timeout(300)
        check(page.text_content("#scoreA") == "2", "ファウルで1点減点される", page.text_content("#scoreA"))

        # 取り消しで戻る
        page.click("#undoBtn")
        page.wait_for_timeout(300)
        check(page.text_content("#scoreA") == "3", "減点も取り消せる", page.text_content("#scoreA"))
        page.screenshot(path=os.path.join(SHOT_DIR, "12_straight.png"), full_page=True)

        # ---------- タップ領域の確認 ----------
        small = page.evaluate("""() => {
            const out = [];
            document.querySelectorAll('#screenMatch button').forEach(b => {
                const r = b.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && r.height < 44) {
                    out.push(b.textContent.trim().slice(0,12) + ':' + Math.round(r.height));
                }
            });
            return out;
        }""")
        check(len(small) == 0, "試合画面のボタンが全て44px以上", small)

        # ---------- 横スクロールが出ていないか ----------
        overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
        check(not overflow, "横スクロールが発生していない")

        # ---------- コンソールエラー ----------
        real_errors = [e for e in errors if "favicon" not in e.lower()]
        check(len(real_errors) == 0, "JavaScriptエラーが出ていない", real_errors[:3])

        browser.close()


run()

print("\n" + "=" * 44)
ok = sum(1 for r in results if r[0])
ng = len(results) - ok
print("成功: %d / 失敗: %d" % (ok, ng))
if ng:
    print("\n【失敗した項目】")
    for good, label, detail in results:
        if not good:
            print("  - " + label + ("  -> " + str(detail) if detail else ""))
    sys.exit(1)
else:
    print("すべて成功")
    print("スクリーンショット: _test/shots/")
