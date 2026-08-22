# -*- coding: utf-8 -*-
"""fix_stats_test.py — 成績画面の表記直し（本人の指示 2026-08-22・成績係）

対象:
  1. 対戦相手別は「試合数の多い順」
  2. パートナー別は「勝率順」
  3. 「種目別でさらに詳しく」で、記録のある種目に色を付ける（記録なしと差がある）
  4. 項目名を「主題」と「条件（括弧の中）」の2行に分ける
  5. 値も2行（上に勝敗数、下に試合数・勝率）
  6. Aハイラン／Bハイランの（）内の説明を消す
  7. 320 / 360 / 375 / 390px で、意図しない折り返しが0件（実測）

折り返しの判定は目視ではなく座標で行う。
1つの span の getClientRects().length が2以上なら、その行は折り返している。
折り返してよい行（長い説明文・得点の履歴）は .stat-row.is-note を付けてあるので、
そこだけ「意図した折り返し」として数え、それ以外は0件でなければならない。

数字そのものは変えていない（表記と並び順だけ）ので、
この検証では「どう並び、どう改行されるか」だけを見る。

実行: python _test/fix_stats_test.py
"""
import sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOTS, exist_ok=True)

WIDTHS = [320, 360, 375, 390]

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


# 成績の集計をその場で差し替えて、全種目・全項目を画面に出す。
# 実際の試合を1つずつ作ると全項目はそろわず（種目11×条件）時間もかかるため、
# 「集計の出口」だけを固定の値に置き換えて、描画のコードは本物を通す。
SEED = r"""
() => {
  const CLASSES = STORE.PLAYER_CLASSES || [];
  const byClassFull = {};
  CLASSES.forEach((c, i) => {
    byClassFull[c] = { matches: 3 + i, wins: 2 + i, losses: 1 };
  });

  function slot(id, label, opts) {
    const o = opts || {};
    return {
      gameId: id, label: label,
      matches: 12, wins: 7, losses: 5,
      racks: 40, innings: 88, inningRacks: 40,
      safety: 23, masuwari: 6, breakAce: 3, breaks: 19, fouls: 4,
      highRun: 37,
      scMatches: 5, scShots: 120, scSec: 3720, scExt: 7,
      jpaMatches: 12, jpaPoints: 143, jpaFull: 240,
      winInnMin: 4, winInnMax: 17,
      oppSlSum: 52, oppSlCount: 12,
      bySl: { 4: { matches: 6, wins: 4, losses: 2 },
              5: { matches: 6, wins: 3, losses: 3 },
              9: { matches: 12, wins: 10, losses: 2 } },
      byClass: o.noClass ? {} : byClassFull,
      byGoal: { 120: { matches: 6, wins: 4, losses: 2 },
                150: { matches: 6, wins: 3, losses: 3 } },
      aHighRun: 3, bHighRun: 2, brokeFirst: 6, oppBrokeFirst: 6,
      bowlardTotals: [137, 121, 98, 145, 110, 132, 87, 156, 101, 119,
                      124, 133, 92, 148, 105],
      bwStrike: 12, bwSpare: 9, bwMiss: 14, bwBest: 156,
    };
  }

  const ids = (typeof SETUP !== "undefined" && SETUP.gameOrder) ? SETUP.gameOrder() : [];
  // ハウスゲームは byHouse 側で入れる（byGame に入れると別の項目表になる）
  const houseIds = ["59", "510", "kailun"];
  const byGame = {};
  ids.forEach((id) => {
    if (houseIds.indexOf(id) >= 0) return;
    const label = (typeof GAMES !== "undefined" && GAMES[id]) ? GAMES[id].label : id;
    // 14-1 だけはクラスの記録が無い状態にして、注記の行も画面に出す
    byGame[id] = slot(id, label, { noClass: id === "straight" });
  });
  // 記録の無い種目も1つ残す（色の差を見るため）
  const emptyId = Object.keys(byGame).pop();
  delete byGame[emptyId];

  const scores = [];
  for (let i = 0; i < 25; i++) scores.push({ at: "", score: (i % 2 ? -1 : 1) * (i + 1) });

  const byHouse = {
    "59": { gameId: "59", label: "5-9", plays: 9, scores: scores,
            racks: 22, masuwari: 5, breakAce: 2, maxRun: null },
    "510": { gameId: "510", label: "5-10", plays: 4, scores: scores.slice(0, 3),
             racks: 11, masuwari: 2, breakAce: 0, maxRun: null },
    "kailun": { gameId: "kailun", label: "カイルン", plays: 3, scores: scores.slice(0, 2),
                racks: 0, masuwari: 0, breakAce: 0, maxRun: null },
  };

  // 対戦相手別（試合数がばらばら・勝率もばらばら）
  const opponents = {
    "たかのぶ": { matches: 4, wins: 1, losses: 3, winRate: 0.25, last: "2026-08-01" },
    "みなみ": { matches: 11, wins: 6, losses: 5, winRate: 6 / 11, last: "2026-08-20" },
    "ゆうすけ": { matches: 7, wins: 7, losses: 0, winRate: 1, last: "2026-08-10" },
    "さとし": { matches: 11, wins: 9, losses: 2, winRate: 9 / 11, last: "2026-07-01" },
    "けんいちろう": { matches: 2, wins: 0, losses: 2, winRate: 0, last: "2026-06-01" },
    "あきら": { matches: 9, wins: 4, losses: 5, winRate: 4 / 9, last: "2026-05-01" },
    "ひろし": { matches: 1, wins: 1, losses: 0, winRate: 1, last: "2026-04-01" },
  };
  const partners = {
    "たかのぶ": { matches: 6, wins: 2, losses: 4, winRate: 2 / 6,
                  masuwari: 3, breaks: 12, last: "2026-08-01" },
    "みなみ": { matches: 4, wins: 3, losses: 1, winRate: 0.75,
                masuwari: 1, breaks: 9, last: "2026-08-20" },
    "ゆうすけ": { matches: 10, wins: 9, losses: 1, winRate: 0.9,
                  masuwari: 5, breaks: 21, last: "2026-08-10" },
    "さとし": { matches: 3, wins: 0, losses: 3, winRate: 0,
                masuwari: 0, breaks: 5, last: "2026-07-01" },
    "あきら": { matches: 8, wins: 6, losses: 2, winRate: 0.75,
                masuwari: 2, breaks: 14, last: "2026-05-01" },
    "ひろし": { matches: 2, wins: 1, losses: 1, winRate: 0.5,
                masuwari: 0, breaks: 3, last: "2026-04-01" },
  };

  STORE.playerStats = function () {
    return {
      matches: 45, wins: 26, losses: 19, winRate: 26 / 45,
      racks: 180, rackWins: 97, rackWinRate: 97 / 180,
      score: 0, innings: 210,
      masuwari: 14, masuwariRate: 14 / 61, breakAce: 5, safety: 63, fouls: 12,
      breaks: 61,
      general: { matches: 30, wins: 18, losses: 12, winRate: 0.6 },
      jpa: { matches: 15, wins: 8, losses: 7, winRate: 8 / 15 },
      opponents: opponents, partners: partners,
      shotClockShots: 240, avgShotSec: 21.4,
      shotClockViolations: 3, shotClockExtensions: 11,
      shotClockMatches: 6, shotClockTotalSec: 5136,
    };
  };
  STORE.gameDetail = function () { return { byGame: byGame, byHouse: byHouse }; };
  return { games: Object.keys(byGame).length, empty: emptyId };
}
"""

