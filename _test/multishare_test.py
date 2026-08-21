# -*- coding: utf-8 -*-
"""multishare_test.py — 試合を複数件まとめて1本のリンクで渡す（本人の指示 2026-08-22）

本人の指示:
  「試合結果を複数件まとめて送ることもできる？
    履歴にチェックボックス付けて、複数選択してからまとめて送信みたいな」

js/share.js に版3（複数まとめ）を足した。中の1件ずつは版2と同じ詰め方なので、
同じ選手名・同じ設定が繰り返されるぶんは圧縮がまとめて効く。

対象:
  1. 3件まとめたリンクを decodeAll で読むと3件返り、
     **それぞれの中身が元と一致する**（seq / t / side / at / voided / d まで）
  2. 1件ぶんの古いリンク（版1・版2）を decodeAll に渡すと1件の配列で返る
  3. たくさん（30件）渡したとき、上限で dropped が正しく数えられ、
     入った側は全部正しく読める（古いほうから落ちる）
  4. 「結果だけ」に落ちたときは slim が真になり、1球ごとの記録が空になる
  5. 実測: 1・3・5・10・20件のリンク文字数と QR の版・マス数
     （何件まで1本に入るかを、実際に作って数える）

実行: python _test/multishare_test.py
"""
import sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = os.environ.get("POOL_URL")
if not URL:
    URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"

BASE = "https://hiroshit164820-create.github.io/pool-score/"
N = 30

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


# 送る側の端末で、ローテーション120点の試合を N 件つくって保存する。
# 画面を延々と叩くと壊れやすいので、エンジンに直接イベントを積む
# （画面から作る道筋は share_test.py が別に確かめている）。
# 1日ずつずらして作るので「新しい／古い」がはっきりする。
MAKE_MATCHES = """
(arg) => {
  const ids = arg.names.map(n => STORE.listPlayers().find(p => p.name === n).id);
  const made = [];
  const evs = arg.events || 17;
  for (let k = 0; k < arg.count; k++) {
    const t0 = new Date(Date.parse(arg.from) + k * 86400000);
    let ms = 0;
    // rand が真なら間隔もばらばらにする（実際の試合に近く、圧縮が効きにくい）
    const step = () => arg.rand ? (400 + Math.floor(Math.random() * 4000)) : 961;
    const now = () => new Date(t0.getTime() + (ms += step()));
    // uniq が真のときは1試合ごとに名前を変える。
    // 名前が毎回ちがうと、まとめたときの圧縮が効かなくなる（重い試合の見立て）
    const nm = n => arg.uniq ? (n + (arg.tag || '') + k) : n;
    const m = createMatch({
      gameId: 'rotation',
      sides: [{ name: nm(arg.names[0]), playerIds: [ids[0]] },
              { name: nm(arg.names[1]), playerIds: [ids[1]] }],
      goal: { type: 'score', targets: { A: 120, B: 120 } },
      options: {},
      firstSide: 'A',
      now: t0,
    });
    let i = 0;
    while (m.events.length < evs) {
      const side = i % 3 === 2 ? 'B' : 'A';
      appendEvent(m, { t: 'POCKET', side: side,
                       d: { balls: [arg.rand ? (1 + Math.floor(Math.random() * 15))
                                              : ((i + k) % 15) + 1],
                            onBreak: i === 0 } }, now());
      i++;
    }
    voidEvent(m, 5, '訂正', now());
    // メモ。でたらめな文字は圧縮が効かないので、かさばる試合の見立てになる
    if (arg.note) {
      let s = '';
      while (s.length < arg.note) s += Math.random().toString(36).slice(2);
      m.note = s.slice(0, arg.note);
    }
    m.result = buildResult(m, now());
    m.updatedAt = m.events[m.events.length - 1].at;
    STORE.saveMatch(m);
    made.push(m.id);
  }
  return made;
}
"""

# 送る側で「版1（初代の形）」の本体を手で組む。share.js はもう版1を作らないので
MAKE_V1 = """
async (id) => {
  const m = STORE.loadMatch(id);
  const p = {
    v: 1, id: m.id, gameId: m.gameId, createdAt: m.createdAt,
    updatedAt: m.updatedAt, rulesetVersion: m.rulesetVersion,
    sides: m.sides.map(s => ({ sideId: s.sideId, name: s.name,
      teamLabel: s.teamLabel || null, members: s.members || null,
      guest: !!s.guest })),
    goal: m.goal, options: m.options, recordedBy: m.recordedBy,
    note: m.note || '', events: m.events, result: m.result,
  };
  const json = JSON.stringify(p);
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(json));
  w.close();
  const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  const b64 = btoa(bin).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
  return { body: '1.g.' + b64, payload: p };
}
"""

