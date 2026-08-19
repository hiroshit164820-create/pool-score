/**
 * games_data.js — 12種目の定義
 *
 * 種目は「基礎種目(base) × スコアリング方式(scoring) × ハンデ方式(goal)」の
 * 3軸の組み合わせで表現する。新種目の追加はここに1行足すだけで、
 * engine.js は触らない。
 *
 * goal:  free（自由設定）| jpaSL（JPA 9ボールSL表）| jpaSL8（JPA 8ボール対戦表）| manual（手入力）
 * mode:  rack（ラック単位・軽い）| inning（イニング単位・JPA公式スコアシート相当）
 */

const GAMES = {
  "9ball": {
    label: "9ボール",
    base: "nineball", scoring: "rack", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "racks",
    goalPresets: [
      { label: "3先", v: 3 },
      { label: "5先", v: 5 },
      { label: "7先", v: 7 },
    ],
  },

  "9ball_doubles": {
    label: "9ボールダブルス",
    base: "nineball", scoring: "rack", goal: "free",
    playersPerSide: 2, mode: "rack",
    goalType: "racks",
    goalPresets: [
      { label: "3先", v: 3 },
      { label: "5先", v: 5 },
      { label: "7先", v: 7 },
    ],
  },

  "10ball": {
    label: "10ボール",
    base: "tenball", scoring: "rack", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "racks",
    goalPresets: [
      { label: "3先", v: 3 },
      { label: "5先", v: 5 },
      { label: "7先", v: 7 },
      { label: "8先", v: 8 },
    ],
  },

  "10ball_doubles": {
    label: "10ボールダブルス",
    base: "tenball", scoring: "rack", goal: "free",
    playersPerSide: 2, mode: "rack",
    goalType: "racks",
    goalPresets: [
      { label: "3先", v: 3 },
      { label: "5先", v: 5 },
      { label: "7先", v: 7 },
      { label: "8先", v: 8 },
    ],
  },

  "8ball": {
    label: "8ボール",
    base: "eightball", scoring: "rack", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "racks",
    goalPresets: [
      { label: "3先", v: 3 },
      { label: "5先", v: 5 },
      { label: "7先", v: 7 },
    ],
  },

  rotation: {
    label: "ローテーション",
    base: "rotation", scoring: "ballValue", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    // ローテーションは「何点先取」という決め方をしない種目なので、
    // 設定画面に先取点の入力を出さない（本人の指示）。
    //
    // 1ラック=120点で、過半数の61点を取った時点で相手が追いつけなくなる。
    // これを既定の決着点にする（数字は 1+2+...+15=120 の過半数という算術で、
    // 「61点先取」という制度が公式規程にあるという意味ではない）。
    //
    // ※ JAPA第71回全日本アマは A級180点 / B級・女子級120点 という
    //   先取点を定めているが、それは複数ラックを通しての大会規定。
    goalHidden: true,
    goalHiddenNote:
      "ローテーションは1ラック120点です。61点を取った時点で相手が追いつけなくなるため、そこで決着します。",
    goalDefault: 61,
  },

  straight: {
    label: "14-1",
    base: "straight", scoring: "straight", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    // 14-1はイニング（交代の回数）が実力の指標になるため画面に出す。
    // 数え方はJPAと同じで、後攻→先攻に手番が移った時点で1イニング
    // （engine.js が全種目で数えている。ここは表示するかどうかの指定）
    showInnings: true,
    // 先取点は大会・場によって決める（規程は数値を固定していない）。
    // 実際によく使われる値をプリセットとして置く。
    goalPresets: [
      { label: "50点先取", v: 50 },
      { label: "100点先取", v: 100 },
      { label: "150点先取", v: 150 },
    ],
  },

  bowlard: {
    label: "ボウラード",
    base: "bowlard", scoring: "bowlard", goal: "free",
    playersPerSide: 1, mode: "frame",
    goalType: "score",
    solo: true, // 1人用。相手を入力しない
    goalHidden: true,
    goalHiddenNote: "ボウラードは10フレームで、最高300点です。先取点はありません。",
    goalDefault: 300,
  },

  kailun: {
    label: "カイルン",
    base: "kailun", scoring: "step", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    goalPresets: [{ label: "5点先取", v: 5 }],
  },

  jpa_9ball: {
    label: "JPA 9ボール",
    base: "nineball", scoring: "jpa9", goal: "jpaSL",
    playersPerSide: 1, mode: "inning",
    goalType: "score",
  },

  jpa_9ball_doubles: {
    label: "JPA 9ボールダブルス",
    base: "nineball", scoring: "jpa9", goal: "jpaSL",
    playersPerSide: 2, mode: "inning",
    goalType: "score",
    skillSum: true, // ペアスキル = 2人のSLの単純合計
  },

  jpa_8ball: {
    label: "JPA 8ボール",
    base: "eightball", scoring: "jpa8", goal: "jpaSL8",
    playersPerSide: 1, mode: "inning",
    goalType: "games",
  },

  jcl_9ball: {
    label: "JCL 9ボール",
    base: "nineball", scoring: "jcl9", goal: "manual",
    playersPerSide: 1, mode: "inning",
    goalType: "score",
  },

  jcl_8ball: {
    label: "JCL 8ボール",
    base: "eightball", scoring: "jcl8", goal: "manual",
    playersPerSide: 1, mode: "inning",
    goalType: "score",
  },
};

/** 種目定義から base / scoring をまとめて引く */
function resolveGame(gameId) {
  const g = GAMES[gameId];
  if (!g) throw new Error("未知の種目: " + gameId);
  return {
    game: g,
    base: BASE_RULES[g.base],
    scoring: SCORING[g.scoring],
  };
}