OPEN_ALL = """() => {
  document.querySelectorAll('#screenStats details').forEach(d => { d.open = true; });
}"""

# 折り返しの実測。
#
# 注意: 主題・条件の欄は display:block なので、要素そのものに
# getClientRects() を掛けると「箱1つ」しか返らず、何行に割れていても 1 になる。
# 実際の行数は、その中身に Range を張って取る（行ごとに矩形が返る）。
MEASURE = r"""
() => {
  const out = [];
  function lineRects(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getClientRects().length;
  }
  document.querySelectorAll('#screenStats .stat-row').forEach((row) => {
    const note = row.classList.contains('is-note');
    const card = row.closest('.game-card, .fold-card, .match-card');
    const game = card ? (card.querySelector('.dc-game-name') || {}).textContent : '';
    row.querySelectorAll('.sl-main, .sl-sub').forEach((sp) => {
      const shown = sp.getClientRects().length > 0;
      if (!shown) {
        // 閉じたカードの中は測れない。測れていない行が残っていたら
        // 「折り返し0件」は嘘になるので、ここで拾って落とす
        out.push({ game: (game || '').trim(), text: sp.textContent,
                   rects: 0, note: false, hidden: true });
        return;
      }
      const n = lineRects(sp);
      if (n > 1) {
        out.push({
          game: (game || '').trim(),
          key: (row.querySelector('.stat-key') || {}).innerText,
          text: sp.textContent,
          rects: n,
          note: note,
        });
      }
    });
  });
  // 種目名（カードの見出し）も同じ決まりで測る。
  // 「14-1（ストレートプール）」が半端に割れていた
  document.querySelectorAll('#screenStats .dc-game-name .sl-main, #screenStats .dc-game-name .sl-sub')
    .forEach((sp) => {
      if (!sp.getClientRects().length) return;
      const n = lineRects(sp);
      if (n > 1) {
        out.push({ game: '(種目名)', key: sp.textContent, text: sp.textContent,
                   rects: n, note: false });
      }
    });
  return out;
}
"""

