# -*- coding: utf-8 -*-
"""
helpers.py — 検証スクリプトで共通に使う操作

種目の選び方はUIの作りに依存する（カテゴリ折りたたみ＋ダブルス切替）。
各テストに同じ手順を書き写すと、UIを変えたときに全部直すことになるため
ここに1か所だけ置く。
"""
import re


# 種目IDと、それが入っているカテゴリの対応。
# ui_setup.js の GAME_GROUPS と揃える
GROUP_OF = {
    "9ball": "standard",
    "9ball_doubles": "standard",
    "10ball": "standard",
    "10ball_doubles": "standard",
    "8ball": "standard",
    "rotation": "standard",
    "straight": "standard",
    "bowlard": "standard",
    "jpa_9ball": "jpa",
    "jpa_9ball_doubles": "jpa",
    "jpa_8ball": "jpa",
    "kailun": "house",
}

# カテゴリの並び順（ui_setup.js の GAME_GROUPS と揃える）
GROUP_ORDER = ["standard", "jpa", "house"]

# ダブルス種目と、その親（シングルス）の対応
PARENT_OF = {
    "9ball_doubles": "9ball",
    "10ball_doubles": "10ball",
    "jpa_9ball_doubles": "jpa_9ball",
}

# 画面に出る種目の総数（よく使う欄を除いた、カテゴリ内の実数）
ALL_GAME_IDS = list(GROUP_OF.keys())


def goto_setup(page):
    """種目の画面を出す。

    2026-08-22 に起動時の画面がホームに変わった（本人の指示）ため、
    種目を選ぶ前にはこの一手が要る。すでに種目の画面ならそのまま。
    """
    if page.is_visible("#screenSetup"):
        return
    page.click("#tabSetup")
    page.wait_for_timeout(300)


def open_group(page, group_key):
    """カテゴリを開く。すでに開いていれば何もしない"""
    goto_setup(page)
    head = page.locator('.group-head').nth(GROUP_ORDER.index(group_key))
    if head.get_attribute("aria-expanded") != "true":
        head.click()
        page.wait_for_timeout(120)


def pick_game(page, game_id):
    """
    種目を選ぶ。

    ダブルス種目は「親種目の行のダブルス切替」を押して選ぶ作りなので、
    そこまで含めてここで面倒を見る。
    """
    parent = PARENT_OF.get(game_id)
    target_row_game = parent or game_id
    open_group(page, GROUP_OF[game_id])

    if parent:
        # ダブルス切替を押す（押すと親種目のダブルス版が選ばれる）
        sel = '.game-row:has(.game-pick[data-game="%s"]) .doubles-toggle' % target_row_game
        if page.get_attribute(sel, "aria-pressed") != "true":
            page.click(sel)
    else:
        # シングルスを選ぶ。ダブルスがONなら先に外す
        toggle = '.game-row:has(.game-pick[data-game="%s"]) .doubles-toggle' % game_id
        if page.locator(toggle).count() and page.get_attribute(toggle, "aria-pressed") == "true":
            page.click(toggle)
            page.wait_for_timeout(120)
        page.click('.game-pick[data-game="%s"]' % game_id)

    page.wait_for_timeout(150)


# カテゴリは同時に1つしか開かない作り（開くと他が閉じる）。
# そのため「全部開いて数える」ことはできず、1つずつ開いて足し上げる。


def each_group_open(page):
    """カテゴリを1つずつ開きながら、そのインデックスを返す"""
    goto_setup(page)
    heads = page.locator(".group-head")
    for i in range(heads.count()):
        h = page.locator(".group-head").nth(i)
        if h.get_attribute("aria-expanded") != "true":
            h.click()
            page.wait_for_timeout(120)
        yield i


def visible_game_labels(page):
    """いま開いているカテゴリに出ている種目名"""
    return page.locator(".game-pick .gp-name").all_text_contents()


def all_game_labels(page):
    """全カテゴリを順に開いて集めた種目名（ダブルスは含まない）"""
    out = []
    for _ in each_group_open(page):
        out.extend(visible_game_labels(page))
    return out


def count_game_rows(page):
    """種目の行数（シングルスの数）"""
    total = 0
    for _ in each_group_open(page):
        total += page.locator(".game-pick").count()
    return total


def count_selectable_games(page):
    """
    ダブルスも含めた、選べる種目の総数。
    行数（シングルス）＋ダブルス切替の数で数える。
    """
    total = 0
    for _ in each_group_open(page):
        total += page.locator(".game-pick").count() + page.locator(".doubles-toggle").count()
    return total


def open_add_player(page):
    """
    選手登録フォームを開く。

    一覧を主役にするため、ふだんは畳んである。
    登録すると自動で閉じるので、続けて登録するときは毎回呼ぶ。
    """
    body = page.locator("#addPlayerBody")
    if body.get_attribute("hidden") is not None:
        page.click("#toggleAddPlayerBtn")
        page.wait_for_timeout(150)


