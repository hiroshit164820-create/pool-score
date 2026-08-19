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
      { label: "5先（ゴサキ）", v: 5 },
      { label: "7先（ナナサキ）", v: 7 },
    ],
  },

  "9ball_doubles": {
    label: "9ボールダブルス",
    base: "nineball", scoring: "rack", goal: "free",
    playersPerSide: 2, mode: "rack",
    goalType: "racks",
    goalPresets: [
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
      { label: "5先", v: 5 },
      { label: "7先", v: 7 },
    ],
  },

  rotation: {
    label: "ローテーション",
    base: "rotation", scoring: "ballValue", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    // ※「61点先取」は日本の公式規程(NBA/JAPA)に存在しないため入れない。
    //   実在する数値はJAPA第71回全日本アマの A級180点 / B級・女子級120点。
    goalPresets: [
      { label: "JAPA A級 180点", v: 180 },
      { label: "JAPA B級/女子級 120点", v: 120 },
    ],
  },

  straight: {
    label: "14-1",
    base: "straight", scoring: "straight", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    // 先取点は大会・場によって決める（規程は数値を固定していない）。
    // 実際によく使われる値をプリセットとして置く。
    goalPresets: [
      { label: "50点先取", v: 50 },
      { label: "100点先取", v: 100 },
      { label: "150点先取", v: 150 },
    ],
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
