/**
 * handicap_data.js — ハンデの確定値
 *
 * ★原則: 出典を確認できた数値だけを置く。未確認のものは推測で埋めず、
 *   UIで手入力に落とす。出典は 05_ハンデ仕様.md に対応。
 */

/**
 * JPA 9ボール スキルレベル別 必要得点（持ち点）
 * 出典: JPA公式ルールPDF（図1）http://www.poolplayers.jp/rule/jpa9ball_rule.pdf
 *       APA公式 The Equalizer® Handicap System（9-Ball Points Required To Win Chart）
 * → 2ソースで完全一致を確認済み（2026-08-19）
 */
const JPA_SL_9BALL = { 1: 14, 2: 19, 3: 25, 4: 31, 5: 38, 6: 46, 7: 55, 8: 65, 9: 75 };

/**
 * JPA 9ボールダブルス ペアスキル別 必要得点
 * ペアスキル = 2人のSLの単純合計（出典: premier7.jp ペアスキル算出表）
 * 数値は APA公式 9-Ball Doubles Points Required To Win Chart
 * キーは合計SL。4以下は "4orLess" に丸める。
 */
const JPA_SL_9BALL_DOUBLES = {
  4: 19, 5: 22, 6: 25, 7: 28, 8: 31, 9: 35, 10: 38, 11: 42, 12: 46,
};

/**
 * JPA/APA 8ボール Games Must Win Chart
 * 読み方: JPA_SL_8BALL_CHART[自分のSL][相手のSL] = [自分の先取ゲーム数, 相手の先取ゲーム数]
 * 出典: APA公式 The Equalizer® Handicap System（8-Ball Games Must Win Chart）
 *
 * ⚠ これはAPA(米国本部)の公式表。JPAはAPAのEqualizer®をライセンス使用しており、
 *   9ボール表は完全一致を確認できたため8ボール表も同一である蓋然性が高いが、
 *   JPA公式資料での直接確認は取れていない（JPAの該当PDFはスキャン画像のため抽出不可）。
 *   → UIで手入力による上書きを許可する。
 */
const JPA_SL_8BALL_CHART = {
  2: { 2: [2, 2], 3: [2, 3], 4: [2, 4], 5: [2, 5], 6: [2, 6], 7: [2, 7] },
  3: { 2: [3, 2], 3: [2, 2], 4: [2, 3], 5: [2, 4], 6: [2, 5], 7: [2, 6] },
  4: { 2: [4, 2], 3: [3, 2], 4: [3, 3], 5: [3, 4], 6: [3, 5], 7: [2, 5] },
  5: { 2: [5, 2], 3: [4, 2], 4: [4, 3], 5: [4, 4], 6: [4, 5], 7: [3, 5] },
  6: { 2: [6, 2], 3: [5, 2], 4: [5, 3], 5: [5, 4], 6: [5, 5], 7: [4, 5] },
  7: { 2: [7, 2], 3: [6, 2], 4: [5, 2], 5: [5, 3], 6: [5, 4], 7: [5, 5] },
};
const JPA_SL_8BALL_CHART_SOURCE = "APA公式Equalizer資料（JPA公式での直接確認は未取得）";

/**
 * JPAチームポイント早見表
 * 敗者のSL × 敗者の獲得点数 → 勝者ポイント（敗者ポイントは 20 - 勝者ポイント）
 * 出典: JPA公式「ポイント早見表」 http://www.poolplayers.jp/rule/teampoint.pdf（本文抽出確認済み）
 */
const JPA_TEAM_POINT_BANDS = {
  1: [[0, 2], [3, 3], [4, 4], [5, 6], [7, 7], [8, 8], [9, 10], [11, 11], [12, 13]],
  2: [[0, 3], [4, 5], [6, 7], [8, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18]],
  3: [[0, 4], [5, 6], [7, 9], [10, 11], [12, 14], [15, 16], [17, 19], [20, 21], [22, 24]],
  4: [[0, 5], [6, 8], [9, 11], [12, 14], [15, 18], [19, 21], [22, 24], [25, 27], [28, 30]],
  5: [[0, 6], [7, 10], [11, 14], [15, 18], [19, 22], [23, 26], [27, 29], [30, 33], [34, 37]],
  6: [[0, 8], [9, 12], [13, 17], [18, 22], [23, 27], [28, 31], [32, 36], [37, 40], [41, 45]],
  7: [[0, 10], [11, 15], [16, 21], [22, 26], [27, 32], [33, 37], [38, 43], [44, 49], [50, 54]],
  8: [[0, 13], [14, 19], [20, 26], [27, 32], [33, 39], [40, 45], [46, 52], [53, 58], [59, 64]],
  9: [[0, 17], [18, 24], [25, 31], [32, 38], [39, 46], [47, 53], [54, 60], [61, 67], [68, 74]],
};
const JPA_WINNER_POINTS = [20, 19, 18, 17, 16, 15, 14, 13, 12];

