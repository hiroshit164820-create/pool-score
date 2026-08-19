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
        check(page.locator("#gameChips .chip").count() == 5, "種目が5つ出ている（Phase1.0）")
        check(page.is_visible("#startMatchBtn"), "開始ボタンが見えている")
        page.screenshot(path=os.path.join(SHOT_DIR, "01_setup.png"), full_page=True)

        # ---------- 種目ごとのボタン出し分け ----------
        page.click('#gameChips .chip[data-game="10ball"]')
        page.wait_for_timeout(150)
        note = page.text_content("#gameNote") or ""
        check("ブレイクエース" in note, "10ボールでブレイクエースなしの注意が出る", note)
        check("セーフティコール" in note, "10ボールでセーフティ廃止の注意が出る", note)
        check(
            page.get_attribute('#breakTypeToggle button[data-v="alternate"]', "aria-pressed") == "true",
            "10ボールの既定はオルタネート",
        )

        page.click('#gameChips .chip[data-game="9ball"]')
        page.wait_for_timeout(150)
        check(
            page.get_attribute('#breakTypeToggle button[data-v="winner"]', "aria-pressed") == "true",
            "9ボールの既定はウィナーズ",
        )

        # ---------- 入力 ----------
        page.fill("#inNameA", "山田")
        page.fill("#inNameB", "佐藤")

        # ハンデあり（4先 vs 2先）
        page.click('#goalArea .toggle-group button[data-v="handicap"]')
        page.wait_for_timeout(150)
        page.fill("#goalA", "4")
        page.fill("#goalB", "2")

        # ショットクロックを使う
        page.click('#scEnableToggle button[data-v="on"]')
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

        # ブレイク権の表示
        check(page.text_content("#breakMarkA") == "●", "Aにブレイク権マークが出ている")
        check(page.text_content("#breakMarkB") == "", "Bにはマークが出ていない")
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

        # 種目別ボタン（9ボールなので3つとも出る）
        flag_labels = page.locator("#flagButtons button").all_text_contents()
        check("マスワリ" in flag_labels, "マスワリボタンがある", flag_labels)
        check("ブレイクエース" in flag_labels, "ブレイクエースボタンがある", flag_labels)
        check("セーフティ" in flag_labels, "セーフティボタンがある", flag_labels)
        page.screenshot(path=os.path.join(SHOT_DIR, "03_match.png"), full_page=True)

        # ---------- 記録 ----------
        # マスワリ付きでAが1ラック取る
        page.click('#flagButtons button:has-text("マスワリ")')
        page.wait_for_timeout(100)
        page.click("#panelA")
        page.wait_for_timeout(300)
        check(page.text_content("#scoreA") == "1", "Aが1ラック取った")
        # 勝者ブレイクなのでブレイク権はAのまま
        check(page.text_content("#breakMarkA") == "●", "勝者ブレイク: Aがブレイク継続")

        # Bが1ラック取る → ブレイク権がBに移る
        page.click("#panelB")
        page.wait_for_timeout(300)
        check(page.text_content("#scoreB") == "1", "Bが1ラック取った")
        check(page.text_content("#breakMarkB") == "●", "勝者ブレイク: ブレイク権がBに移る")

        # ---------- 取り消し ----------
        page.click("#undoBtn")
        page.wait_for_timeout(300)
        check(page.text_content("#scoreB") == "0", "取り消しでBのスコアが戻る")
        check(page.text_content("#breakMarkA") == "●", "取り消しでブレイク権も戻る")

        # ---------- ブレイク権の手動切替 ----------
        page.click("#breakToggleBtn")
        page.wait_for_timeout(300)
        check(page.text_content("#breakMarkB") == "●", "ブレイク権を手で切り替えられる")
        page.click("#breakToggleBtn")
        page.wait_for_timeout(300)
        check(page.text_content("#breakMarkA") == "●", "もう一度押すと戻る")

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
        page.click('#gameChips .chip[data-game="9ball_doubles"]')
        page.wait_for_timeout(250)
        check(page.is_visible("#inNameA2"), "ダブルスでは2人目の入力欄が出る")

        # ---------- 10ボールでボタンが減ることの確認 ----------
        page.click('#gameChips .chip[data-game="10ball"]')
        page.wait_for_timeout(200)
        page.fill("#inNameA", "田中")
        page.fill("#inNameB", "鈴木")
        page.click("#startMatchBtn")
        page.wait_for_timeout(400)
        labels10 = page.locator("#flagButtons button").all_text_contents()
        check("ブレイクエース" not in labels10, "10ボールにブレイクエースボタンが出ない", labels10)
        check("セーフティ" not in labels10, "10ボールにセーフティボタンが出ない", labels10)
        check("マスワリ" in labels10, "10ボールでもマスワリはある", labels10)
        check(not page.is_visible("#shotClockBar"), "ショットクロックOFFなら表示されない")
        page.screenshot(path=os.path.join(SHOT_DIR, "07_10ball.png"), full_page=True)

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
