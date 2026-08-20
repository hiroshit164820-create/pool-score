/**
 * csv.js — 成績・試合履歴を表計算ソフトに書き出す
 *
 * 形式は CSV。ExcelでもGoogleスプレッドシートでもそのまま開ける。
 * 日本語が文字化けしないよう、先頭にBOMを付けたUTF-8で書き出す
 * （BOMが無いとExcelがShift-JISとして読んでしまう）。
 *
 * サーバーは使わない。ブラウザの中だけで作ってダウンロードするので、
 * 記録が外に出ることはない。
 */

const CSVOUT = (function () {
  /** 1マスぶんの値を CSV の書式に直す */
  function cell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    // 引用符・カンマ・改行を含むときは全体を引用符で囲み、引用符は2つ重ねる
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
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

  function pct(v) {
    return v === null || v === undefined ? "" : Math.round(v * 1000) / 10;
  }

  function num1(v) {
    return v === null || v === undefined ? "" : Math.round(v * 10) / 10;
  }

  /* ---------- 試合履歴 ---------- */

  /**
   * @param {Array} items STORE.listMatches() の結果（絞り込み済みでもよい）
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
      rows.push([
        fmtDate(m.createdAt),
        m.gameLabel,
        m.finished ? "確定" : "進行中",
        m.names.A, sl.A == null ? "" : sl.A, useRack ? rk.A : (sc.A === undefined ? "" : sc.A),
        m.names.B, sl.B == null ? "" : sl.B, useRack ? rk.B : (sc.B === undefined ? "" : sc.B),
        m.winner ? m.names[m.winner] : "",
        m.innings === null || m.innings === undefined ? "" : m.innings,
        sf.A === undefined ? "" : sf.A, sf.B === undefined ? "" : sf.B,
        ms.A === undefined ? "" : ms.A, ms.B === undefined ? "" : ms.B,
        jp.A === undefined ? "" : jp.A, jp.B === undefined ? "" : jp.B,
        m.note || "",
      ]);
    });
    return rows;
  }

  /* ---------- プレーヤー別の成績 ---------- */

  function playerRows() {
    const rows = [[
      "選手", "試合数", "勝ち", "負け", "勝率(%)",
      "取ったラック", "ラック率(%)",
      "マスワリ", "ブレイク", "マスワリ率(%)",
      "セーフティ", "ファウル", "イニング合計", "得点合計",
      "平均ショット時間(秒)",
    ]];
    STORE.listPlayers().forEach(function (p) {
      const s = STORE.playerStats(p.id);
      if (!s.matches) return; // 1試合もしていない人は出さない
      rows.push([
        p.name, s.matches, s.wins, s.losses, pct(s.winRate),
        s.rackWins, pct(s.rackWinRate),
        s.masuwari, s.breaks, pct(s.masuwariRate),
        s.safety, s.fouls, s.innings, s.score,
        num1(s.avgShotSec),
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
      rows.push([
        g.label, g.matches, g.wins, g.losses, pct(g.winRate),
        num1(g.avgInnings), g.masuwari, g.breaks, pct(g.masuwariRate),
        g.safety, num1(g.pointsPerInning),
      ]);
    });
    if (stats.partners.length) {
      rows.push([]);
      rows.push(["パートナー", "試合数", "勝ち", "勝率(%)", "種目"]);
      stats.partners.forEach(function (p) {
        rows.push([p.name, p.matches, p.wins, pct(p.winRate), p.gameLabels.join("・")]);
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
  };
})();
