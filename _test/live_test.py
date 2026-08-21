# -*- coding: utf-8 -*-
"""公開URL（GitHub Pages）の実物を、スマホ相当の画面で確認する

ローカルの file:// ではなく、実際に配信されているサイトを見る。
実行: python _test/live_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

URL = "https://hiroshit164820-create.github.io/pool-score/"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "_test", "shots")

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label + (("  -> " + str(detail)) if detail and not cond else ""))


with sync_playwright() as p:
    b = p.chromium.launch()
    # iPhone相当。タッチ操作として扱う
    ctx = b.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                   "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    )
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_timeout(1200)

    check(pg.title() == "ビリヤードスコア記録", "タイトルが出る", pg.title())
    # 起動して最初に出るのはホーム（本人の指示 2026-08-22）
    check(pg.is_visible("#screenHome"), "ホームが表示される")
    helpers.goto_setup(pg)
    check(pg.is_visible("#startMatchBtn"), "試合作成画面が表示される")
    check(helpers.count_selectable_games(pg) == 14, "種目が14選べる",
          helpers.count_selectable_games(pg))
    labels = helpers.all_game_labels(pg)
    # 種目名に「（ストレートプール）」を付けた（本人の指示 2026-08-21）
    check(any(x.startswith("14-1") for x in labels), "14-1が公開版に入っている", labels)
    check(any("JPA" in x for x in labels), "JPA種目が公開版に入っている", labels)
    clocks = pg.locator("#clockTypeToggle button").all_text_contents()
    check(len(clocks) == 3, "時計が3択になっている", clocks)
    check(pg.locator("#toPlayersBtn2").count() == 1, "プレーヤー画面への導線がある")

    # PWAの要素
    manifest = pg.evaluate("() => { const l = document.querySelector('link[rel=manifest]'); return l ? l.href : null; }")
    check(manifest is not None, "マニフェストが読み込まれている")
    mres = pg.request.get(manifest)
    check(mres.ok, "マニフェストが取得できる", mres.status)
    mj = mres.json()
    check(mj.get("name") == "ビリヤードスコア記録", "アプリ名が正しい", mj.get("name"))
    check(mj.get("display") == "standalone", "ホーム画面から全画面で開く設定", mj.get("display"))

    # 書体が当たっているか（Googleフォントが読めているか）
    fam = pg.evaluate("() => getComputedStyle(document.body).fontFamily")
    check("Rounded" in fam, "丸ゴシックが指定されている", fam)
    loaded = pg.evaluate("() => document.fonts.check('700 16px \"M PLUS Rounded 1c\"')")
    check(loaded, "Webフォントが実際に読み込まれた", loaded)

    # Service Worker（オフライン対応）
    pg.wait_for_timeout(1500)
    sw = pg.evaluate("async () => { const r = await navigator.serviceWorker.getRegistrations(); return r.length; }")
    check(sw > 0, "オフライン用の仕組みが登録された", sw)

    # 実際に1試合記録できるか（タップ操作で）
    pg.fill("#inNameA", "山田")
    pg.fill("#inNameB", "佐藤")
    pg.tap("#startMatchBtn")
    pg.wait_for_timeout(600)
    check(pg.is_visible("#screenMatch"), "試合が始められる")

    pg.tap("#panelA")
    pg.wait_for_timeout(400)
    check(pg.text_content("#scoreA") == "1", "スコアをタップして加算できる", pg.text_content("#scoreA"))
    pg.screenshot(path=os.path.join(SHOTS, "20_live_match.png"))

    # 保存されるか
    saved = pg.evaluate("() => Object.keys(localStorage).filter(k => k.indexOf('pool_') === 0).length")
    check(saved > 0, "記録が端末に保存される", saved)

    # 横スクロールが出ていないか
    ov = pg.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
    check(not ov, "横スクロールが発生していない")

    real = [e for e in errs if "favicon" not in e.lower()]
    check(len(real) == 0, "エラーが出ていない", real[:3])

    pg.screenshot(path=os.path.join(SHOTS, "21_live_full.png"), full_page=True)
    ctx.close()
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
    print("公開URLで正常に動作しています")
    print(URL)