COUNT_ITEMS = """() => {
  const rows = [...document.querySelectorAll('#screenStats .stat-row')];
  return {
    rows: rows.length,
    twoLineKey: rows.filter(r => r.querySelectorAll('.stat-key .sl-sub').length).length,
    twoLineVal: rows.filter(r => r.querySelectorAll('.stat-val .sl-sub').length).length,
    note: rows.filter(r => r.classList.contains('is-note')).length,
  };
}"""

# はみ出しの実測。
#
# 主題・条件の行は white-space: nowrap（半端な折り返しを止めるため）なので、
# 幅が足りなければ「折り返し」ではなく「はみ出し」として現れる。
# 欄の箱そのものは幅いっぱいのまま縮まらないので、箱の座標を見ても分からない。
# 中身に Range を張って、文字の実寸が欄に収まっているかを測る。
OVERFLOW = """() => {
  const bad = [];
  document.querySelectorAll(
    '#screenStats .stat-row .sl-main, #screenStats .stat-row .sl-sub,'
    + '#screenStats .dc-game-name .sl-main, #screenStats .dc-game-name .sl-sub')
    .forEach((sp) => {
      if (!sp.getClientRects().length) return;
      // 折り返してよい行（得点の履歴）は、行末の全角スペースが箱の外に出るぶん
      // 実寸が数px大きく出る。はみ出しの判定は1行で通す行だけを見る
      const row0 = sp.closest('.stat-row');
      if (row0 && row0.classList.contains('is-note')) return;
      const r = document.createRange();
      r.selectNodeContents(sp);
      const box = r.getBoundingClientRect();
      const room = sp.getBoundingClientRect();
      if (box.width > room.width + 1) {
        bad.push({ text: sp.textContent,
                   text_w: Math.round(box.width), room_w: Math.round(room.width) });
      }
    });
  return bad;
}"""

# 画面そのものが横に伸びていないか（右にスクロールできてしまわないか）
PAGE_WIDE = """() => ({
  scroll: document.documentElement.scrollWidth,
  view: document.documentElement.clientWidth,
})"""


