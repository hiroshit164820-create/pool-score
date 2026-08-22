/**
 * csv.js — 成績・試合履歴を表計算ソフトに書き出す
 *
 * 形式は CSV。ExcelでもGoogleスプレッドシートでもそのまま開ける。
 * 日本語が文字化けしないよう、先頭にBOMを付けたUTF-8で書き出す
 * （BOMが無いとExcelがShift-JISとして読んでしまう）。
 *
 * サーバーは使わない。ブラウザの中だけで作ってダウンロードするので、
 * 記録が外に出ることはない。
 *
 * ── 表計算ソフトの「勝手な変換」を止める（本人の指示 2026-08-22）──
 * 「5-4」のようなスコアをそのまま書くと Excel が日付（5月4日）に変えてしまう。
 * 実機（Excel 16.0・日本語環境、2026-08-22 実測）で4つの方法を比べた結果:
 *
 *   そのまま書く       5-4→5月4日 / 007→7 / 0912345678→9.12E+08 / =1+1→2（数式が動く）
 *   引用符で囲む       同上（"5-4" と囲んでも 5月4日 になる。囲むだけでは効かない）
 *   先頭に ' を付ける  セルに ' の文字がそのまま残る（見た目が汚れる）→不採用
 *   先頭にタブを付ける セルにタブが残る→不採用
 *   ="5-4" の形        5-4 のまま・書式も標準・=1+1 も文字のまま→これを採用
 *
 * ="..." は「文字列そのものを返す数式」なので、中身が =cmd|... のような
 * 危険な文字列でも実行されない（同じ実測で確認）。
 * 変換される恐れがある値にだけ付ける。ふつうの数値は数値のまま出す
 * （表計算側で合計や平均を計算できるようにするため）。
 */

