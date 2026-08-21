/**
 * games_data.js — 12種目の定義
 *
 * 種目は「基礎種目(base) × スコアリング方式(scoring) × ハンデ方式(goal)」の
 * 3軸の組み合わせで表現する。新種目の追加はここに1行足すだけで、
 * engine.js は触らない。
 *
 * goal:  free（自由設定）| jpaSL（JPA 9ボールSL表）| jpaSL8（JPA 8ボール対戦表）| manual（手入力）
 * mode:  rack（ラック単位・軽い）| inning（イニング単位・JPA公式スコアシート相当）
 * inningsOption: true を書いた種目は、イニングを数えるかどうかを試合の設定で選べる。
 *   書かない種目は常に数える（JPA・JCLは公式スコアシートの土台なので切れない）。
 *   ボウラードは1人でやるためイニングの概念が無く、engine 側で数えていない。
 */

const GAMES = {
  "9ball": {
    label: "9ボール",
    base: "nineball", scoring: "rack", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "racks",
    // 一般種目はイニングが公式の指標ではないので、数えるかどうかを
    // 試合の設定で選べるようにする（本人の指示 2026-08-21）。
    // 既定は数える（それまでの動きを変えないため）
    inningsOption: true,
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
    inningsOption: true,
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
    inningsOption: true,
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
    inningsOption: true,
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
    inningsOption: true,
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
    inningsOption: true,
    // 目標点は複数ラックを通して決める（1ラック=120点）。
    // 選択肢は一次情報で裏の取れた値だけを並べる:
    //   JAPA第71回全日本アマ … A級180点 / B級・女子級120点（JAPA71で本文確認）
    //   CUES … 「120点先取、180点先取などと決めます」（本文確認）
    // 240/300 はその倍数として実際に使われる長さ。
    //
    // ※ 61点は入れない。全120点の過半という算術から出た数字で、
    //   「61点先取」という制度は公式規程に存在しないことを確認済み
    //   （04_種目ルール仕様.md の該当節を参照）。
    goalChoices: [120, 180, 240, 300],
    // スマホで1行に収まる長さにする（本人の指示 2026-08-21）
    goalNote: "1ラック120点。先に到達した側の勝ちです。",
    goalDefault: 120,
  },

  straight: {
    label: "14-1（ストレートプール）",
    base: "straight", scoring: "straight", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    // 14-1はイニング（交代の回数）が実力の指標なので、既定では数える。
    // 数え方はJPAと同じで、後攻→先攻に手番が移った時点で1イニング
    // （engine.js が全種目で数えている。ここは出すかどうかの指定）。
    // 一般種目なので、要らないときは設定で切れる（本人の指示 2026-08-21）
    inningsOption: true,
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

  // 5-9 / 5-10（ハウスゲーム）。公式競技規程は無い。
  // 3人以上で遊ぶため、既存のA/B2サイドの仕組みには乗せず、
  // moneyGame の印を見て専用画面（ui_money.js）へ回す
  "59": {
    label: "5-9",
    base: "nineball", scoring: "rack", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    moneyGame: "59",
  },
  "510": {
    label: "5-10",
    base: "tenball", scoring: "rack", goal: "free",
    playersPerSide: 1, mode: "rack",
    goalType: "score",
    moneyGame: "510",
  },

  jpa_9ball: {
    label: "JPA 9ボール",
    base: "nineball", scoring: "jpa9", goal: "jpaSL",
    playersPerSide: 1, mode: "inning",
    goalType: "score",
    // JPAは8ボールも9ボールもウィナーズブレイク。選ばせない（本人の指示）
    defaultBreakType: "winner",
    breakTypeFixed: true,
  },

  jpa_9ball_doubles: {
    label: "JPA 9ボールダブルス",
    base: "nineball", scoring: "jpa9", goal: "jpaSL",
    playersPerSide: 2, mode: "inning",
    goalType: "score",
    skillSum: true, // ペアスキル = 2人のSLの単純合計
    defaultBreakType: "winner",
    breakTypeFixed: true,
  },

  jpa_8ball: {
    label: "JPA 8ボール",
    base: "eightball", scoring: "jpa8", goal: "jpaSL8",
    playersPerSide: 1, mode: "inning",
    goalType: "games",
    defaultBreakType: "winner",
    breakTypeFixed: true,
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
