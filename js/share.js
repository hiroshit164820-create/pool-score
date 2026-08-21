/**
 * share.js — 試合の記録を相手に渡す（本人の指示 2026-08-21）
 *
 * 本人の困りごと:
 *   「試合記録を対戦相手にも共有する機能が欲しい。
 *     両方の端末で記録を付けるのもめんどくさい」
 *
 * 方式:
 *   サーバーを持たない作りなので、記録そのものをリンクに載せて渡す。
 *   片方だけが記録して、終わったらリンクを送る。相手は開くだけで取り込める。
 *
 *   記録（イベントの並び）を JSON にして gzip で縮め、
 *   base64url にしてURLの「#」の後ろに置く。
 *   「#」の後ろはサーバーに送られないので、記録が外に出ることはない。
 *
 *   実測（2026-08-21・JPA9ボール58イベント）:
 *     そのまま 8,651バイト → gzip 1,511バイト → リンクの文字数 約2,000字。
 *   長い試合でも入るよう、上限を超えたら「結果だけ」に落とす。
 *
 *   短くした後の実測（2026-08-22・ローテーション120点18イベント・同じ試合）:
 *     版1 1,258字（QR版26・121×121マス）→ 版2 450字（QR版15・77×77マス）。
 *     64%減。QRのマスが粗くなるぶん、相手のカメラで読み取りやすくなる。
 *
 * 形式: #m=<版>.<圧縮の種類>.<本体>
 *   版         … 1（初代）/ 2（短くした形。2026-08-22〜）
 *                 3（複数の試合を1本にまとめた形。2026-08-22〜）
 *   圧縮の種類 … d=deflate-raw / g=gzip / r=そのまま（圧縮に未対応の端末）
 *
 *   **版1のリンクも今までどおり読める**。すでに送ったリンクを死なせないため
 *   （受け取り側は取り込むまで放置していることがある）。
 *
 * 版3: 複数の試合をまとめて渡す（本人の指示 2026-08-22）
 *
 *   本人の困りごと:
 *     「試合結果を複数件まとめて送ることもできる？
 *       履歴にチェックボックス付けて、複数選択してからまとめて送信みたいな」
 *
 *   中身は {"v":3,"m":[試合, 試合, …]}。中の1件ずつは版2と同じ詰め方なので、
 *   同じ選手名・同じ設定が繰り返されるぶんは圧縮がまとめて効く。
 *
 *   1件だけ渡されたときは版3にせず**版2のまま**送る。
 *   そのほうが短く、古いアプリでも読めるため。
 */
