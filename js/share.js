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
 * 形式: #m=<版>.<圧縮の種類>.<本体>
 *   版         … 1
 *   圧縮の種類 … g=gzip / r=そのまま（CompressionStream が無い端末）
 */
const SHARE = (function () {
  "use strict";

  const VERSION = "1";
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

  /* ---------- gzip（使える端末だけ） ---------- */

  function canGzip() {
    return typeof CompressionStream !== "undefined"
      && typeof DecompressionStream !== "undefined";
  }

  function gzip(text) {
    const cs = new CompressionStream("gzip");
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(text));
    w.close();
    return new Response(cs.readable).arrayBuffer()
      .then(function (buf) { return new Uint8Array(buf); });
  }

  function gunzip(bytes) {
    const ds = new DecompressionStream("gzip");
    const w = ds.writable.getWriter();
    w.write(bytes);
    w.close();
    return new Response(ds.readable).arrayBuffer()
      .then(function (buf) { return new TextDecoder().decode(buf); });
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

  /**
   * 試合をリンクにする。
   * @returns Promise<{url, chars, slim}>
   */
  function makeLink(match, baseUrl) {
    const base = (baseUrl || location.href).split("#")[0];

    function pack(obj) {
      const json = JSON.stringify(obj);
      if (!canGzip()) {
        return Promise.resolve(
          VERSION + ".r." + bytesToB64url(new TextEncoder().encode(json))
        );
      }
      return gzip(json).then(function (bytes) {
        return VERSION + ".g." + bytesToB64url(bytes);
      });
    }

    return pack(payloadFull(match)).then(function (body) {
      if (body.length <= MAX_CHARS) {
        return { url: base + "#" + HASH_KEY + "=" + body, chars: body.length, slim: false };
      }
      // 長すぎるときは、1球ごとの記録を落として結果だけにする
      return pack(payloadSlim(match)).then(function (body2) {
        return { url: base + "#" + HASH_KEY + "=" + body2, chars: body2.length, slim: true };
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

  /** 取り出した文字列を記録に戻す。@returns Promise<object> */
  function decode(body) {
    const parts = (body || "").split(".");
    if (parts.length < 3) return Promise.reject(new Error("形式が違います"));
    if (parts[0] !== VERSION) {
      return Promise.reject(new Error("このアプリより新しい形式です。更新してください"));
    }
    const bytes = b64urlToBytes(parts.slice(2).join("."));
    const text = parts[1] === "g"
      ? (canGzip() ? gunzip(bytes)
        : Promise.reject(new Error("この端末では開けません（圧縮に未対応）")))
      : Promise.resolve(new TextDecoder().decode(bytes));
    return Promise.resolve(text).then(function (json) {
      const obj = JSON.parse(json);
      if (!obj || !obj.id || !obj.gameId) throw new Error("中身が読めません");
      return obj;
    });
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
    decode: decode,
    clearHash: clearHash,
    importMatch: importMatch,
    alreadyHave: alreadyHave,
    guessPlayer: guessPlayer,
    canGzip: canGzip,
    MAX_CHARS: MAX_CHARS,
  };
})();
