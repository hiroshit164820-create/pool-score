/**
 * rules_data.js — 基礎種目の盤面ルール（BASE_RULES）
 *
 * ここにはルールの「差分データ」だけを置く。ロジックは engine.js に書く。
 * 数値・フラグはすべて一次情報で確認したもの。出典は 04_種目ルール仕様.md 参照。
 *
 * 主な出典:
 *   NBA「ポケットビリヤード競技規定」2026年6月改訂版（全33ページ本文確認済み・2026-08-19取得）
 *   https://www.nba.or.jp/document/ポケットビリヤード競技規定/
 */

const BASE_RULES = {
  nineball: {
    label: "9ボール",
    balls: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    keyBall: 9, // このボールでラック確定
    callShot: false,
    defaultBreakType: "winner", // 慣行上の既定。試合ごとに上書き可
    hasBreakAce: true, // 9ボールのみ true（10ボールは10番を必ず戻すため存在しない）
    hasMasuwari: true,
    safetyCallable: true,
    threeFoulResult: "loseRack", // NBA第9章第6条第3項
    rackEndsScoring: true, // ラックが得点の区切りになるか
  },

  tenball: {
    label: "10ボール",
    balls: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    keyBall: 10,
    callShot: true, // NBA第10章第6条: ブレイクとセーフティを除く全ショット
    defaultBreakType: "alternate",
    hasBreakAce: false, // NBA第10章第4条第5項: 10番は必ずフットスポットに戻す
    hasMasuwari: true,
    safetyCallable: false, // 2026年6月改訂でセーフティコール廃止
    threeFoulResult: "loseRack",
    rackEndsScoring: true,
  },

  eightball: {
    label: "8ボール",
    balls: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    keyBall: 8,
    callShot: true,
    groupAssign: "firstLegalPocket", // NBA第12章第6条: ブレイクで入ってもグループ未確定
    defaultBreakType: "alternate",
    hasBreakAce: false,
    hasMasuwari: true,
    safetyCallable: true,
    threeFoulResult: "loseRack",
    rackEndsScoring: true,
  },

  rotation: {
    label: "ローテーション",
    balls: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    keyBall: null,
    rackTotal: 120, // 1+2+...+15
    callShot: true,
    // NBA第11章第4条第5項: 前ラック最終球を入れて手球をヘッドライン内に戻してブレイク。
    // ウィナーズ/オルタネートの概念がないため continuation 固定（UIで選択肢を出さない）
    defaultBreakType: "continuation",
    breakTypeFixed: true,
    hasBreakAce: false,
    hasMasuwari: false, // ラック跨ぎ得点のため概念が成立しない
    safetyCallable: true,
    threeFoulResult: "freeBallOnly", // NBA第11章第7条第6項: ラック負けにならずカウントリセット
    rackEndsScoring: false, // ★ ラックは盤面のリセット単位にすぎない
  },

  // 14-1（ストレートプール）NBA2026 第13章
  straight: {
    label: "14-1",
    balls: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    keyBall: null,
    callShot: true, // 第1条第4項: ブレイクショットを含む全ショット
    // 14個入れたらブレイクボール1個を残してラックを組み直す。
    // 得点はラックを跨いで連続するため、ローテーションと同じ continuation 扱い
    defaultBreakType: "continuation",
    breakTypeFixed: true,
    ballsPerRack: 14, // ラックを組み直すまでに入れる個数
    hasBreakAce: false,
    hasMasuwari: false, // ラック跨ぎ得点のため概念が成立しない
    safetyCallable: true,
    // 第8条第2項: スリーファールでもラック負けにはならない（減点＋選択権）
    threeFoulResult: "penaltyOnly",
    rackEndsScoring: false, // ★ ラックは盤面のリセット単位にすぎない
  },

  kailun: {
    label: "カイルン",
    balls: [1, 3, 11], // 1番=黄球、3番と11番=赤球
    isCarom: true, // ポケットではなく「当てる」ゲーム
    steps: 3,
    hasPenalty: true, // 全種目中これだけ減点がある
    defaultPenaltyMode: "selfMinus", // selfMinus(-1点) | othersPlus(他全員+1点)
    defaultBreakType: "alternate",
    breakTypeFixed: true,
    hasBreakAce: false,
    hasMasuwari: false,
    safetyCallable: false,
    rackEndsScoring: false,
    // 公式競技規程が存在しないハウスゲーム（NBA規程に章がない）。出典はWeb CUE'S
    unverified: ["1イニング内の連続得点可否", "ミス時のステップリセット有無"],
  },
};