const SHARE = (function () {
  "use strict";

  // 作るときの版。読むほうは版1も受け付ける（下の READABLE）
  const VERSION = "2";
  // 複数まとめのときの版（1件だけのときは VERSION のまま）
  const VERSION_MULTI = "3";
  const READABLE = { "1": true, "2": true, "3": true };
  const HASH_KEY = "m";
  // これを超えたら「結果だけ」に落とす。
  // 長いリンクは送り先（SMS等）で切られることがあるため
  const MAX_CHARS = 6000;

  /* ---------- base64url ---------- */

  function bytesToB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlToBytes(str) {
    const s = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4 ? "====".slice(s.length % 4) : "";
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* ---------- 圧縮（使える端末だけ） ---------- */

  function canGzip() {
    return typeof CompressionStream !== "undefined"
      && typeof DecompressionStream !== "undefined";
  }

  /**
   * deflate-raw が使えるか（2026-08-22 追加）。
   * gzip は先頭と末尾に18バイトの飾りが付く。deflate-raw はそれが無いぶん短い。
   * 対応していない端末では例外になるので、実際に作って確かめる。
   */
  let rawDeflateOk = null;
  function canDeflateRaw() {
    if (rawDeflateOk !== null) return rawDeflateOk;
    if (!canGzip()) { rawDeflateOk = false; return false; }
    try {
      new CompressionStream("deflate-raw");
      new DecompressionStream("deflate-raw");
      rawDeflateOk = true;
    } catch (e) {
      rawDeflateOk = false;
    }
    return rawDeflateOk;
  }

  function gzip(text, algo) {
    const cs = new CompressionStream(algo || "gzip");
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(text)).catch(function () {});
    w.close().catch(function () {});
    return new Response(cs.readable).arrayBuffer()
      .then(function (buf) { return new Uint8Array(buf); });
  }

  function gunzip(bytes, algo) {
    const ds = new DecompressionStream(algo || "gzip");
    const w = ds.writable.getWriter();
    // リンクが途中で切れていると、書き込む側でも別に失敗が起きる。
    // 理由は下の arrayBuffer 側で出すので、ここは黙って捨てる。
    // 捨てないと「拾われなかった失敗」として画面の外に出る（実測 2026-08-22）
    w.write(bytes).catch(function () {});
    w.close().catch(function () {});
    return new Response(ds.readable).arrayBuffer()
      .then(function (buf) { return new TextDecoder().decode(buf); })
      .catch(function () {
        throw new Error("リンクが途中で切れているようです");
      });
  }

  /* ---------- 版2: 送る形を短くする（本人の指示 2026-08-22） ----------
   *
   * 本人の困りごと:
   *   「リンクを短くしてください。無理なら教えて」
   *   リンクをQRにして相手に写してもらうので、マスが細かいほど読み取りに失敗する。
   *
   * 記録の中身は同じまま、**書き方だけ**を詰める。
   *   ・at のISO文字列（1件33バイト）→ 1つ前からの経過ミリ秒
   *   ・seq は並び順から出せるので、飛んでいるときだけ書く
   *   ・voided:false / side:null / onBreak:false は既定値なので書かない
   *   ・イベント名・キー名を1文字の符号にする
   *   ・同じ種類の値を1本にまとめる（縦に並べたほうが圧縮が効く）
   *
   * **戻したときに1バイトも変わらないこと**を、作る側で毎回確かめる
   *   （expandPayload(compactPayload(p)) を元と突き合わせる）。
   *   合わなければその試合だけ版1の形で送る。だから壊れようがない。
   */

  // イベント名 → 1文字。ここに無い名前は "~" に逃がして別に持つ
  const T_CODE = {
    MATCH_START: "M", RACK_START: "R", POCKET: "P", TURN_END: "T",
    FOUL: "F", SAFETY: "S", VOID: "V", MATCH_END: "E", RACK_WIN: "W",
    SL: "L", SHOT_CLOCK: "C", INNING_ADJ: "I", DEAD_BALLS: "D", STEP: "X",
  };
  const T_NAME = (function () {
    const o = {};
    Object.keys(T_CODE).forEach(function (k) { o[T_CODE[k]] = k; });
    return o;
  })();

  // d の中のキー → 1文字（A・B はそのまま使うので避ける）
  const D_CODE = {
    balls: "b", onBreak: "o", rackNo: "r", breakSide: "k", auto: "a",
    manual: "m", continuation: "c", firstSide: "f", targetSeq: "q",
    reason: "n", winner: "w", by: "y", hasUnresolvedError: "h",
    event: "e", usedSec: "u", delta: "l", count: "x", safety: "s",
    kind: "i", warned: "g", result: "z",
  };
  const D_NAME = (function () {
    const o = {};
    Object.keys(D_CODE).forEach(function (k) { o[D_CODE[k]] = k; });
    return o;
  })();

  // 試合まるごとのキー → 短い名前
  const P_CODE = {
    id: "i", gameId: "g", createdAt: "c", updatedAt: "u",
    rulesetVersion: "rv", sides: "s", goal: "gl", options: "o",
    recordedBy: "rb", note: "n", result: "r", slim: "sl",
  };
  // 設定（options）・勝利条件（goal）のキー → 短い名前。入れ子にも当てる
  const O_CODE = {
    breakType: "bt", shotClock: "sc", chessClock: "cc", inputMode: "im",
    enabled: "en", seconds: "se", extensions: "ex", minutes: "mn",
    ballSet: "bs", countInnings: "ci", allowMultiScorePerInning: "am",
    penaltyMode: "pm", stepResetOnMiss: "sr",
    type: "ty", targets: "tg", sets: "st", ballHandicap: "bh",
    memberHandicap: "mh", meta: "mt", points: "pt", races: "rc",
  };
  const O_NAME = (function () {
    const o = {};
    Object.keys(O_CODE).forEach(function (k) { o[O_CODE[k]] = k; });
    return o;
  })();

  const DEFAULT_RULESET = "2026-06";

  function isPlainObject(x) {
    return x && typeof x === "object" && !Array.isArray(x);
  }

  /**
   * 短い名前と元のキーがぶつかっていないか。
   * ぶつかっていたら短くしない（戻せなくなるため）
   */
  function safeToShorten(x) {
    if (Array.isArray(x)) return x.every(safeToShorten);
    if (!isPlainObject(x)) return true;
    return Object.keys(x).every(function (k) {
      return !O_NAME[k] && safeToShorten(x[k]);
    });
  }

  function mapKeys(x, table) {
    if (Array.isArray(x)) return x.map(function (v) { return mapKeys(v, table); });
    if (!isPlainObject(x)) return x;
    const out = {};
    Object.keys(x).forEach(function (k) { out[table[k] || k] = mapKeys(x[k], table); });
    return out;
  }

  function shortenObj(x) {
    return safeToShorten(x) ? mapKeys(x, O_CODE) : x;
  }
  function restoreObj(x) {
    return mapKeys(x, O_NAME);
  }

  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /** d を詰める。既定値（POCKETの onBreak:false）は落とす */
  function packD(t, d) {
    const out = {};
    Object.keys(d).forEach(function (k) {
      if (t === "POCKET" && k === "onBreak" && d[k] === false) return;
      out[D_CODE[k] || k] = d[k];
    });
    // 落とした球だけの記録（いちばん多い）は、配列そのものにする
    if (t === "POCKET") {
      const keys = Object.keys(out);
      if (keys.length === 1 && keys[0] === "b" && Array.isArray(out.b)) return out.b;
    }
    return out;
  }

  /** 詰めた d を戻す */
  function unpackD(t, d) {
    if (Array.isArray(d)) return { balls: d, onBreak: false };
    const out = {};
    Object.keys(d).forEach(function (k) { out[D_NAME[k] || k] = d[k]; });
    if (t === "POCKET" && !("onBreak" in out)) out.onBreak = false;
    return out;
  }

  /** イベント列を詰める。縦（同じ種類ごと）に並べる */
  function packEvents(events) {
    const evs = events || [];
    if (!evs.length) return { n: 0 };
    const base = Date.parse(evs[0].at);
    const out = {
      n: evs.length,
      t0: evs[0].at,     // 1件目はそのまま持つ（戻すときの基準）
      k: "",             // イベント名（1文字ずつ）
      s: "",             // 手番（- = 無し / A / B / ? = それ以外）
      dt: [],            // 1つ前からの経過ミリ秒
      d: [],             // 中身（空なら 0）
    };
    const kx = [];       // 符号に無いイベント名
    const sx = [];       // A・B 以外の手番
    const vd = [];       // 無効にした記録の位置
    const sq = {};       // 並び順から出せない seq
    const ax = {};       // 経過ミリ秒から戻せない at
    let prev = base;
    evs.forEach(function (e, idx) {
      const code = T_CODE[e.t];
      if (code) { out.k += code; } else { out.k += "~"; kx.push(e.t); }

      if (e.side === null || e.side === undefined) out.s += "-";
      else if (e.side === "A" || e.side === "B") out.s += e.side;
      else { out.s += "?"; sx.push(e.side); }

      const ms = Date.parse(e.at);
      if (isNaN(ms) || new Date(ms).toISOString() !== e.at) {
        ax[idx] = e.at;
        out.dt.push(0);
      } else {
        out.dt.push(ms - prev);
        prev = ms;
      }

      if (e.voided) vd.push(idx);
      if (e.seq !== idx + 1) sq[idx] = e.seq;

      const d = e.d || {};
      const packed = packD(e.t, d);
      // 戻したときに一致しないものは、そのまま持つ（壊さないため）
      out.d.push(sameJson(unpackD(e.t, packed), d) ? packed : { "~": d });
    });
    // 空の入れ物は書かない
    if (kx.length) out.kx = kx;
    if (sx.length) out.sx = sx;
    if (vd.length) out.vd = vd;
    if (Object.keys(sq).length) out.sq = sq;
    if (Object.keys(ax).length) out.ax = ax;
    if (out.d.every(function (d) { return !Array.isArray(d) && !Object.keys(d).length; })) {
      delete out.d;
    }
    if (!/[^-]/.test(out.s)) delete out.s;
    return out;
  }

  /** 詰めたイベント列を戻す */
  function unpackEvents(c) {
    const n = c && c.n ? c.n : 0;
    if (!n) return [];
    const kx = (c.kx || []).slice();
    const sx = (c.sx || []).slice();
    const vd = c.vd || [];
    const sq = c.sq || {};
    const ax = c.ax || {};
    const ds = c.d || [];
    const sides = c.s || "";
    let prev = Date.parse(c.t0);
    const out = [];
    for (let i = 0; i < n; i++) {
      const code = c.k.charAt(i);
      const t = code === "~" ? kx.shift() : T_NAME[code];
      const sc = sides.charAt(i) || "-";
      const side = sc === "-" ? null : (sc === "?" ? sx.shift() : sc);
      let at;
      if (Object.prototype.hasOwnProperty.call(ax, i)) {
        at = ax[i];
      } else {
        prev = prev + (c.dt[i] || 0);
        at = new Date(prev).toISOString();
      }
      const raw = ds[i] || {};
      const d = (!Array.isArray(raw) && Object.prototype.hasOwnProperty.call(raw, "~"))
        ? raw["~"] : unpackD(t, raw);
      out.push({
        seq: Object.prototype.hasOwnProperty.call(sq, i) ? sq[i] : i + 1,
        t: t,
        side: side,
        at: at,
        voided: vd.indexOf(i) >= 0,
        d: d,
      });
    }
    return out;
  }

  /**
   * 結果（result）は、イベント列から engine が計算し直せる値。
   * 実測でリンクの中でいちばん重い（版2の中身1,526バイトのうち852バイト）ので、
   * **計算し直したものが送る側の結果と1文字も違わないときだけ**落とす。
   * 終わった時刻（endedAt）だけは計算では出せないので残す。
   *
   * @returns 落としてよければ endedAt の文字列。だめなら null
   */
  function droppableResult(p) {
    if (!p.result || !p.events || !p.events.length) return null;
    if (typeof buildResult !== "function") return null;
    const endedAt = p.result.endedAt;
    if (!endedAt) return null;
    try {
      const again = rebuildResult(p, endedAt);
      return sameJson(again, p.result) ? endedAt : null;
    } catch (e) {
      return null;
    }
  }

  /** イベント列から結果を計算し直す */
  function rebuildResult(p, endedAt) {
    return buildResult({
      id: p.id, gameId: p.gameId, rulesetVersion: p.rulesetVersion,
      sides: p.sides, goal: p.goal, options: p.options || {},
      recordedBy: p.recordedBy, events: p.events,
    }, new Date(endedAt));
  }

  /** 試合まるごとを詰める（版2の中身） */
  function compactPayload(p) {
    const out = { v: 2 };
    const evs = p.events || [];
    const firstAt = evs.length ? evs[0].at : null;
    const lastAt = evs.length ? evs[evs.length - 1].at : null;
    const endedAt = droppableResult(p);
    Object.keys(p).forEach(function (k) {
      if (k === "v" || k === "events") return;
      const val = p[k];
      if (k === "note" && !val) return;
      // 時刻はイベント列から出せるものは書かない
      if (k === "createdAt" && val === firstAt) return;
      if (k === "updatedAt" && (val === p.createdAt || val === lastAt)) return;
      if (k === "rulesetVersion" && val === DEFAULT_RULESET) return;
      if (k === "result" && endedAt) return;
      if (k === "options" || k === "goal") {
        out[P_CODE[k]] = shortenObj(val);
        return;
      }
      out[P_CODE[k] || k] = val;
    });
    if (endedAt) out.re = endedAt;            // 結果は計算し直す。終わった時刻だけ持つ
    if (p.updatedAt && p.updatedAt === lastAt && p.updatedAt !== p.createdAt) out.ul = 1;
    out.s = (p.sides || []).map(function (s) {
      const o = { i: s.sideId, n: s.name };
      if (s.teamLabel) o.t = s.teamLabel;
      if (s.members) o.m = s.members;
      if (s.guest) o.g = 1;
      return o;
    });
    out.e = packEvents(p.events);
    return out;
  }

  /** 詰めた中身を元の形に戻す */
  function expandPayload(c) {
    const out = { v: 1 };
    const back = {};
    Object.keys(P_CODE).forEach(function (k) { back[P_CODE[k]] = k; });
    Object.keys(c).forEach(function (k) {
      if (k === "v" || k === "e" || k === "s" || k === "re" || k === "ul") return;
      out[back[k] || k] = c[k];
    });
    if ("options" in out) out.options = restoreObj(out.options);
    if ("goal" in out) out.goal = restoreObj(out.goal);
    out.sides = (c.s || []).map(function (s) {
      return {
        sideId: s.i, name: s.n,
        teamLabel: s.t || null, members: s.m || null,
        guest: !!s.g,
      };
    });
    if (!("rulesetVersion" in out)) out.rulesetVersion = DEFAULT_RULESET;
    if (!("note" in out)) out.note = "";
    out.events = unpackEvents(c.e);
    const evs = out.events;
    if (!("createdAt" in out) && evs.length) out.createdAt = evs[0].at;
    if (!("updatedAt" in out)) {
      out.updatedAt = (c.ul && evs.length) ? evs[evs.length - 1].at : out.createdAt;
    }
    if (c.re) {
      if (typeof buildResult !== "function") {
        throw new Error("この端末では開けません。アプリを更新してください");
      }
      out.result = rebuildResult(out, c.re);
    }
    // 元と同じ並びに整える（突き合わせやすさのため）
    const order = ["v", "id", "gameId", "createdAt", "updatedAt",
      "rulesetVersion", "sides", "goal", "options", "recordedBy",
      "note", "events", "result", "slim"];
    const sorted = {};
    order.forEach(function (k) { if (k in out) sorted[k] = out[k]; });
    Object.keys(out).forEach(function (k) { if (!(k in sorted)) sorted[k] = out[k]; });
    return sorted;
  }

  /* ---------- 送るときの中身 ---------- */

  /**
   * 相手に渡す形にする。
   *
   * 選手のID（playerIds）は相手の端末では意味が無いので入れない。
   * 誰なのかは、取り込むときに名前を見て対応付ける。
   */
  function payloadFull(match) {
    return {
      v: 1,
      id: match.id,
      gameId: match.gameId,
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      rulesetVersion: match.rulesetVersion,
      sides: match.sides.map(function (s) {
        return {
          sideId: s.sideId, name: s.name,
          teamLabel: s.teamLabel || null, members: s.members || null,
          guest: !!s.guest,
        };
      }),
      goal: match.goal,
      options: match.options,
      recordedBy: match.recordedBy,
      note: match.note || "",
      events: match.events,
      result: match.result,
    };
  }

  /** 記録が長すぎるときの落としどころ。結果だけを渡す */
  function payloadSlim(match) {
    const p = payloadFull(match);
    p.events = [];
    p.slim = true;
    return p;
  }

  /** 中身（JSONにできる物）を <版>.<圧縮>.<本体> の形にする */
  function encodeBody(ver, body) {
    const json = JSON.stringify(body);
    if (!canGzip()) {
      return Promise.resolve(
        ver + ".r." + bytesToB64url(new TextEncoder().encode(json))
      );
    }
    const algo = canDeflateRaw() ? "deflate-raw" : "gzip";
    const code = algo === "deflate-raw" ? "d" : "g";
    return gzip(json, algo).then(function (bytes) {
      return ver + "." + code + "." + bytesToB64url(bytes);
    });
  }

  /**
   * 版2の形に詰める。戻したときに元と1バイトも変わらないことを毎回確かめ、
   * 合わなければその試合だけ版1の形（詰めない形）にする。だから壊れようがない。
   * @returns {ver, body}
   */
  function compactOrFull(p) {
    if (VERSION === "2") {
      const c = compactPayload(p);
      if (sameJson(expandPayload(c), p)) return { ver: "2", body: c };
    }
    return { ver: "1", body: p };
  }

  /** 1試合ぶんを本体の文字列にする（版1 or 版2） */
  function packOne(p) {
    const r = compactOrFull(p);
    return encodeBody(r.ver, r.body);
  }

  /** 複数の試合を1本の本体にする（版3） */
  function packMany(matches, slim) {
    const items = matches.map(function (m) {
      return compactOrFull(slim ? payloadSlim(m) : payloadFull(m)).body;
    });
    return encodeBody(VERSION_MULTI, { v: 3, m: items });
  }

  /** 新しい順に並べ替える（同じ時刻なら渡された順） */
  function newestFirst(list) {
    return list.map(function (m, i) {
      const t = Date.parse((m && (m.updatedAt || m.createdAt)) || "");
      return { m: m, i: i, t: isNaN(t) ? 0 : t };
    }).sort(function (a, b) {
      return b.t - a.t || a.i - b.i;
    });
  }

  /**
   * 新しいほうから k 件を選び、**渡された順に並べ直す**。
   * 長さを測るときと実際に送るときで、並びが違うと縮み方も違ってしまうので、
   * どちらもこの関数で作った同じ物を使う
   */
  function pickNewest(sorted, k) {
    return sorted.slice(0, k).slice().sort(function (a, b) {
      return a.i - b.i;
    }).map(function (x) { return x.m; });
  }

  /**
   * この顔ぶれで送れる、いちばん詳しい形を作る。
   *   1球ごとの記録つきで入るならそれ。入らなければ「結果だけ」に落とす。
   *
   * **「結果だけ」のほうが長くなることがある**（実測 2026-08-22）。
   * 1球ごとの記録があれば結果は計算し直せるので送らずに済むが、
   * 記録を落とすと結果そのものを載せるしかなくなるため。
   * 短い試合＋長いメモだと、結果だけのほうが太る。
   * だから「落としたら入った」ではなく、**入るほうを選ぶ**。
   *
   * @returns Promise<{body, slim, fits}>
   */
  function packFit(matches) {
    return packMany(matches, false).then(function (bf) {
      if (bf.length <= MAX_CHARS) return { body: bf, slim: false, fits: true };
      return packMany(matches, true).then(function (bs) {
        // どちらも入らないときは、短いほうを持って帰る
        if (bs.length > MAX_CHARS && bf.length < bs.length) {
          return { body: bf, slim: false, fits: false };
        }
        return { body: bs, slim: true, fits: bs.length <= MAX_CHARS };
      });
    });
  }

  /**
   * 新しい順に何件まで入るかを探す（上限 MAX_CHARS）。
   * 件数が増えれば本体も伸びるので、半分ずつに割って探す（作り直す回数を減らすため）
   * @returns Promise<件数>  0 なら1件も入らない
   */
  function fitCount(sorted, lo, hi) {
    if (lo > hi) return Promise.resolve(lo - 1);
    const mid = Math.floor((lo + hi) / 2);
    return packFit(pickNewest(sorted, mid)).then(function (r) {
      if (r.fits) return fitCount(sorted, mid + 1, hi);
      return fitCount(sorted, lo, mid - 1);
    });
  }

  /**
   * 複数の試合を1本のリンクにする。
   *
   * 長さが上限を超えたときの落とし方（この順）:
   *   1. まず全件を「結果だけ」に落として入るか試す
   *   2. それでも入らなければ、**新しい試合から順に**入るだけ入れて、
   *      残りを dropped に数える（古いほうから落とす。
   *      新しい試合のほうが渡したい相手に近いため）
   */
  function makeLinkMany(list, base) {
    function wrap(body, slim, count, dropped) {
      return {
        url: base + "#" + HASH_KEY + "=" + body,
        chars: body.length, slim: slim, count: count, dropped: dropped,
      };
    }
    const n = list.length;
    // 1. 全件で試す（入らなければ「結果だけ」に落として試す）
    return packFit(list).then(function (r) {
      if (r.fits) return wrap(r.body, r.slim, n, 0);
      // 2. それでも入らないので、新しいほうから入るだけ入れる
      const sorted = newestFirst(list);
      return fitCount(sorted, 1, n - 1).then(function (k) {
        // 1件も入らないときでも、いちばん新しい1件は渡す
        const keep = Math.max(1, k);
        return packFit(pickNewest(sorted, keep)).then(function (r2) {
          return wrap(r2.body, r2.slim, keep, n - keep);
        });
      });
    });
  }

  /**
   * 試合をリンクにする。
   *
   * @param matchOrArray 1試合、または試合の配列（複数まとめて渡すとき）
   * @returns Promise<{url, chars, slim, count, dropped}>
   *          count   … 実際にリンクに入った試合の数
   *          dropped … 長さの上限で入りきらず外した試合の数（0 なら全部入った）
   *          slim    … 1件でも「結果だけ」に落としたか
   */
  function makeLink(matchOrArray, baseUrl) {
    const base = (baseUrl || location.href).split("#")[0];
    if (Array.isArray(matchOrArray)) {
      if (!matchOrArray.length) {
        return Promise.reject(new Error("渡す試合が選ばれていません"));
      }
      // 1件だけなら今までどおり版2で送る（そのほうが短く、古いアプリでも読める）
      if (matchOrArray.length > 1) return makeLinkMany(matchOrArray, base);
      return makeLink(matchOrArray[0], baseUrl);
    }
    const match = matchOrArray;

    return packOne(payloadFull(match)).then(function (body) {
      if (body.length <= MAX_CHARS) {
        return {
          url: base + "#" + HASH_KEY + "=" + body, chars: body.length,
          slim: false, count: 1, dropped: 0,
        };
      }
      // 長すぎるときは、1球ごとの記録を落として結果だけにする
      return packOne(payloadSlim(match)).then(function (body2) {
        return {
          url: base + "#" + HASH_KEY + "=" + body2, chars: body2.length,
          slim: true, count: 1, dropped: 0,
        };
      });
    });
  }

  /* ---------- 受け取るとき ---------- */

  /** URLの「#」の後ろから、渡された記録を取り出す。無ければ null */
  function readHash(href) {
    const h = (href || location.href).split("#")[1] || "";
    const m = h.match(new RegExp("(?:^|&)" + HASH_KEY + "=([^&]+)"));
    return m ? m[1] : null;
  }

  /**
   * 貼り付けられた文字列から記録を取り出す（本人の指示 2026-08-22）。
   *
   * 本人の困りごと:
   *   「LINEで開いたブラウザにしか取り込まれず、
   *     ホーム画面のアイコンから開いたアプリの方に入らない」
   *
   *   ホーム画面のアプリとLINEの中のブラウザは、同じアプリに見えても
   *   保存場所が別々で、片方に取り込んでももう片方には現れない。
   *   そこで、リンクの文字列そのものをアプリに貼り付けて取り込めるようにする。
   *
   * 受け付ける形（どれでも通る）:
   *   1. リンクまるごと（前後に文章が付いていてもよい）
   *   2. 「#m=…」や「m=…」だけ
   *   3. 本体だけ（1.g.… ）
   * @returns 本体の文字列。見つからなければ null
   */
  function readAny(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    // 本体に使う文字は英数字と「.」「-」「_」だけなので、
    // 日本語の文章がくっついていてもそこで切れる
    const m = t.match(new RegExp("(?:^|[#&?])" + HASH_KEY + "=([0-9A-Za-z._-]+)"));
    if (m) return m[1];
    if (/^[0-9]+\.[a-z]\.[0-9A-Za-z._-]+$/.test(t)) return t;
    return null;
  }

  /**
   * 取り出した文字列を記録に戻す。**常に配列**で返す。
   *
   * 版1・版2（1試合ぶんの今までのリンク）も、1件だけの配列にして返す。
   * これより先（取り込み・保存・集計）は、どの版でも同じものを見る。
   * @returns Promise<object[]>
   */
  function decodeAll(body) {
    const parts = (body || "").split(".");
    if (parts.length < 3) return Promise.reject(new Error("形式が違います"));
    const ver = parts[0];
    if (!READABLE[ver]) {
      return Promise.reject(new Error("このアプリより新しい形式です。更新してください"));
    }
    const bytes = b64urlToBytes(parts.slice(2).join("."));
    let text;
    if (parts[1] === "g" || parts[1] === "d") {
      const algo = parts[1] === "d" ? "deflate-raw" : "gzip";
      if (parts[1] === "d" && !canDeflateRaw()) {
        return Promise.reject(new Error("この端末では開けません（圧縮に未対応）"));
      }
      text = canGzip() ? gunzip(bytes, algo)
        : Promise.reject(new Error("この端末では開けません（圧縮に未対応）"));
    } else {
      text = Promise.resolve(new TextDecoder().decode(bytes));
    }
    return Promise.resolve(text).then(function (json) {
      const obj = JSON.parse(json);
      // 版3は複数まとめ。中の1件ずつは版2（詰めた形）か版1（そのままの形）
      const raw = (ver === "3")
        ? ((obj && obj.m) || [])
        : [obj];
      const list = raw.map(function (one) {
        // 版2は詰めた形なので、ここで元の形に戻す
        if (ver === "2") return expandPayload(one);
        if (ver === "3" && one && one.v === 2) return expandPayload(one);
        return one;
      });
      if (!list.length) throw new Error("中身が読めません");
      list.forEach(function (o) {
        if (!o || !o.id || !o.gameId) throw new Error("中身が読めません");
      });
      return list;
    });
  }

  /**
   * 取り出した文字列を記録に戻す（1件目だけ）。
   * 今までの呼び出しをそのまま通すために残している。
   * @returns Promise<object>
   */
  function decode(body) {
    return decodeAll(body).then(function (list) { return list[0]; });
  }

  /** URLから「#」の記録を消す（取り込んだあと、再読み込みで二重に出さないため） */
  function clearHash() {
    if (history && history.replaceState) {
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      location.hash = "";
    }
  }

  /* ---------- 取り込み ---------- */

  /**
   * 渡された記録を、この端末の試合として保存する。
   *
   * @param payload  decode() の結果
   * @param mapping  {A: playerId|null, B: playerId|null} 誰として数えるか。
   *                 null なら成績に入れない（記録だけ残す）
   */
  function importMatch(payload, mapping) {
    const map = mapping || {};
    const match = {
      id: payload.id,
      schemaVersion: 1,
      ownerId: "shared",
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt || payload.createdAt,
      syncState: "imported",
      deletedAt: null,
      gameId: payload.gameId,
      rulesetVersion: payload.rulesetVersion || "2026-06",
      sides: payload.sides.map(function (s) {
        const pid = map[s.sideId] || null;
        return {
          sideId: s.sideId,
          // 対応付けた人がいれば、こちらの端末での名前に置き換える
          name: (pid && nameOfPlayer(pid)) || s.name,
          // 対応付けなかった側は playerIds が空になり、成績には入らない
          playerIds: pid ? [pid] : [],
          teamLabel: s.teamLabel || null,
          members: s.members || null,
          guest: !pid,
        };
      }),
      goal: payload.goal,
      options: payload.options || {},
      events: payload.events || [],
      recordedBy: payload.recordedBy || "A",
      result: payload.result,
      note: payload.note || "",
      // どこから来た記録かを残す（自分で付けた記録と区別できるように）
      sharedFrom: payload.sides.map(function (s) { return s.name; }).join(" 対 "),
    };
    if (!STORE.saveMatch(match)) return null;

    // 次からは同じ人に自動で結び付くよう、名前の対応を覚えておく
    const s = STORE.getSettings();
    const nm = s.sharedNameMap || {};
    payload.sides.forEach(function (side) {
      const pid = map[side.sideId];
      if (pid) nm[side.name] = pid;
    });
    s.sharedNameMap = nm;
    STORE.saveSettings(s);

    return match;
  }

  function nameOfPlayer(id) {
    const p = STORE.findPlayerById(id);
    return p ? p.name : null;
  }

  /** すでに同じ試合を持っているか */
  function alreadyHave(id) {
    return STORE.listMatches().some(function (m) { return m.id === id; });
  }

  /**
   * 送られてきた名前から、この端末の選手を推し量る。
   *   1. 前に対応付けた記録（覚えている組み合わせ）
   *   2. 名前がそのまま一致する人
   * どちらも無ければ null（取り込むときに選んでもらう）
   */
  function guessPlayer(name) {
    const s = STORE.getSettings();
    const nm = s.sharedNameMap || {};
    if (nm[name] && STORE.findPlayerById(nm[name])) return nm[name];
    const p = STORE.findPlayerByName(name);
    return p ? p.id : null;
  }

  return {
    makeLink: makeLink,
    readHash: readHash,
    readAny: readAny,
    decode: decode,
    decodeAll: decodeAll,
    clearHash: clearHash,
    importMatch: importMatch,
    alreadyHave: alreadyHave,
    guessPlayer: guessPlayer,
    canGzip: canGzip,
    canDeflateRaw: canDeflateRaw,
    VERSION: VERSION,
    VERSION_MULTI: VERSION_MULTI,
    // 検証用（版2の詰め方を単体で確かめるため）
    _compact: compactPayload,
    _expand: expandPayload,
    MAX_CHARS: MAX_CHARS,
  };
})();