const CSVOUT = (function () {
  /** 数えていない項目に入れる印（本人の指示 2026-08-22）。0（本当に0回）と区別する */
  const NC = "-";

  /* ---------- 表計算ソフトの勝手な変換を止める ---------- */

  /** 日付・時刻に化ける形か（5-4 / 1-2 / 2026-08 / 3/4 / 1:2 / Mar-5） */
  function looksLikeDate(s) {
    return /^\d{1,4}[-/.]\d{1,4}([-/.]\d{1,4})?$/.test(s)
      || /^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(s)
      || /^[A-Za-z]{3,9}[-/ ]\d{1,4}$/.test(s)
      || /^\d{1,4}[-/ ][A-Za-z]{3,9}$/.test(s);
  }

  /** 数値として読まれて形が変わる形（先頭の0が消える / 指数表記になる） */
  function looksLikeNumberShift(s) {
    return /^0\d+$/.test(s)
      || /^\d{12,}$/.test(s)
      || /^[+-]?\d*\.?\d+[eE][+-]?\d+$/.test(s);
  }

  /** 数式として実行される恐れがある形（先頭が = + - @ タブ 復帰） */
  function looksLikeFormula(s) {
    if (s === NC) return false; // 「-」1文字は数式にならない（実測で確認済み）
    return /^[=+\-@\t\r]/.test(s);
  }

  function needsGuard(s) {
    return looksLikeFormula(s) || looksLikeDate(s) || looksLikeNumberShift(s);
  }

  /** CSVの引用（引用符・カンマ・改行を含むときだけ囲む） */
  function quote(s) {
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** 1マスぶんの値を CSV の書式に直す */
  function cell(v) {
    if (v === null || v === undefined) return "";
    // 数値は数値のまま出す（表計算側で合計できるように）。-5 も数値なので触らない
    if (typeof v === "number") return isFinite(v) ? String(v) : "";
    const s = String(v);
    if (s === "") return "";
    // 化ける値だけ ="..." で包む。中の引用符は数式の作法どおり2つ重ねる
    if (needsGuard(s)) return quote('="' + s.replace(/"/g, '""') + '"');
    return quote(s);
  }

  /** 行の配列を CSV の文字列にする */
  function build(rows) {
    return rows.map(function (r) {
      return r.map(cell).join(",");
    }).join("\r\n");
  }

  /** ファイル名に使う日付（20260820_1230） */
  function stamp() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, "0"); };
    return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate())
      + "_" + p(d.getHours()) + p(d.getMinutes());
  }

  /** 端末にダウンロードさせる */
  function download(rows, baseName) {
    if (!rows || rows.length <= 1) {
      UI.toast("書き出す内容がありません。", "warn");
      return false;
    }
    // BOM付きUTF-8。これが無いとExcelで日本語が化ける
    const blob = new Blob(["﻿" + build(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = baseName + "_" + stamp() + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    UI.toast("表計算用のファイル（CSV）を書き出しました。");
    return true;
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      const p = function (n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate())
        + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) {
      return iso || "";
    }
  }

  /** 数えた値ならその数字（0も0のまま）、数えていないなら「-」 */
  function num(v) {
    return v === null || v === undefined ? NC : v;
  }

  function pct(v) {
    return v === null || v === undefined ? NC : Math.round(v * 1000) / 10;
  }

  function num1(v) {
    return v === null || v === undefined ? NC : Math.round(v * 10) / 10;
  }

  /* ---------- 種目ごとに「数える項目」を引く ---------- */

  /**
   * 種目IDから、その種目で何を数えるかを返す。
   *   safety    … セーフティを数える種目か（BASE_RULES.safetyCallable）
   *   masuwari  … マスワリを数える種目か（BASE_RULES.hasMasuwari）
   *   skillLevel… スキルレベルを持つ種目か（JPA）
   *   jpaPoints … JPAのチームポイントが付く種目か
   *   bowlard   … ストライク／スペア／ミスを数える種目か
   * 未知の種目（古い記録など）は「数えている」側に倒す（値があれば出す）。
   */
  function counts(gameId) {
    const g = (typeof GAMES !== "undefined" && GAMES[gameId]) || null;
    const base = (g && typeof BASE_RULES !== "undefined" && BASE_RULES[g.base]) || null;
    return {
      safety: base ? base.safetyCallable !== false : true,
      masuwari: base ? base.hasMasuwari !== false : true,
      skillLevel: g ? (g.goal === "jpaSL" || g.goal === "jpaSL8") : true,
      jpaPoints: g ? /^jpa_/.test(gameId) : true,
      bowlard: g ? g.base === "bowlard" : true,
    };
  }

  /* ---------- 試合履歴 ---------- */

  /**
   * @param {Array} items STORE.listMatches() の結果（絞り込み済みでもよい）
   *
   * 数えていない項目は「-」。数えた項目は0でも0と書く（本人の指示 2026-08-22）。
   * 「数えていない」には3つある:
   *   1. 種目としてその項目が無い（例: 10ボールのセーフティ、ボウラード以外のスペア）
   *   2. 試合の設定でイニングを数えないと選んだ（options.countInnings === false）
   *   3. まだ確定していない試合（結果が無いので数字が確定しない）
   */
  function historyRows(items) {
    const rows = [[
      "日時", "種目", "状態",
      "プレーヤーA", "SL_A", "スコアA",
      "プレーヤーB", "SL_B", "スコアB",
      "勝者", "イニング数",
      "セーフティA", "セーフティB",
      "マスワリA", "マスワリB",
      "JPAポイントA", "JPAポイントB",
      "ストライク", "スペア", "ミス",
      "メモ",
    ]];
    items.forEach(function (m) {
      const sc = m.scores || {};
      const rk = m.racks || {};
      // ラック先取の種目は racks、点数制は scores を出す
      const useRack = rk && (rk.A || rk.B) && !sc.A && !sc.B;
      const sl = m.skillLevel || {};
      const sf = m.safety || {};
      const ms = m.masuwari || {};
      const jp = (m.jpa && m.jpa.teamPoints) || {};
      // ボウラードだけに入る（他の種目は「-」になる）
      const bw = m.bowlard || {};
      const c = counts(m.gameId);
      const done = !!m.finished;
      // 索引に印が無い古い記録は「数えた」扱い（store.js の countInnings と同じ約束）
      const countInn = m.countInnings !== false;

      function score(side) {
        if (!done) return NC; // 確定前は数字が決まっていない
        const v = useRack ? rk[side] : sc[side];
        return v === undefined || v === null ? NC : v;
      }
      function tally(ok, obj, side) {
        if (!ok || !done) return NC;
        return obj[side] === undefined || obj[side] === null ? 0 : obj[side];
      }

      rows.push([
        fmtDate(m.createdAt),
        m.gameLabel,
        done ? "確定" : "進行中",
        m.names.A,
        c.skillLevel && sl.A != null ? sl.A : NC,
        score("A"),
        m.names.B,
        c.skillLevel && sl.B != null ? sl.B : NC,
        score("B"),
        m.winner ? m.names[m.winner] : NC,
        countInn && done ? num(m.innings) : NC,
        tally(c.safety, sf, "A"), tally(c.safety, sf, "B"),
        tally(c.masuwari, ms, "A"), tally(c.masuwari, ms, "B"),
        c.jpaPoints && done ? (jp.A === undefined ? 0 : jp.A) : NC,
        c.jpaPoints && done ? (jp.B === undefined ? 0 : jp.B) : NC,
        c.bowlard && done ? (bw.strike === undefined ? 0 : bw.strike) : NC,
        c.bowlard && done ? (bw.spare === undefined ? 0 : bw.spare) : NC,
        c.bowlard && done ? (bw.miss === undefined ? 0 : bw.miss) : NC,
        m.note || "",
      ]);
    });
    // ハウスゲーム（5-9 / 5-10 / カイルン）は3人以上で遊ぶため列の形が違う。
    // 同じ表の下に続けて書く
    const money = STORE.listMoneyResults ? STORE.listMoneyResults() : [];
    if (money.length) {
      rows.push([]);
      rows.push(["ハウスゲームの記録"]);
      rows.push(["日時", "種目", "ラック数", "順位", "W-L", "プレーヤー", "獲得スコア", "ハンデ球"]);
      money.forEach(function (m) {
        (m.players || []).forEach(function (p, i) {
          const hb = (p.handicapBalls || []).join("・");
          rows.push([
            fmtDate(m.createdAt), m.gameLabel, num(m.racks),
            i + 1, i === 0 ? "W" : "L", p.name, num(p.score),
            hb === "" ? NC : hb,
          ]);
        });
      });
    }
    return rows;
  }

  /* ---------- プレーヤー別の成績 ---------- */

  /**
   * その選手が「何を数えた試合をしたか」を索引から調べる。
   * 索引（STORE.listMatches）は種目IDと countInnings を持っているので、
   * 試合本体を開かずに分かる。
   * 1試合も該当が無い項目は、合計0ではなく「数えていない（-）」になる。
   */
  function playerCounted(playerId) {
    const out = { innings: false, safety: false, masuwari: false };
    const list = (STORE.listMatches && STORE.listMatches()) || [];
    list.forEach(function (m) {
      if (!m.finished) return;
      const ids = m.playerIds || {};
      const mine = (ids.A || []).indexOf(playerId) >= 0
        || (ids.B || []).indexOf(playerId) >= 0;
      if (!mine) return;
      const c = counts(m.gameId);
      if (m.countInnings !== false) out.innings = true;
      if (c.safety) out.safety = true;
      if (c.masuwari) out.masuwari = true;
    });
    return out;
  }

  function playerRows() {
    const rows = [[
      "選手", "試合数", "W-L", "勝ち", "負け", "勝率(%)",
      "取ったラック", "ラック率(%)",
      "マスワリ", "ブレイク", "マスワリ率(%)",
      "セーフティ", "ファウル", "イニング合計", "得点合計",
      "JPA獲得ポイント", "平均ショット時間(秒)",
    ]];
    STORE.listPlayers().forEach(function (p) {
      const s = STORE.playerStats(p.id);
      if (!s.matches) return; // 1試合もしていない人は出さない
      const has = playerCounted(p.id);
      rows.push([
        p.name, s.matches, s.wins + "-" + s.losses, s.wins, s.losses, pct(s.winRate),
        num(s.rackWins), pct(s.rackWinRate),
        has.masuwari ? num(s.masuwari) : NC, num(s.breaks),
        has.masuwari ? pct(s.masuwariRate) : NC,
        has.safety ? num(s.safety) : NC, num(s.fouls),
        has.innings ? num(s.innings) : NC, num(s.score),
        s.jpaMatches ? s.jpaPoints : NC, num1(s.avgShotSec),
      ]);
    });
    return rows;
  }

  /* ---------- 種目ごとの成績 ---------- */

  function gameRows(stats, who) {
    const rows = [["対象", who || "全体"], []];
    rows.push([
      "種目", "試合数", "勝ち", "負け", "勝率(%)",
      "平均イニング数", "マスワリ", "ブレイク", "マスワリ率(%)",
      "セーフティ", "1イニング平均得点",
    ]);
    stats.games.forEach(function (g) {
      const c = counts(g.gameId);
      rows.push([
        g.label, num(g.matches), num(g.wins), num(g.losses), pct(g.winRate),
        num1(g.avgInnings),
        c.masuwari ? num(g.masuwari) : NC, num(g.breaks),
        c.masuwari ? pct(g.masuwariRate) : NC,
        c.safety ? num(g.safety) : NC, num1(g.pointsPerInning),
      ]);
    });
    if (stats.partners.length) {
      rows.push([]);
      rows.push(["パートナー", "試合数", "勝ち", "勝率(%)", "種目"]);
      stats.partners.forEach(function (p) {
        rows.push([p.name, num(p.matches), num(p.wins), pct(p.winRate),
          p.gameLabels.join("・")]);
      });
    }
    return rows;
  }

  return {
    build: build,
    download: download,
    historyRows: historyRows,
    playerRows: playerRows,
    gameRows: gameRows,
    // 検証から使う（表計算ソフトの変換よけが効いているかを1マスずつ調べる）
    cell: cell,
    needsGuard: needsGuard,
    NOT_COUNTED: NC,
  };
})();