/** JPAチーム戦の制約（出典: JPA公式ハンディキャップページ・ルールPDF） */
const JPA_TEAM_RULE = {
  playersPerMatch: 5,
  maxSkillSum: 23, // 23ルール
  teamWinThreshold: 51, // 5人合計51ポイント以上で勝利（両チーム計100）
  totalPoints: 100,
  maxHighSkillPlayers: { threshold: 6, count: 2 }, // SL6以上を3名出せない
};

/**
 * JCL: ファーゴレート → 目標点の換算式は公表されていない（ブラックボックスと明言）。
 * 換算表を持たず、目標点は必ず手入力とする。
 * 出典: Web CUE'S https://www.billiards-cues.jp/topics/20231128/
 */
const JCL_GOAL = {
  source: "manual",
  note: "ファーゴレート換算式は非公開のため手入力",
};

/** ボールハンデのプリセット（出典: Web CUE'S 9ボールのハンデ項） */
const BALL_HANDICAP_PRESETS = [
  { label: "9番のみ得点", scoringBalls: [9] },
  { label: "7番以上が得点", scoringBalls: [7, 8, 9] },
  { label: "5番以上が得点", scoringBalls: [5, 6, 7, 8, 9] },
];

/**
 * JPAチームポイントを算出する。
 * @param {number} loserSL 敗者のスキルレベル
 * @param {number} loserScore 敗者の獲得点数
 * @returns {{winner:number, loser:number}} 合計は常に20
 */
function jpaTeamPoints(loserSL, loserScore) {
  const bands = JPA_TEAM_POINT_BANDS[loserSL];
  if (!bands) throw new Error("未知のスキルレベル: " + loserSL);
  let idx = bands.findIndex(function (b) {
    return loserScore >= b[0] && loserScore <= b[1];
  });
  // 表の上限を超える得点（敗者が持ち点直前まで取った場合）は最下段扱い
  if (idx < 0) idx = JPA_WINNER_POINTS.length - 1;
  const w = JPA_WINNER_POINTS[idx];
  return { winner: w, loser: 20 - w };
}

/**
 * JPA 8ボールのチームポイント。
 *
 * 9ボールのような点数の早見表ではなく、「何対何で勝ったか」の3段階で決まる。
 * 出典: 本人（2026-08-20）。JPA公式資料での直接確認は取れていない。
 *
 *   3 - 0（スコンク）: 相手に1ラックも取らせずに勝った
 *   2 - 1            : 相手をリーチ（あと1ラックで勝ち）まで来させてから勝った
 *   2 - 0            : それ以外
 *
 * 敗者はリーチまで届かなければ0ポイント。
 *
 * @param {number} loserRacks  敗者が取ったラック数
 * @param {number} loserTarget 敗者の先取ゲーム数（対戦表から決まる）
 * @returns {{winner:number, loser:number}}
 */
function jpaTeamPoints8(loserRacks, loserTarget) {
  const got = Math.max(0, Number(loserRacks) || 0);
  const need = Number(loserTarget) || 0;
  if (got === 0) return { winner: 3, loser: 0 };
  // リーチ = あと1ラックで勝ちだった
  if (need > 1 && got === need - 1) return { winner: 2, loser: 1 };
  return { winner: 2, loser: 0 };
}

/** JPA 9ボール: SLから両者の目標点を出す（ダブルスはペアスキル合計） */
function jpaGoal9Ball(slA, slB, isDoubles) {
  const table = isDoubles ? JPA_SL_9BALL_DOUBLES : JPA_SL_9BALL;
  const pick = function (sl) {
    if (isDoubles && sl < 4) sl = 4; // ダブルスは合計4以下を4に丸める
    const v = table[sl];
    if (v === undefined) throw new Error("スキルレベルが表の範囲外: " + sl);
    return v;
  };
  return { A: pick(slA), B: pick(slB) };
}

/** JPA 8ボール: 両者のSLから先取ゲーム数を出す */
function jpaGoal8Ball(slA, slB) {
  const row = JPA_SL_8BALL_CHART[slA];
  if (!row || !row[slB]) throw new Error("8ボール対戦表の範囲外: " + slA + " vs " + slB);
  const pair = row[slB];
  return { A: pair[0], B: pair[1] };
}
