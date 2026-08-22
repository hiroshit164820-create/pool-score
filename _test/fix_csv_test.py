# -*- coding: utf-8 -*-
"""fix_csv_test.py — 表計算への書き出し（CSV）の直し（本人の指示 2026-08-22）

本人の困りごと:
  1.「出力時『5-4』のスコアが『5月4日』として出力されるので修正」
  2.「ルール選択時に数えないもの、カウントしないもののセルには『-』を入れておく。
     数えてる項目はそのままカウントした数字を入力。0の場合は0の表示」

確かめること:
  1. 5-4 のような値が日付に化けない形（="5-4"）で書き出される
  2. 先頭が = + - @ の値が数式にならない形で書き出される
  3.「イニングを数えない」で記録した試合は、その列が「-」
  4. 本当に0回だった項目は「0」（「-」と区別できる）
  5. 種目として数えない項目（10ボールのセーフティ、ボウラード以外の
     ストライク／スペア／ミス、JPA以外のSL・JPAポイント、
     マスワリの概念が無い種目）が「-」
  6. BOM付きUTF-8のまま（Excelで文字化けしない）

なぜ ="…" なのか（Excel 16.0・日本語環境で 2026-08-22 に実測した結果）:
    そのまま      5-4→5月4日 / 007→7 / 0912345678→9.12E+08 / =1+1→2（数式が動く）
    引用符で囲む  同上（"5-4" と囲んでも 5月4日 になる）
    '5-4          セルに ' が残る（見た目が汚れる）
    タブ+5-4      セルにタブが残る
    ="5-4"        5-4 のまま・書式も「標準」・=cmd|… も文字のまま ← 採用

やり方:
  記録を localStorage に直に置いてから、画面の中で CSVOUT を呼び、
  実際に書き出される文字列をCSVの決まりどおりに1マスずつ解いて調べる。
  書き出した中身は _test/shots/fix_csv_history.csv と fix_csv_players.csv に残す。

実行: python _test/fix_csv_test.py
"""
import sys, io, os, csv, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
if not os.path.isdir(SHOTS):
    os.makedirs(SHOTS)

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


def guarded(field, inner):
    """そのマスが ="inner" の形（表計算に変換されない形）になっているか"""
    return field == '="' + inner + '"'


