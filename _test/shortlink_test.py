# -*- coding: utf-8 -*-
"""shortlink_test.py — 共有リンクを短くする（本人の指示 2026-08-22）

本人の指示:
  「リンクを短くしてください。無理なら教えて」

リンクをQRにして相手のカメラで写してもらう機能を作ったが、
**QRはマスが細かいほど読み取りに失敗する**。リンクが短いほど実用になる。

そこで送るときの書き方を版2に変えた（js/share.js）。
記録の中身は変えず、書き方だけを詰める:
  ・at のISO文字列 → 1つ前からの経過ミリ秒
  ・seq は並び順から出す／voided:false・side:null・onBreak:false は書かない
  ・イベント名・キー名を1文字の符号にする
  ・結果（result）はイベント列から計算し直せるので送らない
    （送る側で計算し直したものが1文字も違わないときだけ落とす）
  ・gzip → deflate-raw（頭とお尻の18バイトが減る）

対象:
  1. 版2で作られる（本体が「2.」で始まる）
  2. 取り込んだ試合の中身が、送る前と**1件ずつ完全に一致**する
     （seq / t / side / at / voided / d をイベントごとに突き合わせ）
  3. **版1（今までの形）のリンクも読める**（手で版1を作って読ませる）
  4. 版1のリンクは画面からも取り込める（すでにLINEで送ったリンクを殺さない）
  5. 成績（STORE.playerStats）が、直接保存した場合と取り込んだ場合で一致する
  6. **短くなった実測値**（同じ試合での文字数・QRの版とマス数）

実行: python _test/shortlink_test.py
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

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


# 送る側の端末で、ローテーション120点の試合を作って保存する。
# 画面を延々と叩くと壊れやすいので、エンジンに直接イベントを積む。
# （画面から作る道筋は share_test.py が別に確かめている）
MAKE_MATCH = """
(names) => {
  const t0 = new Date('2026-08-21T21:34:40.298Z');
  let ms = 0;
  const now = () => new Date(t0.getTime() + (ms += 961));
  const ids = names.map(n => STORE.listPlayers().find(p => p.name === n).id);
  const m = createMatch({
    gameId: 'rotation',
    sides: [{ name: names[0], playerIds: [ids[0]] },
            { name: names[1], playerIds: [ids[1]] }],
    goal: { type: 'score', targets: { A: 120, B: 120 } },
    options: {},
    firstSide: 'A',
    now: t0,
  });
  let i = 0;
  while (m.events.length < 17) {
    const side = i % 3 === 2 ? 'B' : 'A';
    appendEvent(m, { t: 'POCKET', side: side,
                     d: { balls: [(i % 15) + 1], onBreak: i === 0 } }, now());
    i++;
  }
  voidEvent(m, 5, '訂正', now());
  m.result = buildResult(m, now());
  m.updatedAt = m.events[m.events.length - 1].at;
  STORE.saveMatch(m);
  return m.id;
}
"""

# 送る側で「版1（今までの形）」の本体も作る。
# share.js は版2でしか作らなくなったので、ここで手で組む。
# これがそのまま「短くする前の実測値」になる。
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
  return { body: '1.g.' + b64, json: json.length, payload: p };
}
"""

STATS = """
(name) => {
  const p = STORE.listPlayers().find(x => x.name === name);
  const s = STORE.playerStats(p.id);
  // opponents / partners は相手のIDで引く入れ物なので、端末が違えば鍵も違う。
  // 数え方が一致しているかを見たいので、ここでは中身の件数だけ比べる
  const trim = Object.assign({}, s);
  trim.opponents = Object.keys(s.opponents || {}).length;
  trim.partners = Object.keys(s.partners || {}).length;
  return trim;
}
"""


def prepare_players(pg):
    """選手一覧の画面を出して、送る側・受け取る側の両方に同じ名前で登録する"""
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    helpers.add_player(pg, "たいら")
    helpers.add_player(pg, "いっちょ")
    pg.wait_for_timeout(200)


def qr_of(pg, url):
    return pg.evaluate("""(u) => {
      const q = QRCODE.make(u, { ecLevel: 'L' });
      return { version: q.version, size: q.size };
    }""", url)