def open_stats(pg):
    """成績画面を出して、集計を差し替えたうえで全部開く"""
    pg.click("#tabStats")
    pg.wait_for_timeout(300)
    seeded = pg.evaluate(SEED)
    pg.evaluate("() => PLAYERS.openStats(STORE.listPlayers()[0])")
    pg.wait_for_timeout(300)
    pg.evaluate(OPEN_ALL)
    pg.wait_for_timeout(300)
    # 「ほかN人を見る」の中も開いた状態で測る（折り返しは開いてから出る）
    pg.evaluate(OPEN_ALL)
    pg.wait_for_timeout(200)
    return seeded


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    section("記録を作る")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(300)
    helpers.add_player(pg, "たいら")
    n = pg.evaluate("() => STORE.listPlayers().length")
    check(n == 1, "プレーヤーを1人登録した", n)

    seeded = open_stats(pg)
    check(seeded["games"] >= 10, "種目別の記録を作った", seeded)
    print("   記録なしにした種目: " + str(seeded["empty"]))

    txt = pg.inner_text("#statsBody")

    # ================= 1. 並び順 =================
    section("1. 並び順")
    order = pg.evaluate("""() => {
      function names(title) {
        const card = [...document.querySelectorAll('#statsBody .fold-card')]
          .find(c => (c.querySelector('summary') || {}).textContent.trim().startsWith(title));
        if (!card) return null;
        return [...card.querySelectorAll('.stat-row .stat-key .sl-main')]
          .map(e => e.textContent.trim());
      }
      return { opp: names('対戦相手別'), part: names('パートナー別') };
    }""")
    # 試合数: みなみ11 / さとし11 / あきら9 / ゆうすけ7 / たかのぶ4 / けんいちろう2 / ひろし1
    # 同数（11）は勝率の高い さとし(9/11) が先
    want_opp = ["さとし", "みなみ", "あきら", "ゆうすけ", "たかのぶ", "けんいちろう", "ひろし"]
    check(order["opp"] == want_opp, "対戦相手別は試合数の多い順", order["opp"])
    # 勝率: ゆうすけ.9 / みなみ.75(4試合) / あきら.75(8試合) / たかのぶ.33 / ひろし.5 ...
    want_part = ["ゆうすけ", "あきら", "みなみ", "ひろし", "たかのぶ", "さとし"]
    check(order["part"] == want_part, "パートナー別は勝率順", order["part"])

    # ================= 2. 記録のある種目の色 =================
    section("2. 種目カードの色")
    colors = pg.evaluate("""() => {
      const rec = document.querySelector('.detail-card .game-card.has-rec');
      const emp = document.querySelector('.detail-card .game-card.is-empty');
      const cs = (e) => e ? getComputedStyle(e).backgroundColor : null;
      return { rec: cs(rec), emp: cs(emp),
               nRec: document.querySelectorAll('.detail-card .game-card.has-rec').length,
               nEmp: document.querySelectorAll('.detail-card .game-card.is-empty').length };
    }""")
    check(colors["nRec"] >= 1, "記録のあるカードがある", colors)
    check(colors["nEmp"] >= 1, "記録の無いカードがある", colors)
    check(colors["rec"] and colors["emp"] and colors["rec"] != colors["emp"],
          "記録あり／なしで背景色が違う", colors)

    # ================= 3. 括弧の中の説明を消した =================
    section("3. Aハイラン・Bハイラン")
    check("Aハイラン数／率" in txt, "Aハイランの項目がある")
    check("Bハイラン数／率" in txt, "Bハイランの項目がある")
    check("試合中" not in txt, "（自分がブレイクした N 試合中）の説明が消えている",
          [l for l in txt.split("\n") if "試合中" in l][:3])

    # ================= 4. 2行になっているか =================
    section("4. 項目名と値の2行組み")
    cnt = pg.evaluate(COUNT_ITEMS)
    print("   行の総数 %d ／ 項目名が2行 %d ／ 値が2行 %d ／ 折り返してよい行 %d"
          % (cnt["rows"], cnt["twoLineKey"], cnt["twoLineVal"], cnt["note"]))
    print("   折り返してよい行の中身: "
          + json.dumps(pg.evaluate("""() => [...document.querySelectorAll(
              '#screenStats .stat-row.is-note')].map(r => r.innerText.slice(0, 30))"""),
                       ensure_ascii=False))
    check(cnt["rows"] >= 100, "成績の行が十分に出ている", cnt)
    check(cnt["twoLineKey"] >= 20, "項目名を2行にした行がある", cnt)
    check(cnt["twoLineVal"] >= 15, "値を2行にした行がある", cnt)
    check("平均セーフティ数" in txt and "（1ラックあたり）" in txt,
          "「平均セーフティ数」＋「（1ラックあたり）」になっている")
    check("1ラックあたりの平均セーフティ数" not in txt.replace("\n", ""),
          "古い1行の書き方が残っていない")

    # 値の2行（勝敗数／試合数・勝率）
    cls = pg.evaluate("""() => {
      const row = [...document.querySelectorAll('#screenStats .stat-row')]
        .find(r => (r.querySelector('.stat-key .sl-main') || {}).textContent === '対戦クラス SA');
      if (!row) return null;
      return {
        keyMain: row.querySelector('.stat-key .sl-main').textContent,
        keySub: (row.querySelector('.stat-key .sl-sub') || {}).textContent,
        valMain: row.querySelector('.stat-val .sl-main').textContent,
        valSub: (row.querySelector('.stat-val .sl-sub') || {}).textContent,
      };
    }""")
    check(cls is not None, "対戦クラス SA の行がある")
    if cls:
        check("勝" in cls["valMain"] and "敗" in cls["valMain"]
              and "試合" not in cls["valMain"],
              "上の行は勝敗数だけ", cls)
        check("試合" in cls["valSub"] and "%" in cls["valSub"],
              "下の行に試合数と勝率", cls)

    # ================= 5. 押せる大きさ =================
    section("5. 押せる大きさ（44px）")
    small = pg.evaluate("""() => {
      const bad = [];
      document.querySelectorAll('#screenStats summary').forEach(s => {
        const h = s.getBoundingClientRect().height;
        if (h < 44) bad.push({ t: s.textContent.trim().slice(0, 20), h: Math.round(h) });
      });
      return bad;
    }""")
    check(not small, "見出しはすべて44px以上", small)

    # ================= 6. 幅ごとの折り返し実測 =================
    section("6. 折り返しの実測（320 / 360 / 375 / 390px）")
    per_width = {}
    for w in WIDTHS:
        pg.set_viewport_size({"width": w, "height": 844})
        pg.wait_for_timeout(250)
        pg.evaluate(OPEN_ALL)
        pg.wait_for_timeout(250)
        wraps = pg.evaluate(MEASURE)
        bad = [x for x in wraps if not x["note"]]
        intended = [x for x in wraps if x["note"]]
        per_width[w] = {"bad": bad, "intended": len(intended)}
        check(not bad, "%dpx で意図しない折り返しが0件（意図した折り返し %d件）"
              % (w, len(intended)),
              json.dumps(bad[:6], ensure_ascii=False))
        over = pg.evaluate(OVERFLOW)
        check(not over, "%dpx で欄からはみ出していない" % w,
              json.dumps(over[:4], ensure_ascii=False))
        pw = pg.evaluate(PAGE_WIDE)
        check(pw["scroll"] <= pw["view"] + 1, "%dpx で画面が横に伸びていない" % w, pw)
        pg.screenshot(path=os.path.join(SHOTS, "fix_stats_%d.png" % w), full_page=True)

    check(not errs, "画面のエラーが出ていない", errs[:3])

    br.close()

ng = [r for r in results if not r[0]]
print("\n==== %d件中 %d件OK ====" % (len(results), len(results) - len(ng)))
for w in WIDTHS:
    d = per_width.get(w, {})
    print("   %dpx: 意図しない折り返し %d件 ／ 意図した折り返し %d件"
          % (w, len(d.get("bad", [])), d.get("intended", 0)))
if ng:
    for _, label, detail in ng:
        print("NG: " + label + ("  -> " + str(detail) if detail else ""))
sys.exit(1 if ng else 0)