# ---------------------------------------------------------------- 記録を作る
# 索引（pool_matches_index）と試合本体（pool_match_<id>）を直に置く。
# 画面を操作して作ると、同時に直している他の画面の作りに引きずられるため、
# ここでは「書き出しの中身」だけを見たいので記録を直に作る。
SEED = r"""() => {
  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  localStorage.clear();

  const idx = [];
  const body = (id, gameId, opt, res, names, pids) => put("pool_match_" + id, {
    id: id, gameId: gameId, options: opt,
    sides: [{sideId:"A", name:names[0], playerIds:pids[0]},
            {sideId:"B", name:names[1], playerIds:pids[1]}],
    events: [], result: res, note: "",
  });
  const NM = ["タイラ", "=岸川"], PID = [["p1"], ["p2"]];

  // 1) 9ボール・イニングを数えた・セーフティは片方0回
  idx.push({id:"m1", gameId:"9ball", gameLabel:"9ボール",
    names:{A:NM[0], B:NM[1]}, playerIds:{A:["p1"], B:["p2"]},
    createdAt:"2026-08-20T01:00:00.000Z", finished:true, winner:"A",
    scores:{A:0,B:0}, racks:{A:5,B:4}, countInnings:true, innings:7,
    safety:{A:0,B:2}, masuwari:{A:1,B:0}, bowlard:null, skillLevel:null,
    jpa:null, note:"5-4 で競り勝ち"});
  body("m1","9ball",{countInnings:true},
    {winner:"A", scores:{A:0,B:0}, racks:{A:5,B:4}, inningsPlayed:7,
     perSide:{A:{masuwari:1,safety:0,fouls:0,breaks:5,breakAce:0},
              B:{masuwari:0,safety:2,fouls:1,breaks:4,breakAce:0}}},
    NM, PID);

  // 2) 9ボール・イニングを数えない
  idx.push({id:"m2", gameId:"9ball", gameLabel:"9ボール",
    names:{A:NM[0], B:NM[1]}, playerIds:{A:["p1"], B:["p2"]},
    createdAt:"2026-08-20T02:00:00.000Z", finished:true, winner:"B",
    scores:{A:0,B:0}, racks:{A:2,B:5}, countInnings:false, innings:null,
    safety:{A:0,B:0}, masuwari:{A:0,B:0}, bowlard:null, skillLevel:null,
    jpa:null, note:""});
  body("m2","9ball",{countInnings:false},
    {winner:"B", scores:{A:0,B:0}, racks:{A:2,B:5}, inningsPlayed:9,
     perSide:{A:{masuwari:0,safety:0,fouls:0,breaks:2},
              B:{masuwari:0,safety:0,fouls:0,breaks:5}}},
    NM, PID);

  // 3) 10ボール（セーフティコールが無い種目）。メモが数式に見える値
  idx.push({id:"m3", gameId:"10ball", gameLabel:"10ボール",
    names:{A:NM[0], B:NM[1]}, playerIds:{A:["p1"], B:["p2"]},
    createdAt:"2026-08-20T03:00:00.000Z", finished:true, winner:"A",
    scores:{A:0,B:0}, racks:{A:3,B:1}, countInnings:true, innings:5,
    safety:{A:0,B:0}, masuwari:{A:0,B:0}, bowlard:null, skillLevel:null,
    jpa:null, note:"=1+1"});
  body("m3","10ball",{countInnings:true},
    {winner:"A", scores:{A:0,B:0}, racks:{A:3,B:1}, inningsPlayed:5,
     perSide:{A:{masuwari:0,safety:0,fouls:0,breaks:3},
              B:{masuwari:0,safety:0,fouls:0,breaks:1}}},
    NM, PID);

  // 4) ボウラード（1人・ストライク等を数える種目）
  idx.push({id:"m4", gameId:"bowlard", gameLabel:"ボウラード",
    names:{A:NM[0], B:"—"}, playerIds:{A:["p1"], B:[]},
    createdAt:"2026-08-20T04:00:00.000Z", finished:true, winner:"A",
    scores:{A:82,B:0}, racks:{A:0,B:0}, countInnings:true, innings:20,
    safety:{A:0,B:0}, masuwari:{A:0,B:0},
    bowlard:{strike:2, spare:0, miss:5, total:82},
    skillLevel:null, jpa:null, note:""});
  body("m4","bowlard",{countInnings:true},
    {winner:"A", scores:{A:82,B:0}, racks:{A:0,B:0}, inningsPlayed:20,
     bowlard:{strike:2, spare:0, miss:5, total:82},
     perSide:{A:{masuwari:0,safety:0,fouls:0,breaks:0},
              B:{masuwari:0,safety:0,fouls:0,breaks:0}}},
    [NM[0], "—"], [["p1"], []]);

  // 5) JPA 9ボール（SLとチームポイントがある種目）
  idx.push({id:"m5", gameId:"jpa_9ball", gameLabel:"JPA 9ボール",
    names:{A:NM[0], B:NM[1]}, playerIds:{A:["p1"], B:["p2"]},
    createdAt:"2026-08-20T05:00:00.000Z", finished:true, winner:"A",
    scores:{A:31,B:20}, racks:{A:0,B:0}, countInnings:true, innings:12,
    safety:{A:3,B:1}, masuwari:{A:0,B:0}, bowlard:null,
    skillLevel:{A:5,B:7}, jpa:{teamPoints:{A:14,B:6}}, note:""});
  body("m5","jpa_9ball",{countInnings:true},
    {winner:"A", scores:{A:31,B:20}, racks:{A:0,B:0}, inningsPlayed:12,
     jpa:{teamPoints:{A:14,B:6}},
     perSide:{A:{masuwari:0,safety:3,fouls:0,breaks:6},
              B:{masuwari:0,safety:1,fouls:0,breaks:6}}},
    NM, PID);

  // 6) 進行中（まだ確定していない）。メモが数式に見える値
  idx.push({id:"m6", gameId:"9ball", gameLabel:"9ボール",
    names:{A:NM[0], B:NM[1]}, playerIds:{A:["p1"], B:["p2"]},
    createdAt:"2026-08-20T06:00:00.000Z", finished:false, winner:null,
    scores:null, racks:null, countInnings:true, innings:null,
    safety:null, masuwari:null, bowlard:null, skillLevel:null,
    jpa:null, note:"+1-1"});

  put("pool_matches_index", idx);
  put("pool_players", [{id:"p1", name:"タイラ"}, {id:"p2", name:"=岸川"}]);
  // ハウスゲーム。種目名「5-9」そのものが日付に化ける
  put("pool_money_results", [{
    id:"mg1", gameId:"money_9", gameLabel:"5-9", racks:5,
    createdAt:"2026-08-20T07:00:00.000Z",
    players:[{name:"タイラ", score:12, handicapBalls:[]},
             {name:"=岸川", score:0, handicapBalls:[9]}],
  }]);
  return true;
}"""