with sync_playwright() as p:
    br = p.chromium.launch()

    # ================= 送る側 =================
    section("1. 送る側で試合を用意する")
    send = br.new_context(viewport={"width": 390, "height": 844})
    ps = send.new_page()
    errs_s = []
    ps.on("pageerror", lambda e: errs_s.append(str(e)))
    ps.goto(URL)
    ps.wait_for_timeout(700)
    prepare_players(ps)
    mid = ps.evaluate(MAKE_MATCH, ["たいら", "いっちょ"])
    src = ps.evaluate("""(id) => {
      const m = STORE.loadMatch(id);
      return { events: m.events, id: m.id, result: m.result,
               createdAt: m.createdAt, updatedAt: m.updatedAt,
               options: m.options, goal: m.goal, note: m.note,
               recordedBy: m.recordedBy, rulesetVersion: m.rulesetVersion };
    }""", mid)
    check(len(src["events"]) == 18, "18イベントの試合ができた", len(src["events"]))
    check(any(e["voided"] for e in src["events"]), "取り消した記録も入っている")

    section("2. 版2で作られる")
    new = ps.evaluate("""async (id) => {
      const m = STORE.loadMatch(id);
      const out = await SHARE.makeLink(m, 'https://hiroshit164820-create.github.io/pool-score/');
      return { url: out.url, chars: out.chars, slim: out.slim,
               dr: SHARE.canDeflateRaw() };
    }""", mid)
    body2 = new["url"].split("#")[1].split("=", 1)[1]
    print("   本体の先頭: " + body2[:4] + " / deflate-raw=" + str(new["dr"]))
    check(body2.startswith("2."), "本体が「2.」で始まる（版2）", body2[:8])
    check(body2[:4] in ("2.d.", "2.g."), "圧縮の種類が d か g", body2[:4])
    check(not new["slim"], "1球ごとの記録が入ったまま（結果だけに落ちていない）")

    old = ps.evaluate(MAKE_V1, mid)
    v1chars = len(old["body"])
    v1url = "https://hiroshit164820-create.github.io/pool-score/#m=" + old["body"]

    section("3. 短くなった実測値")
    q1 = qr_of(ps, v1url)
    q2 = qr_of(ps, new["url"])
    print("   試合まるごとのJSON : %d バイト" % old["json"])
    print("   版1（前） 本体 %4d字 / URL %4d字 / QR版%d（%d×%dマス）"
          % (v1chars, len(v1url), q1["version"], q1["size"], q1["size"]))
    print("   版2（後） 本体 %4d字 / URL %4d字 / QR版%d（%d×%dマス）"
          % (new["chars"], len(new["url"]), q2["version"], q2["size"], q2["size"]))
    print("   削減 %.1f%%（本体）" % (100.0 - 100.0 * new["chars"] / v1chars))
    check(new["chars"] < v1chars * 0.6, "本体が4割以上短くなった",
          (v1chars, new["chars"]))
    check(q2["version"] < q1["version"], "QRの版が下がった（マスが粗くなり読みやすい）",
          (q1["version"], q2["version"]))

    section("4. 版1のリンクも読める（すでに送ったリンクを殺さない）")
    old_ok = ps.evaluate("""async (arg) => {
      const got = await SHARE.decode(arg.body);
      return JSON.stringify(got) === JSON.stringify(arg.payload);
    }""", {"body": old["body"], "payload": old["payload"]})
    check(old_ok, "版1の本体を読むと、送る前の中身とそのまま一致する")

    new_ok = ps.evaluate("""async (arg) => {
      const got = await SHARE.decode(arg.body);
      return { same: JSON.stringify(got) === JSON.stringify(arg.payload) };
    }""", {"body": body2, "payload": old["payload"]})
    check(new_ok["same"], "版2の本体も、送る前の中身と1文字も違わない")
    check(not errs_s, "送る側でJSエラーなし", errs_s[:3])

    # ================= 受け取る側 =================
    section("5. 受け取る側で版2のリンクを取り込む")
    recv = br.new_context(viewport={"width": 390, "height": 844})
    pr = recv.new_page()
    errs_r = []
    pr.on("pageerror", lambda e: errs_r.append(str(e)))
    pr.goto(URL)
    pr.wait_for_timeout(700)
    prepare_players(pr)
    pr.goto(URL + "#m=" + body2)
    pr.wait_for_timeout(1500)
    check(pr.is_visible("#screenImport"), "取り込みの画面が出る")
    pr.locator("#importBody button", has_text="この試合を取り込む").click()
    pr.wait_for_timeout(1200)
    got = pr.evaluate("""(id) => {
      const m = STORE.loadMatch(id);
      return m ? { events: m.events, result: m.result, createdAt: m.createdAt,
                   updatedAt: m.updatedAt, options: m.options, goal: m.goal,
                   note: m.note, recordedBy: m.recordedBy,
                   rulesetVersion: m.rulesetVersion } : null;
    }""", mid)
    check(got is not None, "同じ試合IDで保存された")

    section("6. 中身が1件ずつ一致する")
    if got:
        a, b = src["events"], got["events"]
        check(len(a) == len(b), "イベントの件数が一致", (len(a), len(b)))
        bad = []
        for i in range(min(len(a), len(b))):
            for k in ("seq", "t", "side", "at", "voided", "d"):
                x = json.dumps(a[i].get(k), sort_keys=True, ensure_ascii=False)
                y = json.dumps(b[i].get(k), sort_keys=True, ensure_ascii=False)
                if x != y:
                    bad.append((i, k, x, y))
        check(not bad, "seq / t / side / at / voided / d が全件一致", bad[:4])
        check(json.dumps(a, ensure_ascii=False) == json.dumps(b, ensure_ascii=False),
              "イベント列がキーの並びまで含めて同じ")
        for k in ("result", "createdAt", "updatedAt", "options", "goal",
                  "note", "recordedBy", "rulesetVersion"):
            check(json.dumps(src[k], ensure_ascii=False, sort_keys=True)
                  == json.dumps(got[k], ensure_ascii=False, sort_keys=True),
                  "試合の " + k + " が一致", (src[k], got[k]))

    section("7. 成績が、直接保存した場合と取り込んだ場合で一致する")
    for name in ("たいら", "いっちょ"):
        s1 = ps.evaluate(STATS, name)
        s2 = pr.evaluate(STATS, name)
        same = (json.dumps(s1, sort_keys=True, ensure_ascii=False)
                == json.dumps(s2, sort_keys=True, ensure_ascii=False))
        diff = [] if same else [k for k in s1
                                if json.dumps(s1[k], sort_keys=True)
                                != json.dumps(s2.get(k), sort_keys=True)]
        check(same, name + " の成績が一致（%d試合 %d勝）" % (s1["matches"], s1["wins"]),
              [(k, s1[k], s2.get(k)) for k in diff])

    section("8. 版1のリンクも画面から取り込める")
    recv2 = br.new_context(viewport={"width": 390, "height": 844})
    pr2 = recv2.new_page()
    errs_r2 = []
    pr2.on("pageerror", lambda e: errs_r2.append(str(e)))
    pr2.goto(URL)
    pr2.wait_for_timeout(700)
    prepare_players(pr2)
    pr2.goto(URL + "#m=" + old["body"])
    pr2.wait_for_timeout(1500)
    check(pr2.is_visible("#screenImport"), "版1でも取り込みの画面が出る")
    pr2.locator("#importBody button", has_text="この試合を取り込む").click()
    pr2.wait_for_timeout(1200)
    got1 = pr2.evaluate("""(id) => {
      const m = STORE.loadMatch(id);
      return m ? m.events : null;
    }""", mid)
    check(got1 is not None, "版1のリンクから試合が保存された")
    if got1:
        check(json.dumps(got1, ensure_ascii=False)
              == json.dumps(src["events"], ensure_ascii=False),
              "版1から取り込んだ中身も送る前と一致")
    s3 = pr2.evaluate(STATS, "たいら")
    s1 = ps.evaluate(STATS, "たいら")
    check(json.dumps(s3, sort_keys=True, ensure_ascii=False)
          == json.dumps(s1, sort_keys=True, ensure_ascii=False),
          "版1から取り込んでも成績が一致")

    section("9. 貼り付けの読み取りが版2でも通る")
    read = pr.evaluate("""(arg) => ({
      full: SHARE.readAny(arg.url),
      withText: SHARE.readAny('ローテーションの記録です ' + arg.url),
      hashOnly: SHARE.readAny('#m=' + arg.body),
      rawOnly: SHARE.readAny(arg.body),
      junk: SHARE.readAny('こんにちは'),
    })""", {"url": new["url"], "body": body2})
    check(read["full"] == body2, "リンクまるごとから拾える")
    check(read["withText"] == body2, "文章が付いていても拾える")
    check(read["hashOnly"] == body2, "「#m=…」でも拾える")
    check(read["rawOnly"] == body2, "本体だけでも拾える（2.d.…）")
    check(read["junk"] is None, "でたらめな文字は拾わない", read["junk"])

    section("JSエラー")
    check(not errs_r, "受け取る側でJSエラーなし", errs_r[:3])
    check(not errs_r2, "版1の受け取り側でJSエラーなし", errs_r2[:3])
    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