# 複数まとめのリンクを作る
MAKE_LINK = """
async (arg) => {
  const ms = arg.ids.map(id => STORE.loadMatch(id));
  const out = await SHARE.makeLink(arg.one ? ms[0] : ms, arg.base);
  // QRは版40（誤り訂正L）でも2,953バイトまで。長いリンクはQRにできないので0で返す
  let q = null;
  try { q = QRCODE.make(out.url, { ecLevel: 'L' }); } catch (e) { q = null; }
  return { url: out.url, chars: out.chars, slim: out.slim,
           count: out.count, dropped: out.dropped,
           qv: q ? q.version : 0, qs: q ? q.size : 0,
           qrNg: q ? '' : 'QRには長すぎる' };
}
"""

# リンクを読み戻す
DECODE_ALL = """
async (body) => {
  const list = await SHARE.decodeAll(body);
  return list.map(m => ({
    id: m.id, gameId: m.gameId, slim: !!m.slim,
    createdAt: m.createdAt, updatedAt: m.updatedAt,
    goal: m.goal, options: m.options, note: m.note,
    recordedBy: m.recordedBy, rulesetVersion: m.rulesetVersion,
    result: m.result, sides: m.sides, events: m.events,
  }));
}
"""

SRC = """
(ids) => ids.map(id => {
  const m = STORE.loadMatch(id);
  return { id: m.id, gameId: m.gameId, createdAt: m.createdAt,
           updatedAt: m.updatedAt, goal: m.goal, options: m.options,
           note: m.note, recordedBy: m.recordedBy,
           rulesetVersion: m.rulesetVersion, result: m.result,
           events: m.events };
})
"""


def js(x):
    return json.dumps(x, sort_keys=True, ensure_ascii=False)


def same_events(a, b):
    """seq / t / side / at / voided / d まで突き合わせる。違いを返す"""
    bad = []
    if len(a) != len(b):
        return [("件数", len(a), len(b))]
    for i in range(len(a)):
        for k in ("seq", "t", "side", "at", "voided", "d"):
            if js(a[i].get(k)) != js(b[i].get(k)):
                bad.append((i, k, js(a[i].get(k)), js(b[i].get(k))))
    return bad


