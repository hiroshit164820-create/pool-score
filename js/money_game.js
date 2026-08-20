/**
 * money_game.js — 5-9 / 5-10（ハウスゲーム）
 *
 * 本人から聞き取ったルール（2026-08-20）。公式競技規程は存在しない。
 *
 *   5-9  : 5番=1点、9番=2点、ハンデボール=1点
 *   5-10 : 5番=1点、10番=2点、ハンデボール=1点
 *
 *   - 得点は「相手からもらう」。3人以上なら全員からもらう
 *     （9番をコーナーで落として3人打ちなら 2点×2人=4点が動く）
 *   - サイドポケットに落とすと倍
 *   - マスワリ（そのラックを撞き切る）ならラックの得点すべてが倍
 *   - 両方成立したら掛け算（サイド2倍×マスワリ2倍=4倍）
 *   - ハンデボールは割り当てられた本人が落としたときだけ得点
 *   - 5番を落としても盤面はそのまま続行（戻さない）
 *   - 総得点で勝敗が決まる
 *
 * 既存の8種目はA/Bの2サイド前提で作ってある。ここを多人数に作り替えると
 * 全種目に影響するため、5-9系は独立した集計としてこのファイルに閉じている。
 */
const MONEY = (function () {
  "use strict";

  /** 種目の定義。keyBall だけが 5-9 と 5-10 の違い */
  const MONEY_GAMES = {
    "59": { id: "59", label: "5-9", keyBall: 9, keyPoint: 2 },
    "510": { id: "510", label: "5-10", keyBall: 10, keyPoint: 2 },
  };

  /** 5番はどちらの種目でも1点 */
  const FIVE_POINT = 1;
  /** ハンデボールは1点 */
  const HANDICAP_POINT = 1;

  /**
   * 1回の落球で動く点数（倍率をかける前の素点）を出す。
   *
   * @param {object} game   MONEY_GAMES の要素
   * @param {number} ball   落とした球の番号
   * @param {number[]} handicapBalls その人に割り当てられたハンデ球
   * @returns {number} 素点。得点にならない球なら0
   */
  function basePoint(game, ball, handicapBalls) {
    if (ball === 5) return FIVE_POINT;
    if (ball === game.keyBall) return game.keyPoint;
    // ハンデ球は割り当てられた本人が落としたときだけ。
    // 呼ぶ側がその人のぶんだけを渡す約束にしている
    if (handicapBalls && handicapBalls.indexOf(ball) >= 0) return HANDICAP_POINT;
    return 0;
  }

  /**
   * 倍率。サイドポケットで2倍、マスワリで2倍。両方なら4倍（掛け算）。
   * マスワリはラックを撞き切ったときにラック全体へかけるので、
   * ここでは1球ぶんの倍率としてサイドだけを見る。
   */
  function shotMultiplier(inSide) {
    return inSide ? 2 : 1;
  }

  /**
   * 1回の落球で、撞いた人が「1人あたり」もらう点数。
   * 実際に動く総額は これ × 相手の人数。
   */
  function pointPerOpponent(game, ball, handicapBalls, inSide) {
    return basePoint(game, ball, handicapBalls) * shotMultiplier(inSide);
  }

  /**
   * 1回の記録が動かす「相手1人あたりの点数」。
   *
   * 画面の入力は「+1 / +2 / +4 / +8 / +16」「-1 / -2」のボタンになったので、
   * 新しい記録は pts をそのまま持つ（本人の指示 2026-08-20）。
   * 球番号で記録した古いデータも読めるよう、pts が無ければ球から換算する。
   */
  function shotPoints(game, s, handicaps) {
    if (typeof s.pts === "number") return s.pts;
    const hb = (handicaps && handicaps[s.by]) || [];
    return pointPerOpponent(game, s.ball, hb, !!s.side);
  }

  /**
   * 記録から各プレーヤーの持ち点を計算する。
   *
   * shots: [{ by: playerId, pts: n, voided: bool }]
   *        （古い記録は { by, ball, side } の形。shotPoints が吸収する）
   * rackEnds: [{ at: shotIndex, runoutBy: playerId|null }]
   *   マスワリはラックの区切りで確定するため、別に持つ。
   *
   * @returns {{ totals: object, moves: array }}
   *   totals[playerId] = 持ち点（マイナスもある）
   */
  function tally(game, players, shots, handicaps, racks) {
    const totals = {};
    players.forEach(function (p) { totals[p.id] = 0; });

    // ラックごとに区切って集計する。マスワリはラック単位で倍にするため
    const bounds = rackBounds(shots.length, racks);
    const moves = [];

    bounds.forEach(function (rk) {
      // このラックで各人が得た額（相手1人あたり）
      const gained = {};
      players.forEach(function (p) { gained[p.id] = 0; });

      for (let i = rk.from; i < rk.to; i++) {
        const s = shots[i];
        if (!s || s.voided) continue;
        const per = shotPoints(game, s, handicaps);
        if (per) gained[s.by] += per;
      }

      // マスワリならこのラックの得点すべてが倍
      const ro = rk.runoutBy;
      if (ro && gained[ro]) gained[ro] *= 2;

      // 得た点は相手全員からもらう（ゼロサム）
      players.forEach(function (p) {
        const per = gained[p.id];
        if (!per) return;
        const others = players.filter(function (q) { return q.id !== p.id; });
        totals[p.id] += per * others.length;
        others.forEach(function (q) { totals[q.id] -= per; });
        moves.push({ by: p.id, per: per, from: others.length });
      });
    });

    return { totals: totals, moves: moves };
  }

  /**
   * ラックの区切り。racks は [{ at: この本数を撞き終えた時点で区切る, runoutBy }]。
   * 最後の区切りより後ろは「まだ終わっていないラック」として扱う。
   */
  function rackBounds(total, racks) {
    const out = [];
    let from = 0;
    (racks || []).forEach(function (r) {
      out.push({ from: from, to: Math.min(r.at, total), runoutBy: r.runoutBy || null });
      from = Math.min(r.at, total);
    });
    // 進行中のラック（まだマスワリが確定していない）
    if (from < total) out.push({ from: from, to: total, runoutBy: null });
    return out;
  }

  /** 得点になりうる球の一覧（画面のボタンに使う） */
  function scoringBalls(game, handicapBalls) {
    const out = [5, game.keyBall];
    (handicapBalls || []).forEach(function (b) {
      if (out.indexOf(b) < 0) out.push(b);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  /**
   * 得点ボタンに並べる点数（本人の指示 2026-08-20）。
   *
   *   +1  5番／ハンデ球
   *   +2  9番（5-10なら10番）、または5番をサイド
   *   +4  9番をサイド、または5番のマスワリ相当
   *   +8  9番サイド＋マスワリ
   *   +16 それがさらに重なったとき
   * 倍々になる並びなので、実際に動く額はこの5つで足りる。
   */
  const PLUS_POINTS = [1, 2, 4, 8, 16];
  /** 打ち間違いや反則の戻しに使う */
  const MINUS_POINTS = [-1, -2];

  return {
    GAMES: MONEY_GAMES,
    PLUS_POINTS: PLUS_POINTS,
    MINUS_POINTS: MINUS_POINTS,
    basePoint: basePoint,
    pointPerOpponent: pointPerOpponent,
    shotPoints: shotPoints,
    tally: tally,
    scoringBalls: scoringBalls,
    rackBounds: rackBounds,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = MONEY;
}