def add_player(page, name, skill_nine=None, skill_eight=None):
    """選手を1人登録する（スキルレベルは任意）"""
    open_add_player(page)
    page.fill("#newPlayerName", name)
    page.wait_for_timeout(120)
    if skill_nine is not None:
        page.click('#newPlayerSkill .sl-field:has(label:text-is("9ボール")) .chip:text-is("%d")'
                   % skill_nine)
        page.wait_for_timeout(100)
    if skill_eight is not None:
        page.click('#newPlayerSkill .sl-field:has(label:text-is("8ボール")) .chip:text-is("%d")'
                   % skill_eight)
        page.wait_for_timeout(100)
    page.click("#addPlayerBtn")
    page.wait_for_timeout(250)


def set_goal(page, value, side=None):
    """
    勝利条件を設定する。

    ボタンに出ている値（ラック先取は3〜7先、点数先取は種目ごとの既定値）は
    ボタンを押し、それ以外はプルダウンから選ぶ。
    side を渡すとハンデありのときの片側だけを設定する
    （A なら1つ目、B なら2つ目の goal-picker）。
    """
    if side is None:
        scope = "#goalArea .goal-picker"
        picker = page.locator(scope).first
    else:
        idx = 0 if side == "A" else 1
        picker = page.locator("#goalArea .goal-picker").nth(idx)

    # ボタンの文字はラック先取なら「5先」、点数先取なら「50点先取」。
    # どちらも出ていない値はプルダウンから選ぶ
    for label in ('%d先' % value, '%d点先取' % value):
        btn = picker.locator('.chip:text-is("%s")' % label)
        if btn.count():
            btn.click()
            page.wait_for_timeout(200)
            return
    picker.locator("select.goal-more").select_option(str(value))
    page.wait_for_timeout(200)


def set_handicap_mode(page, on):
    """勝利条件のハンデあり/なしを切り替える"""
    v = "handicap" if on else "same"
    btn = page.locator('#goalArea .toggle-group button[data-v="%s"]' % v)
    if btn.get_attribute("aria-pressed") != "true":
        btn.click()
        page.wait_for_timeout(250)


def goal_value(page, side=None):
    """いま選ばれている勝利条件の値を読む（押されているボタン or プルダウン）"""
    idx = 0 if side in (None, "A") else 1
    picker = page.locator("#goalArea .goal-picker").nth(idx)
    pressed = picker.locator('.chip[aria-pressed="true"]')
    if pressed.count():
        # 「5先」「50点先取」のどちらの書き方でも数字だけ取り出す
        m = re.search(r"\d+", pressed.first.text_content() or "")
        return int(m.group()) if m else None
    sel = picker.locator("select.goal-more")
    v = sel.input_value()
    return int(v) if v else None


def open_second_member(page, side):
    """
    ダブルスの2人目の欄を出す。

    1人目が決まってから出す作りなので、
    「＋ 2人目を選ぶ」を押すか、1人目を入力する。
    """
    sel = "#inName%s2" % side
    if page.locator(sel).count():
        return
    btn = page.locator('.team-field:has(#inName%s) .add-member' % side)
    if btn.count():
        btn.click()
        page.wait_for_timeout(200)


def fill_doubles(page, side, name1, name2):
    """ダブルスの2人を入力する（2人目の欄を出してから入れる）"""
    page.fill("#inName%s" % side, name1)
    page.wait_for_timeout(200)
    open_second_member(page, side)
    page.fill("#inName%s2" % side, name2)
    page.wait_for_timeout(150)


def undo_last(pg):
    """いちばん新しい記録を1つ取り消す。

    「取り消し」ボタンは 2026-08-21 に削除した（本人の指示）。
    記録の取り消しは「訂正」から行う。
    """
    pg.click("#reviseBtn")
    pg.wait_for_timeout(400)
    btn = pg.locator("#evList button", has_text="取り消す")
    if btn.count():
        btn.first.click()
        pg.wait_for_timeout(500)
    pg.click("#closeReviseBtn")
    pg.wait_for_timeout(300)


def set_innings(page, on):
    """
    イニングを数えるかを選ぶ（一般種目だけに出る欄）。

    既定は「数えない」（本人の指示 2026-08-21）。
    イニングの表示を確かめるテストは、始める前にここで「数える」を選ぶ。
    """
    label = "数える" if on else "数えない"
    field = page.locator("#goalArea .field").filter(has_text="イニング").first
    if not field.count():
        return False  # 選べない種目（JPA等）は常に数えるので何もしない
    field.locator("button", has_text=label).first.click()
    page.wait_for_timeout(200)
    return True


def pick_player(page, field_index, name):
    """
    試合作成のプレーヤー欄で、登録済みの人を選ぶ。

    2026-08-21 から、選んだあとは候補を畳んで「選んだ人」だけを出すように
    なった（本人の指示）。畳んでいるときは先に「選び直す」を押す。
    """
    field = page.locator("#playerFields .field").nth(field_index)
    change = field.locator(".picker-change")
    if change.count():
        change.first.click()
        page.wait_for_timeout(200)
    field.locator(".picker-chip", has_text=name).first.click()
    page.wait_for_timeout(200)
