/**
 * scoring_data.js — スコアリング方式（SCORING）
 *
 * POCKET イベントは「1ショットで落ちた球の配列」であって「点数」ではない。
 * 球→点数の変換はここの scoreOf が担う。これがローテーション/JPA/JCL の
 * 得点差分をデータだけで吸収する肝。
 *
 * 数値の出典:
 *   JPA: 公式ルールPDF http://www.poolplayers.jp/rule/jpa9ball_rule.pdf（本文確認済み）
 *   JCL: Web CUE'S https://www.billiards-cues.jp/topics/20240424-3/
 *   ローテーション: NBA第11章第1条第3項（球の番号がそのまま得点）
 */

const SCORING = {
  // ラック集計型: 1ラック=1ポイント。ボール単位の得点なし
  rack: {
    kind: "rackCount",
    scoreOf: null,
    rackPoint: 1,
  },

  // ローテーション: 球番号がそのまま点（合計120点）
  ballValue: {
    kind: "ballScore",
    scoreOf: function (ball) {
      return ball;
    },
    rackTotal: 120,
  },

  // JPA 9ボール: 1-8番=1点、9番=2点 → 1ラック合計10点
  jpa9: {
    kind: "ballScore",
    scoreOf: function (ball) {
      return ball === 9 ? 2 : 1;
    },
    rackTotal: 10,
    deadBallOnKeyBall: true, // 9番が入ったら残りは全て無効球
    deadBallOnFoul: true, // ファウルショットで入った球も無効球
    breakCounts: true, // ブレイクで入った球も得点
  },

  // JCL 9ボール: 1-8番=1点、9番=14点
  // 9番を入れた側は14点のみ。入れられなかった側はそのラックで落とした球数が得点
  jcl9: {
    kind: "ballScore",
    scoreOf: function (ball) {
      return ball === 9 ? 14 : 1;
    },
    keyBallExclusive: true,
  },

  // JCL 8ボール: 勝者は勝ち方に関係なく14点、敗者は自グループの落球数
  jcl8: {
    kind: "rackScore",
    winnerPoints: 14,
    loserPoints: "ownGroupPocketed",
  },

  // JPA 8ボール: SL別必要ゲーム数（対戦表は handicap_data.js）
  jpa8: {
    kind: "rackCount",
    rackPoint: 1,
  },

  // 14-1: 球1個=1点。ファウルで減点があるのが他種目と大きく違う（第9条）
  straight: {
    kind: "ballScore",
    scoreOf: function () {
      return 1; // 番号に関係なく1個1点
    },
    // 減点（NBA2026 第13章第9条）
    foulPenalty: -1, // 第2項: ファール1回につき1点減点
    threeFoulPenalty: -15, // 第3項: スリーファールで追加15点減点（合計16点減点）
    badBreakPenalty: -2, // 第4項: オープニングブレイクが正常でない場合は2点減点
  },

  // ボウラード: ボウリングと同じ計算。
  // ストライク=10+次の2投、スペア=10+次の1投、10フレーム制で最高300点
  bowlard: {
    kind: "bowling",
    frames: 10,
    pinsPerFrame: 10,
    throwsPerFrame: 2,
  },

  // カイルン: 3ステップを順に完遂して1点。唯一の減点あり
  step: {
    kind: "stepMachine",
    stepsToScore: 3,
    pointPerCycle: 1,
    penaltyPoint: -1,
  },
};