with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(700)

    section("0. 送る側で %d 件の試合を用意する" % N)
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    helpers.add_player(pg, "たいら")
    helpers.add_player(pg, "いっちょ")
    pg.wait_for_timeout(200)
    ids = pg.evaluate(MAKE_MATCHES, {"names": ["たいら", "いっちょ"], "count": N,
                                     "from": "2026-07-01T10:00:00.000Z"})
    check(len(ids) == N, "%d 件の試合ができた" % N, len(ids))
    check(len(set(ids)) == N, "試合IDが全部ちがう", len(set(ids)))
    src = pg.evaluate(SRC, ids)
    check(len(src[0]["events"]) == 18, "1件あたり18イベント", len(src[0]["events"]))
    check(any(e["voided"] for e in src[0]["events"]), "取り消した記録も入っている")
    MAXC = pg.evaluate("SHARE.MAX_CHARS")
    check(MAXC == 6000, "リンクの上限は6000字", MAXC)
    print("   MAX_CHARS = %d" % MAXC)

    # ================= 1. 3件まとめる =================
    section("1. 3件まとめたリンクを decodeAll で読む")
    three = ids[:3]
    out3 = pg.evaluate(MAKE_LINK, {"ids": three, "base": BASE, "one": False})
    body3 = out3["url"].split("#")[1].split("=", 1)[1]
    print("   本体 %d字 / count=%s dropped=%s slim=%s / 先頭 %s"
          % (out3["chars"], out3["count"], out3["dropped"], out3["slim"], body3[:4]))
    check(body3.startswith("3."), "本体が「3.」で始まる（版3）", body3[:8])
    check(out3["count"] == 3, "count が3", out3["count"])
    check(out3["dropped"] == 0, "dropped が0", out3["dropped"])
    check(out3["slim"] is False, "slim が偽（1球ごとの記録が入ったまま）", out3["slim"])
    check(out3["chars"] <= MAXC, "上限に収まっている", out3["chars"])

    got3 = pg.evaluate(DECODE_ALL, body3)
    check(len(got3) == 3, "decodeAll が3件返す", len(got3))
    if len(got3) == 3:
        s3 = pg.evaluate(SRC, three)
        for i in range(3):
            check(got3[i]["id"] == s3[i]["id"],
                  "%d件目のIDと並びが一致" % (i + 1), (s3[i]["id"], got3[i]["id"]))
            bad = same_events(s3[i]["events"], got3[i]["events"])
            check(not bad, "%d件目の seq/t/side/at/voided/d が全件一致" % (i + 1),
                  bad[:3])
            for k in ("gameId", "createdAt", "updatedAt", "goal", "options",
                      "note", "recordedBy", "rulesetVersion", "result"):
                check(js(s3[i][k]) == js(got3[i][k]),
                      "%d件目の %s が一致" % (i + 1, k), (s3[i][k], got3[i][k]))

    # ================= 2. 今までの1件物のリンク =================
    section("2. 1件ぶんの古いリンク（版1・版2）も1件の配列で返る")
    one = ids[0]
    v2 = pg.evaluate(MAKE_LINK, {"ids": [one], "base": BASE, "one": True})
    b2 = v2["url"].split("#")[1].split("=", 1)[1]
    check(b2.startswith("2."), "1試合を単体で渡すと今までどおり版2", b2[:4])
    got2 = pg.evaluate(DECODE_ALL, b2)
    check(isinstance(got2, list) and len(got2) == 1,
          "版2の1件物は1件の配列で返る", len(got2) if isinstance(got2, list) else got2)
    check(not same_events(src[0]["events"], got2[0]["events"]),
          "版2の中身が元と一致", same_events(src[0]["events"], got2[0]["events"])[:3])

    old = pg.evaluate(MAKE_V1, one)
    got1 = pg.evaluate(DECODE_ALL, old["body"])
    check(isinstance(got1, list) and len(got1) == 1,
          "版1の1件物も1件の配列で返る", len(got1) if isinstance(got1, list) else got1)
    check(not same_events(src[0]["events"], got1[0]["events"]),
          "版1の中身が元と一致", same_events(src[0]["events"], got1[0]["events"])[:3])

    # 1件の配列を渡しても版2（短いほう）になる
    v2b = pg.evaluate(MAKE_LINK, {"ids": [one], "base": BASE, "one": False})
    check(v2b["url"].split("=", 1)[1].startswith("2."),
          "1件だけの配列も版2で送る（短く、古いアプリでも読める）")
    check(v2b["count"] == 1 and v2b["dropped"] == 0,
          "1件のときも count=1 / dropped=0", (v2b["count"], v2b["dropped"]))

    # decode（1件目を返す今までの入口）も生きている
    d1 = pg.evaluate("async (b) => (await SHARE.decode(b)).id", body3)
    check(d1 == three[0], "decode は今までどおり1件目を返す", (three[0], d1))

    section("3. ふつうの%d件はそのまま1本に入る（圧縮が効くため）" % N)
    outN = pg.evaluate(MAKE_LINK, {"ids": ids, "base": BASE, "one": False})
    bodyN = outN["url"].split("#")[1].split("=", 1)[1]
    print("   本体 %d字 / count=%s dropped=%s slim=%s / QR版%d（%d×%dマス）"
          % (outN["chars"], outN["count"], outN["dropped"], outN["slim"],
             outN["qv"], outN["qs"], outN["qs"]))
    check(outN["count"] + outN["dropped"] == N,
          "count + dropped が渡した件数と合う",
          (outN["count"], outN["dropped"]))
    check(outN["chars"] <= MAXC, "上限に収まっている", outN["chars"])
    gotN = pg.evaluate(DECODE_ALL, bodyN)
    check(len(gotN) == outN["count"], "入った件数ぶん読み出せる",
          (outN["count"], len(gotN)))
    keep = ids[N - outN["count"]:]
    check([g["id"] for g in gotN] == keep,
          "リンクに入ったのは新しいほうの %d 件" % outN["count"],
          ([g["id"] for g in gotN][:3], keep[:3]))
    sK = pg.evaluate(SRC, keep)
    badall = []
    for i in range(len(gotN)):
        for k in ("gameId", "createdAt", "updatedAt", "goal", "options",
                  "note", "recordedBy", "rulesetVersion", "result"):
            if js(sK[i][k]) != js(gotN[i][k]):
                badall.append((i, k))
    check(not badall, "入った側は全件、試合の中身が元と一致", badall[:5])

    # ================= 4. 結果だけに落ちるとき =================
    # 名前が毎回ちがう長い試合を並べると、まとめても圧縮が効かず上限を超える。
    # そのときの落とし方（まず全件を「結果だけ」に落とす）を確かめる
    section("4. 上限を超えたら全件が「結果だけ」に落ちる")
    big = pg.evaluate(MAKE_MATCHES, {"names": ["たいら", "いっちょ"], "count": 16,
                                     "from": "2026-05-01T10:00:00.000Z",
                                     "events": 240, "uniq": True, "tag": "大",
                                     "rand": True})
    outB = pg.evaluate(MAKE_LINK, {"ids": big, "base": BASE, "one": False})
    bodyB = outB["url"].split("#")[1].split("=", 1)[1]
    one_big = pg.evaluate(MAKE_LINK, {"ids": [big[0]], "base": BASE, "one": True})
    print("   長い試合（240イベント・毎回ちがう相手と間隔）1件で本体 %d字"
          % one_big["chars"])
    print("   16件まとめ → 本体 %d字 / count=%s dropped=%s slim=%s"
          % (outB["chars"], outB["count"], outB["dropped"], outB["slim"]))
    check(outB["slim"] is True, "slim が真（結果だけに落ちた）", outB["slim"])
    check(outB["dropped"] == 0, "件数は落とさずに済んでいる", outB["dropped"])
    check(outB["chars"] <= MAXC, "上限に収まっている", outB["chars"])
    gotB = pg.evaluate(DECODE_ALL, bodyB)
    check(len(gotB) == 16, "16件そのまま読み出せる", len(gotB))
    empty = [g["id"] for g in gotB if g["events"]]
    check(not empty, "1球ごとの記録が空になっている", empty[:3])
    check(all(g["slim"] for g in gotB), "1件ずつにも slim の印が付く",
          [g["id"] for g in gotB if not g["slim"]][:3])
    check(all(g["result"] for g in gotB), "結果（勝敗・スコア）は残っている")
    sB = pg.evaluate(SRC, big)
    bad = []
    for i in range(len(gotB)):
        for k in ("gameId", "createdAt", "goal", "options",
                  "recordedBy", "rulesetVersion", "result"):
            if js(sB[i][k]) != js(gotB[i][k]):
                bad.append((i, k))
    check(not bad, "結果だけでも中身は元と一致", bad[:5])

    # ================= 4b. 件数まで落とすとき =================
    # メモにでたらめな文字を入れると圧縮が効かないので、
    # 「結果だけ」に落としても入りきらない状態を作れる
    section("4b. 結果だけにしても入らないときは、古い試合から落とす")
    fat = pg.evaluate(MAKE_MATCHES, {"names": ["たいら", "いっちょ"], "count": N,
                                     "from": "2026-03-01T10:00:00.000Z",
                                     "events": 30, "uniq": True, "tag": "重",
                                     "note": 400})
    outF = pg.evaluate(MAKE_LINK, {"ids": fat, "base": BASE, "one": False})
    bodyF = outF["url"].split("#")[1].split("=", 1)[1]
    print("   %d件まとめ → 本体 %d字 / count=%s dropped=%s slim=%s"
          % (N, outF["chars"], outF["count"], outF["dropped"], outF["slim"]))
    check(outF["dropped"] > 0, "上限を超えたぶんが dropped に数えられた",
          outF["dropped"])
    check(outF["count"] + outF["dropped"] == N,
          "count + dropped が渡した件数と合う", (outF["count"], outF["dropped"]))
    check(outF["chars"] <= MAXC, "残ったぶんは上限に収まっている", outF["chars"])
    # この見立てでは「結果だけ」に落とすとかえって太る（結果を載せる必要が出るため）。
    # そのときは1球ごとの記録を残したまま件数を減らすほうが、詳しくて件数も多い
    print("   （この見立てでは slim=%s。結果だけに落とすと逆に太るため）"
          % outF["slim"])
    gotF = pg.evaluate(DECODE_ALL, bodyF)
    check(len(gotF) == outF["count"], "入った件数ぶん読み出せる",
          (outF["count"], len(gotF)))
    keepF = fat[N - outF["count"]:]
    check([g["id"] for g in gotF] == keepF,
          "残ったのは新しいほうの %d 件（古いほうから落ちた）" % outF["count"],
          ([g["id"] for g in gotF][:3], keepF[:3]))
    sF = pg.evaluate(SRC, keepF)
    badF = []
    for i in range(len(gotF)):
        for k in ("gameId", "createdAt", "goal", "options", "note",
                  "recordedBy", "rulesetVersion", "result"):
            if js(sF[i][k]) != js(gotF[i][k]):
                badF.append((i, k))
        if not outF["slim"]:
            badF += [(i,) + tuple(b) for b in
                     same_events(sF[i]["events"], gotF[i]["events"])[:1]]
    check(not badF, "入った側は全件、試合の中身が元と一致", badF[:5])
    # あと1件足したら入らないこと（数え間違いをしていない）
    plus = pg.evaluate(MAKE_LINK,
                       {"ids": fat[N - outF["count"] - 1:], "base": BASE,
                        "one": False})
    check(plus["dropped"] > 0,
          "もう1件足すと入りきらない（境目まで詰められている）",
          (plus["chars"], plus["dropped"], plus["slim"]))

    # ================= 5. 実測 =================
    section("5. 実測（1本のリンクに何件入るか）")
    print("   件数  本体字数  URL字数  slim  dropped  QR版  マス")
    meas = {}
    for k in (1, 3, 5, 10, 20):
        o = pg.evaluate(MAKE_LINK, {"ids": ids[:k], "base": BASE, "one": False})
        meas[k] = o
        print("   %4d  %8d  %7d  %5s  %7d  %4d  %d×%d"
              % (k, o["chars"], len(o["url"]), o["slim"], o["dropped"],
                 o["qv"], o["qs"], o["qs"]))
    check(meas[1]["chars"] < meas[3]["chars"] < meas[10]["chars"],
          "件数が増えれば本体も伸びる")
    per3 = (meas[3]["chars"] - meas[1]["chars"]) / 2.0
    print("   1件目 %d字 / 2件目以降は1件あたり約%.0f字（同じ選手名・設定は圧縮が効く）"
          % (meas[1]["chars"], per3))

    # 全部入り（1球ごとの記録つき）で何件まで入るか / QR版25以下で何件までか
    full_max, qr_max = 0, 0
    for k in range(1, N + 1):
        o = pg.evaluate(MAKE_LINK, {"ids": ids[:k], "base": BASE, "one": False})
        if o["dropped"] == 0 and not o["slim"]:
            full_max = k
        if o["dropped"] == 0 and o["qv"] <= 25:
            qr_max = k
    print("   1球ごとの記録つきで1本に入るのは最大 %d 件" % full_max)
    print("   QR版25以下（現実的に読める粗さ）で渡せるのは最大 %d 件" % qr_max)
    check(full_max >= 5, "1球ごとの記録つきで5件以上は入る", full_max)
    check(qr_max >= 1, "QR版25以下で渡せる件数を測れた", qr_max)

    # 相手も試合の長さも毎回ちがう「重いほう」の見立て（60イベント・名前が毎回ちがう）
    section("5b. 実測（相手が毎回ちがう・60イベントの試合の場合）")
    vary = pg.evaluate(MAKE_MATCHES, {"names": ["たいら", "いっちょ"], "count": 40,
                                      "from": "2026-01-01T10:00:00.000Z",
                                      "events": 60, "uniq": True, "tag": "変"})
    print("   件数  本体字数  slim  dropped  QR版  マス")
    for k in (1, 3, 5, 10, 20, 30, 40):
        o = pg.evaluate(MAKE_LINK, {"ids": vary[:k], "base": BASE, "one": False})
        print("   %4d  %8d  %5s  %7d  %4d  %d×%d"
              % (k, o["chars"], o["slim"], o["dropped"], o["qv"], o["qs"], o["qs"]))
    vfull, vqr = 0, 0
    for k in range(1, 41):
        o = pg.evaluate(MAKE_LINK, {"ids": vary[:k], "base": BASE, "one": False})
        if o["dropped"] == 0 and not o["slim"]:
            vfull = k
        if o["dropped"] == 0 and o["qv"] <= 25:
            vqr = k
    print("   1球ごとの記録つきで1本に入るのは最大 %d 件" % vfull)
    print("   QR版25以下で渡せるのは最大 %d 件" % vqr)
    check(vfull >= 3, "重いほうの見立てでも3件以上は記録つきで入る", vfull)

    section("JSエラー")
    check(not errs, "JSエラーなし", errs[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