def rows_of(text):
    """書き出した文字列を、CSVの決まりどおりに1行ずつ／1マスずつに分ける"""
    return list(csv.reader(io.StringIO(text), delimiter=",", quotechar='"'))


with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(800)
    pg.evaluate(SEED)
    pg.reload()
    pg.wait_for_timeout(800)

    # 画面の中で CSVOUT を呼び、実際に書き出される文字列をそのまま取る
    hist = pg.evaluate("() => CSVOUT.build(CSVOUT.historyRows(STORE.listMatches()))")
    plyr = pg.evaluate("() => CSVOUT.build(CSVOUT.playerRows())")
    io.open(os.path.join(SHOTS, "fix_csv_history.csv"), "w",
            encoding="utf-8-sig", newline="").write(hist)
    io.open(os.path.join(SHOTS, "fix_csv_players.csv"), "w",
            encoding="utf-8-sig", newline="").write(plyr)

    print("書き出した中身（先頭4行）:")
    for ln in hist.split("\r\n")[:4]:
        print("   " + ln)
    print("選手ごとの成績（先頭2行）:")
    for ln in plyr.split("\r\n")[:2]:
        print("   " + ln)

    H = rows_of(hist)
    P = rows_of(plyr)
    head = H[0]
    c = {n: i for i, n in enumerate(head)}

    # 日時で1試合ぶんの行を引く（索引は新しい順に返るため）
    def at(hhmm):
        want = "2026/08/20 " + hhmm
        for r in H[1:]:
            if len(r) == len(head) and r[0] == want:
                return r
        return None

    # 記録はUTCで置いた。表示は端末の時計（日本時間なら +9時間）
    off = 9
    def jst(h):
        return "%02d:00" % ((h + off) % 24)
    m1, m2, m3 = at(jst(1)), at(jst(2)), at(jst(3))
    m4, m5, m6 = at(jst(4)), at(jst(5)), at(jst(6))
    got = {"m1": m1, "m2": m2, "m3": m3, "m4": m4, "m5": m5, "m6": m6}
    check(all(v is not None for v in got.values()),
          "6試合ぶんの行が書き出されている",
          {k: (v[1] if v else None) for k, v in got.items()})
    if not all(got.values()):
        for r in H[:9]:
            print("   " + str(r))

    # ================= 1. 日付に化けない形か =================
    section("1 スコアが日付にならない")
    ph = P[0]
    pc = {n: i for i, n in enumerate(ph)}
    prow = [r for r in P[1:] if r and r[0] == "タイラ"]
    check(len(prow) == 1, "選手の行がある", [r[0] for r in P[1:] if r])
    if prow:
        wl = prow[0][pc["W-L"]]
        inner = wl[2:-1] if wl.startswith('="') else wl
        check(guarded(wl, inner) and re.match(r"^\d+-\d+$", inner),
              "W-L（5-4 の正体）が ="'"'"…"'"'" の形で出る", wl)
    # ハウスゲームの種目名「5-9」
    m59 = [r for r in H if len(r) > 1 and r[1] in ('="5-9"', "5-9")]
    check(m59 and guarded(m59[0][1], "5-9"),
          "種目名「5-9」も日付にならない形", m59[0][1] if m59 else None)
    # 日時の列は日付として読ませてよい（もともと日付なので包まない）
    check(m1 and not m1[0].startswith('="'),
          "日時の列は日付のまま（包まない）", m1[0] if m1 else None)
    # スコアは列が分かれているので数字のまま（合計や平均が計算できる）
    check(m1 and m1[c["スコアA"]] == "5" and m1[c["スコアB"]] == "4",
          "スコアは列が分かれた数字のまま",
          [m1[c["スコアA"]], m1[c["スコアB"]]] if m1 else None)
    # 化ける値の一覧を、書き出しの入口（CSVOUT.cell）で直に確かめる
    danger = ["5-4", "1-2", "2026-08", "3/4", "1:2", "007", "0912345678",
              "12345678901234567890", "1E5", "Mar-5"]
    outs = pg.evaluate("(vs) => vs.map(v => CSVOUT.cell(v))", danger)
    bad = [v for v, o in zip(danger, outs) if not o.startswith('"="') ]
    check(not bad, "日付・数値に化ける値がすべて包まれる", list(zip(danger, outs)))

    # ================= 2. 数式にならないか =================
    section("2 先頭が = + - @ の値が数式にならない")
    check(m1 and guarded(m1[c["プレーヤーB"]], "=岸川"),
          "名前「=岸川」が文字として出る", m1[c["プレーヤーB"]] if m1 else None)
    check(m3 and guarded(m3[c["メモ"]], "=1+1"),
          "メモ「=1+1」が文字として出る", m3[c["メモ"]] if m3 else None)
    check(m6 and guarded(m6[c["メモ"]], "+1-1"),
          "メモ「+1-1」が文字として出る", m6[c["メモ"]] if m6 else None)
    risky = ["=cmd|'/C calc'!A0", "@SUM(1)", "-5から", "+81", "\t=1+1",
             "=HYPERLINK(\"http://x\",\"click\")"]
    outs2 = pg.evaluate("(vs) => vs.map(v => CSVOUT.cell(v))", risky)
    check(all(o.startswith('"="') or o.startswith('="') for o in outs2),
          "危険な先頭文字の値はすべて包まれる", list(zip(risky, outs2)))
    check(pg.evaluate('() => CSVOUT.cell("-")') == "-",
          "「-」1文字はそのまま（Excelでも文字のまま・実測で確認）")
    check(pg.evaluate("() => CSVOUT.cell(-3)") == "-3",
          "数値のマイナスは数値のまま（合計が計算できる）")

    # ================= 3/4/5. 数えない=「-」、0は0 =================
    section("3 数えない項目は「-」／数えた0は「0」")
    if all(got.values()):
        check(m1[c["イニング数"]] == "7", "数えた試合のイニングは数字", m1[c["イニング数"]])
        check(m2[c["イニング数"]] == "-",
              "「数えない」で記録した試合のイニングは -", m2[c["イニング数"]])
        check(m1[c["セーフティA"]] == "0",
              "0回のセーフティは 0（-ではない）", m1[c["セーフティA"]])
        check(m1[c["セーフティB"]] == "2", "2回のセーフティは 2", m1[c["セーフティB"]])
        check(m1[c["マスワリA"]] == "1", "マスワリは数字", m1[c["マスワリA"]])
        check(m1[c["マスワリB"]] == "0", "0回のマスワリは 0", m1[c["マスワリB"]])
        check(m3[c["セーフティA"]] == "-" and m3[c["セーフティB"]] == "-",
              "10ボール（セーフティコール廃止）は -",
              [m3[c["セーフティA"]], m3[c["セーフティB"]]])
        check(m3[c["マスワリA"]] == "0",
              "10ボールのマスワリは数える（0は0）", m3[c["マスワリA"]])
        check(m4[c["マスワリA"]] == "-", "ボウラードのマスワリは -", m4[c["マスワリA"]])
        check(m4[c["セーフティA"]] == "-", "ボウラードのセーフティは -", m4[c["セーフティA"]])
        check(m4[c["ストライク"]] == "2" and m4[c["スペア"]] == "0"
              and m4[c["ミス"]] == "5",
              "ボウラードのストライク／スペア／ミスは数字（0も0）",
              [m4[c["ストライク"]], m4[c["スペア"]], m4[c["ミス"]]])
        check(m1[c["ストライク"]] == "-" and m1[c["スペア"]] == "-"
              and m1[c["ミス"]] == "-",
              "ボウラード以外のストライク／スペア／ミスは -",
              [m1[c["ストライク"]], m1[c["スペア"]], m1[c["ミス"]]])
        check(m5[c["SL_A"]] == "5" and m5[c["SL_B"]] == "7",
              "JPAのスキルレベルは数字", [m5[c["SL_A"]], m5[c["SL_B"]]])
        check(m1[c["SL_A"]] == "-", "JPA以外のスキルレベルは -", m1[c["SL_A"]])
        check(m5[c["JPAポイントA"]] == "14" and m5[c["JPAポイントB"]] == "6",
              "JPAポイントは数字", [m5[c["JPAポイントA"]], m5[c["JPAポイントB"]]])
        check(m1[c["JPAポイントA"]] == "-", "JPA以外のJPAポイントは -",
              m1[c["JPAポイントA"]])
        check(m6[c["スコアA"]] == "-" and m6[c["イニング数"]] == "-"
              and m6[c["セーフティA"]] == "-",
              "進行中の試合は数字が確定していないので -",
              [m6[c["スコアA"]], m6[c["イニング数"]], m6[c["セーフティA"]]])
        # ハンデ球が無い人は「-」（0個ではなく該当なし）
        hb = [r for r in H if len(r) == 8 and r[5] == "タイラ"]
        check(hb and hb[0][7] == "-", "ハンデ球が無いときは -",
              hb[0] if hb else None)

    section("4 選手ごとの成績も同じ決まり")
    if prow:
        r = prow[0]
        check(r[pc["イニング合計"]].isdigit(),
              "イニングを数えた試合があるので合計は数字", r[pc["イニング合計"]])
        check(r[pc["ファウル"]].isdigit(), "ファウルは0でも0", r[pc["ファウル"]])
        check(r[pc["JPA獲得ポイント"]] in ("-",) or r[pc["JPA獲得ポイント"]].isdigit(),
              "JPAを1試合もしていなければ -", r[pc["JPA獲得ポイント"]])
        check(r[pc["平均ショット時間(秒)"]] == "-",
              "ショットクロックを使っていなければ -", r[pc["平均ショット時間(秒)"]])
        check(r[pc["マスワリ"]].isdigit(),
              "マスワリを数える種目をしていれば数字", r[pc["マスワリ"]])

    section("5 文字化けしない形のまま")
    pg.evaluate("""() => { window.__blob = null;
      const old = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (b) { window.__blob = b; return old(b); }; }""")
    bom = pg.evaluate("""async () => {
      CSVOUT.download(CSVOUT.historyRows(STORE.listMatches()), "試合履歴");
      const buf = await window.__blob.arrayBuffer();
      const u = new Uint8Array(buf);
      return [u[0], u[1], u[2]];
    }""")
    check(bom == [239, 187, 191], "書き出したファイルはBOM付きUTF-8のまま", bom)
    check("タイラ" in hist and "岸川" in hist, "日本語がそのまま入っている")
    check(len(head) == 21, "出す列の数は変えていない（21列）", len(head))
    check(head[:6] == ["日時", "種目", "状態", "プレーヤーA", "SL_A", "スコアA"],
          "日本語の見出しはそのまま", head[:6])

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
