/**
 * engine.test.js — エンジンの検証
 * 実行: node _test/engine.test.js
 *
 * 計画書「検証方法」の項目をそのまま検証する。
 */
const { loadApp } = require("./load.js");
const app = loadApp();

let pass = 0;
let fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(label + "\n    期待: " + e + "\n    実際: " + a);
  }
}

function ok(cond, label) {
  eq(!!cond, true, label);
}

function section(name) {
  console.log("\n── " + name + " ──");
}

// 決定的な時刻を渡す（Date.now依存を排除）
let clock = new Date("2026-08-19T19:00:00+09:00");
function tick() {
  clock = new Date(clock.getTime() + 30000);
  return clock;
}

function pocket(m, side, balls, onBreak) {
  return app.appendEvent(m, { t: "POCKET", side: side, d: { balls: balls, onBreak: !!onBreak } }, tick());
}
function turnEnd(m, side, reason) {
  return app.appendEvent(m, { t: "TURN_END", side: side, d: { reason: reason || "miss" } }, tick());
}
function foul(m, side, warned, kind) {
  return app.appendEvent(m, { t: "FOUL", side: side, d: { kind: kind || "normal", warned: !!warned } }, tick());
}
function rackStart(m, no, breakSide, extra) {
  return app.appendEvent(m, { t: "RACK_START", side: null, d: Object.assign({ rackNo: no, breakSide: breakSide }, extra || {}) }, tick());
}

/* ============================================================ */
section("JPA 9ボール: 1ラック合計が必ず10点になる");
{
  const m = app.createMatch({
    gameId: "jpa_9ball",
    sides: [{ name: "山田" }, { name: "佐藤" }],
    goal: {
      type: "score",
      targets: app.jpaGoal9Ball(7, 5, false),
      source: "jpaSL",
      meta: { skillLevel: { A: 7, B: 5 } },
    },
    firstSide: "A",
    now: tick(),
  });

  eq(m.goal.targets, { A: 55, B: 38 }, "SL7 vs SL5 の持ち点");

  // Aが1-8番、Bが9番を入れる → 合計10点
  pocket(m, "A", [1, 2, 3], true);
  turnEnd(m, "A", "safety");
  pocket(m, "B", [4, 5, 6, 7, 8]);
  pocket(m, "B", [9]);

  const st = app.reduceMatch(m);
  eq(st.score.A + st.score.B, 10, "1ラック合計10点");
  eq(st.score.A, 3, "Aの得点（1,2,3番=3点）");
  eq(st.score.B, 7, "Bの得点（4-8番=5点 + 9番=2点）");
  eq(st.stats.A.deadBalls + st.stats.B.deadBalls, 0, "全球入ったので無効球なし");
}

/* ============================================================ */
section("JPA 9ボール: 9番投入で残り球が無効球になる");
{
  const m = app.createMatch({
    gameId: "jpa_9ball",
    goal: { type: "score", targets: { A: 55, B: 38 }, source: "jpaSL", meta: { skillLevel: { A: 7, B: 5 } } },
    firstSide: "A",
    now: tick(),
  });

  // ブレイクで9番のみポケット → 2点、残り8個は無効球
  pocket(m, "A", [9], true);

  const st = app.reduceMatch(m);
  eq(st.score.A, 2, "9番のみで2点");
  eq(st.score.B, 0, "相手は0点");
  eq(st.stats.A.deadBalls, 8, "残り8球が無効球");
  eq(st.stats.A.breakAce, 1, "ブレイクエース成立");
  eq(st.racks.A, 1, "ラック取得");
}

/* ============================================================ */
section("ローテーション: ラックを跨いで得点が連続する");
{
  const m = app.createMatch({
    gameId: "rotation",
    goal: { type: "score", targets: { A: 180, B: 120 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });

  pocket(m, "A", [1, 2, 3]);
  turnEnd(m, "A", "miss");
  pocket(m, "B", [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  pocket(m, "B", [15]); // 1ラック目を撞き切る
  rackStart(m, 2, "B", { continuation: true });
  pocket(m, "B", [1, 2], true); // 2ラック目の得点が連続する

  const st = app.reduceMatch(m);
  eq(st.score.A, 6, "Aは1+2+3=6点");
  eq(st.score.B, 114 + 3, "Bは4〜15の114点 + 1,2番の3点 = 117点");
  ok(st.score.B === 117, "ラックを跨いで得点が連続している");
  eq(st.racks.B, 0, "ローテーションはラック勝利の概念を使わない");
}

/* ============================================================ */
section("ローテーション: 合計120点");
{
  const m = app.createMatch({
    gameId: "rotation",
    goal: { type: "score", targets: { A: 120, B: 120 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const st = app.reduceMatch(m);
  eq(st.score.A, 120, "全15球で120点");
}

/* ============================================================ */
section("VOID: 訂正しても原記録が残り、集計からは除外される");
{
  const m = app.createMatch({
    gameId: "jpa_9ball",
    goal: { type: "score", targets: { A: 55, B: 38 }, source: "jpaSL", meta: { skillLevel: { A: 7, B: 5 } } },
    firstSide: "A",
    now: tick(),
  });

  pocket(m, "A", [1, 2]);
  const bad = pocket(m, "A", [3]); // 誤記録
  const before = app.reduceMatch(m);
  eq(before.score.A, 3, "訂正前は3点");

  const eventsBefore = m.events.length;
  app.voidEvent(m, bad.seq, "誤記録（実際は入っていない）", tick());

  const after = app.reduceMatch(m);
  eq(after.score.A, 2, "訂正後は2点");
  ok(m.events.length === eventsBefore + 1, "VOIDイベントが追記された");
  ok(m.events.find(function (e) { return e.seq === bad.seq; }) !== undefined, "原記録は消えていない");
  ok(m.events.find(function (e) { return e.seq === bad.seq; }).voided === true, "原記録にvoidedが立つ");

  // VOID自体は訂正できない
  const voidEv = m.events[m.events.length - 1];
  let threw = false;
  try {
    app.voidEvent(m, voidEv.seq, "test", tick());
  } catch (e) {
    threw = true;
  }
  ok(threw, "VOIDイベントは訂正できない");
}

/* ============================================================ */
section("undo: 直近のイベントを1件ずつ戻せる");
{
  const m = app.createMatch({
    gameId: "rotation",
    goal: { type: "score", targets: { A: 120, B: 120 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [1]);
  pocket(m, "A", [2]);
  pocket(m, "A", [3]);
  eq(app.reduceMatch(m).score.A, 6, "3球で6点");

  app.undoLast(m, tick());
  eq(app.reduceMatch(m).score.A, 3, "1回undoで3点");
  app.undoLast(m, tick());
  eq(app.reduceMatch(m).score.A, 1, "2回undoで1点");
  app.undoLast(m, tick());
  eq(app.reduceMatch(m).score.A, 0, "3回undoで0点");
}

/* ============================================================ */
section("undo: ショットクロックの自動記録は取り消しに食われない");
{
  // ショットクロックONだと、得点の直後に経過時間の記録が自動で積まれる。
  // undo がそれを取り消してしまい、得点が残ったまま「取り消した」ことに
  // なる不具合があった（2026-08-20に実機の検証で特定）。
  const m = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 5, B: 5 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  app.appendEvent(m, { t: "RACK_WIN", side: "A", d: { winner: "A" } }, tick());
  eq(app.reduceMatch(m).racks.A, 1, "1ラック取って1ラック");

  // 得点のあとに自動の記録が積まれた状態を作る
  app.appendEvent(m, { t: "SHOT_CLOCK", side: "A", d: { event: "shot", usedSec: 12 } }, tick());

  app.undoLast(m, tick());
  eq(app.reduceMatch(m).racks.A, 0, "自動記録があってもundoでラックが戻る");

  // 人が操作したショットクロックの記録（反則）は取り消せる
  const m2 = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 5, B: 5 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  app.appendEvent(m2, { t: "RACK_WIN", side: "A", d: { winner: "A" } }, tick());
  app.appendEvent(m2, { t: "SHOT_CLOCK", side: "A", d: { event: "violation" } }, tick());
  app.undoLast(m2, tick());
  eq(app.reduceMatch(m2).racks.A, 1, "反則の記録はundoで消え、ラックは残る");
}

/* ============================================================ */
section("スリーファール: 2ファール宣告がないと成立しない");
{
  // 宣告なし → 3回ファウルしてもラックは失わない
  const m1 = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 5, B: 5 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  foul(m1, "A", false);
  foul(m1, "A", false);
  foul(m1, "A", false);
  const st1 = app.reduceMatch(m1);
  eq(st1.racks.B, 0, "宣告なし: 3ファールは不成立");
  eq(st1.stats.A.fouls, 3, "ファウル自体はカウントされる");

  // 宣告あり → 相手のラック勝ち
  const m2 = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 5, B: 5 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  foul(m2, "A", false);
  foul(m2, "A", true); // 2ファール宣告
  foul(m2, "A", false);
  const st2 = app.reduceMatch(m2);
  eq(st2.racks.B, 1, "宣告あり: 相手のラック勝ち");
}

/* ============================================================ */
section("スリーファール: ブレイキングファールはカウントしない");
{
  const m = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 5, B: 5 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  foul(m, "A", false, "break");
  foul(m, "A", true, "break");
  foul(m, "A", false, "break");
  const st = app.reduceMatch(m);
  eq(st.racks.B, 0, "ブレイキングファール3回では成立しない");
}

/* ============================================================ */
section("スリーファール: ローテーションはラック負けにならない");
{
  const m = app.createMatch({
    gameId: "rotation",
    goal: { type: "score", targets: { A: 120, B: 120 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  foul(m, "A", false);
  foul(m, "A", true);
  foul(m, "A", false);
  const st = app.reduceMatch(m);
  eq(st.racks.B, 0, "ローテーションはラック負けにならない（フリーボールのみ）");
  eq(st.score.B, 0, "減点も加点もない");
  eq(st.foulStreak.A, 0, "カウントはリセットされる");
}

/* ============================================================ */
section("ブレイク方式: ウィナーズ / オルタネート");
{
  eq(app.nextBreakSide("winner", "A", "B"), "B", "勝者ブレイク: 勝者Bが次のブレイク");
  eq(app.nextBreakSide("winner", "A", "A"), "A", "勝者ブレイク: Aが連取ならAが継続");
  eq(app.nextBreakSide("alternate", "A", "B"), "B", "オルタネート: 交互（A→B）");
  eq(app.nextBreakSide("alternate", "B", "B"), "A", "オルタネート: 勝者に関係なく交互（B→A）");
  eq(app.nextBreakSide("continuation", "A", "B"), "B", "ローテーション: 撞き切った側");
}

/* ============================================================ */
section("ブレイク方式: ローテーション/カイルンは固定される");
{
  const m = app.createMatch({
    gameId: "rotation",
    goal: { type: "score", targets: { A: 120, B: 120 }, source: "free" },
    options: { breakType: "alternate" }, // 指定しても無視されるべき
    firstSide: "A",
    now: tick(),
  });
  eq(m.options.breakType, "continuation", "ローテーションはcontinuation固定");
}

/* ============================================================ */
section("記録責任者: オルタネイト時は非ブレイク側（規程第5章第4条）");
{
  const m1 = app.createMatch({
    gameId: "10ball",
    goal: { type: "racks", targets: { A: 7, B: 7 }, source: "free" },
    options: { breakType: "alternate" },
    firstSide: "A",
    now: tick(),
  });
  eq(m1.recordedBy, "B", "オルタネイト: 記録者は非ブレイク側");

  const m2 = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 5, B: 5 }, source: "free" },
    options: { breakType: "winner" },
    firstSide: "A",
    now: tick(),
  });
  eq(m2.recordedBy, "A", "ウィナーズ: 既定はブレイク側");
}

/* ============================================================ */
section("ボールハンデ: 得点対象の球を左右で変えられる");
{
  const m = app.createMatch({
    gameId: "9ball",
    goal: {
      type: "score",
      targets: { A: 10, B: 10 },
      source: "free",
      ballHandicap: {
        A: { scoringBalls: [9] }, // Aは9番のみ得点
        B: { scoringBalls: [7, 8, 9] }, // Bは7番以上が得点
      },
    },
    firstSide: "A",
    now: tick(),
  });

  pocket(m, "A", [1, 2, 3]); // Aは得点にならない
  turnEnd(m, "A", "miss");
  pocket(m, "B", [4, 5, 6]); // Bも得点にならない
  pocket(m, "B", [7, 8]); // Bは2点

  const st = app.reduceMatch(m);
  eq(st.score.A, 0, "Aは9番以外0点");
  eq(st.score.B, 2, "Bは7,8番で2点");
}

/* ============================================================ */
section("イニング: 後攻→先攻の遷移で1増える（ラックを跨いでも継続）");
{
  const m = app.createMatch({
    gameId: "jpa_9ball",
    goal: { type: "score", targets: { A: 55, B: 38 }, source: "jpaSL", meta: { skillLevel: { A: 7, B: 5 } } },
    firstSide: "A", // Aが先攻
    now: tick(),
  });

  turnEnd(m, "A", "miss"); // A→B: イニング増えない
  eq(app.reduceMatch(m).innings, 0, "先攻→後攻ではイニングは増えない");

  turnEnd(m, "B", "miss"); // B→A: 1イニング
  eq(app.reduceMatch(m).innings, 1, "後攻→先攻で1イニング");

  turnEnd(m, "A", "miss");
  turnEnd(m, "B", "miss");
  eq(app.reduceMatch(m).innings, 2, "2イニング目");
}

/* ============================================================ */
section("マスワリ: ブレイクして相手にターンを渡さず撞き切る");
{
  // マスワリ成立
  const m1 = app.createMatch({
    gameId: "jpa_9ball",
    goal: { type: "score", targets: { A: 55, B: 55 }, source: "jpaSL", meta: { skillLevel: { A: 7, B: 7 } } },
    firstSide: "A",
    now: tick(),
  });
  pocket(m1, "A", [1, 2, 3, 4, 5, 6, 7, 8], true);
  pocket(m1, "A", [9]);
  eq(app.reduceMatch(m1).stats.A.masuwari, 1, "撞き切ってマスワリ成立");

  // 途中で相手にターンが渡ったらマスワリではない
  const m2 = app.createMatch({
    gameId: "jpa_9ball",
    goal: { type: "score", targets: { A: 55, B: 55 }, source: "jpaSL", meta: { skillLevel: { A: 7, B: 7 } } },
    firstSide: "A",
    now: tick(),
  });
  pocket(m2, "A", [1, 2], true);
  turnEnd(m2, "A", "miss");
  turnEnd(m2, "B", "miss");
  pocket(m2, "A", [3, 4, 5, 6, 7, 8]);
  pocket(m2, "A", [9]);
  eq(app.reduceMatch(m2).stats.A.masuwari, 0, "ターンが渡ったのでマスワリではない");
}

/* ============================================================ */
section("ブレイクエース: 10ボールでは成立しない（規程第10章第4条第5項）");
{
  const m = app.createMatch({
    gameId: "10ball",
    goal: { type: "racks", targets: { A: 7, B: 7 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [10], true);
  const st = app.reduceMatch(m);
  eq(st.stats.A.breakAce, 0, "10ボールにブレイクエースは存在しない");
}

/* ============================================================ */
section("JCL 9ボール: 9番=14点、入れた側は14点のみ");
{
  const m = app.createMatch({
    gameId: "jcl_9ball",
    goal: { type: "score", targets: { A: 39, B: 41 }, source: "manual" },
    firstSide: "A",
    now: tick(),
  });

  pocket(m, "A", [1, 2, 3]); // 3点
  turnEnd(m, "A", "miss");
  pocket(m, "B", [4, 5]); // 2点
  pocket(m, "B", [9]); // Bは14点のみになる

  const st = app.reduceMatch(m);
  eq(st.score.A, 3, "Aは落とした3球で3点");
  eq(st.score.B, 14, "9番を入れたBは14点のみ（4,5番の2点は加算されない）");
}

/* ============================================================ */
section("JCL 8ボール: 勝者14点 / 敗者は自グループ落球数");
{
  const m = app.createMatch({
    gameId: "jcl_8ball",
    goal: { type: "score", targets: { A: 40, B: 40 }, source: "manual" },
    firstSide: "A",
    now: tick(),
  });

  pocket(m, "A", [1, 2, 3]); // Aが3球
  turnEnd(m, "A", "miss");
  pocket(m, "B", [9, 10, 11, 12, 13, 14, 15]);
  pocket(m, "B", [8]); // Bが8番を入れて勝ち

  const st = app.reduceMatch(m);
  eq(st.score.B, 14, "勝者Bは14点固定");
  eq(st.score.A, 3, "敗者Aは落とした3球で3点");
}

/* ============================================================ */
section("カイルン: 3ステップ完遂で1点、ペナルティで減点");
{
  const m = app.createMatch({
    gameId: "kailun",
    goal: { type: "score", targets: { A: 5, B: 5 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });

  app.appendEvent(m, { t: "STEP", side: "A", d: { step: 1, result: "ok" } }, tick());
  eq(app.reduceMatch(m).score.A, 0, "Step1だけでは加点されない");
  app.appendEvent(m, { t: "STEP", side: "A", d: { step: 2, result: "ok" } }, tick());
  eq(app.reduceMatch(m).score.A, 0, "Step2でもまだ加点されない");
  app.appendEvent(m, { t: "STEP", side: "A", d: { step: 3, result: "ok" } }, tick());
  eq(app.reduceMatch(m).score.A, 1, "3ステップ完遂で1点");

  // ペナルティ（selfMinus）
  app.appendEvent(m, { t: "STEP", side: "A", d: { result: "penalty" } }, tick());
  const st = app.reduceMatch(m);
  eq(st.score.A, 0, "ペナルティで-1点");
  eq(st.step.A, 1, "ステップはリセットされる");
}

section("カイルン: ペナルティ方式 othersPlus");
{
  const m = app.createMatch({
    gameId: "kailun",
    goal: { type: "score", targets: { A: 5, B: 5 }, source: "free" },
    options: { penaltyMode: "othersPlus" },
    firstSide: "A",
    now: tick(),
  });
  app.appendEvent(m, { t: "STEP", side: "A", d: { result: "penalty" } }, tick());
  const st = app.reduceMatch(m);
  eq(st.score.A, 0, "自分は減点されない");
  eq(st.score.B, 1, "相手に+1点");
}

/* ============================================================ */
section("勝利判定: ハンデ（非対称な目標値）で正しく決着する");
{
  const m = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 7, B: 4 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });

  // Bが4ラック取れば勝ち
  for (let i = 0; i < 4; i++) {
    app.appendEvent(m, { t: "RACK_WIN", side: "B", d: { winner: "B" } }, tick());
    rackStart(m, i + 2, "B");
  }
  const st = app.reduceMatch(m);
  eq(st.winner, "B", "先に目標4に達したBの勝ち");
  eq(st.racks.B, 4, "Bのラック数");
}

/* ============================================================ */
section("JPAチームポイント: 合計が常に20 / result生成");
{
  const m = app.createMatch({
    gameId: "jpa_9ball",
    sides: [{ name: "山田" }, { name: "佐藤" }],
    goal: {
      type: "score",
      targets: app.jpaGoal9Ball(7, 5, false),
      source: "jpaSL",
      meta: { skillLevel: { A: 7, B: 5 } },
    },
    firstSide: "A",
    now: tick(),
  });

  // Aが55点に到達するまで加点、Bは41点で止める想定
  // 簡易化のため直接イベントを積む
  let rack = 1;
  while (app.reduceMatch(m).score.A < 55) {
    pocket(m, "A", [1, 2, 3, 4, 5, 6, 7, 8]);
    pocket(m, "A", [9]);
    rack++;
    rackStart(m, rack, "A");
  }
  const res = app.buildResult(m, tick());
  eq(res.winner, "A", "Aの勝ち");
  ok(res.jpa !== undefined, "JPAチームポイントが算出される");
  eq(res.jpa.teamPoints.A + res.jpa.teamPoints.B, 20, "チームポイント合計は20");
}

/* ============================================================ */
section("14-1: 球1個=1点、番号は関係ない");
{
  const m = app.createMatch({
    gameId: "straight",
    goal: { type: "score", targets: { A: 100, B: 100 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [15]); // 15番でも1点
  eq(app.reduceMatch(m).score.A, 1, "15番でも1点");
  pocket(m, "A", [1, 2, 3]);
  eq(app.reduceMatch(m).score.A, 4, "3個入れて合計4点");
}

/* ============================================================ */
section("14-1: ラックを跨いで得点が連続する（ブレイクボール方式）");
{
  const m = app.createMatch({
    gameId: "straight",
    goal: { type: "score", targets: { A: 100, B: 100 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  // 14個入れて、ブレイクボール1個を残してラックを組み直す
  pocket(m, "A", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  eq(app.reduceMatch(m).score.A, 14, "14個で14点");
  rackStart(m, 2, "A", { continuation: true });
  pocket(m, "A", [15]); // ブレイクボールを入れて次のラックへ
  eq(app.reduceMatch(m).score.A, 15, "ラックを跨いで得点が続く");
  eq(app.reduceMatch(m).racks.A, 0, "ラック勝ちの概念は使わない");
}

/* ============================================================ */
section("14-1: ファウル1回につき1点減点（第9条第2項）");
{
  const m = app.createMatch({
    gameId: "straight",
    goal: { type: "score", targets: { A: 100, B: 100 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [1, 2, 3, 4, 5]);
  eq(app.reduceMatch(m).score.A, 5, "5点");
  foul(m, "A", false);
  eq(app.reduceMatch(m).score.A, 4, "ファウルで1点減点");
  eq(app.reduceMatch(m).stats.A.penaltyPoints, -1, "減点が記録される");
}

/* ============================================================ */
section("14-1: スリーファールは合計16点減点（第9条第3項）");
{
  const m = app.createMatch({
    gameId: "straight",
    goal: { type: "score", targets: { A: 100, B: 100 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // 20点まで貯める
  pocket(m, "A", [11, 12, 13, 14]);
  eq(app.reduceMatch(m).score.A, 14, "14点");

  foul(m, "A", false); // 1回目 -1
  eq(app.reduceMatch(m).score.A, 13, "1回目のファウルで13点");
  foul(m, "A", false); // 2回目 -1
  eq(app.reduceMatch(m).score.A, 12, "2回目のファウルで12点");
  // 第9条第3項:「スリーファール目の減点は、ファールの1点とスリーファールの15点、
  // 合計16点が減点される」→ 3回目のショットだけで-16。1・2回目の-1ずつと合わせて通算-18
  foul(m, "A", false);
  const st = app.reduceMatch(m);
  eq(st.score.A, -4, "3回目で16点減点され -4点になる（12-16）");
  eq(14 - st.score.A, 18, "3連続ファウルの通算減点は18点（-1,-1,-16）");
  eq(st.stats.A.threeFouls, 1, "スリーファールが記録される");
  eq(st.foulStreak.A, 0, "カウントはリセットされる");
}

/* ============================================================ */
section("14-1: スリーファールに2ファール宣告は不要（9ボールとの違い）");
{
  // 14-1: 宣告なしでも成立する（第8条第2項に宣告の要件がない）
  const m = app.createMatch({
    gameId: "straight",
    goal: { type: "score", targets: { A: 100, B: 100 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  foul(m, "A", false);
  foul(m, "A", false);
  foul(m, "A", false);
  eq(app.reduceMatch(m).stats.A.threeFouls, 1, "宣告なしでもスリーファールが成立する");

  // 9ボールは宣告がないと成立しない（対比）
  const m2 = app.createMatch({
    gameId: "9ball",
    goal: { type: "racks", targets: { A: 5, B: 5 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  foul(m2, "A", false);
  foul(m2, "A", false);
  foul(m2, "A", false);
  eq(app.reduceMatch(m2).racks.B, 0, "9ボールは宣告なしだと成立しない（対比）");
}

/* ============================================================ */
section("14-1: ブレイクの減点（第9条第4項）");
{
  // 正常でないオープニングブレイク → 2点減点
  const m = app.createMatch({
    gameId: "straight",
    goal: { type: "score", targets: { A: 100, B: 100 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  app.appendEvent(m, { t: "FOUL", side: "A", d: { kind: "break", illegalBreak: true } }, tick());
  eq(app.reduceMatch(m).score.A, -2, "正常でないブレイクは2点減点");

  // 正常なブレイクでのスクラッチ → 1点減点
  const m2 = app.createMatch({
    gameId: "straight",
    goal: { type: "score", targets: { A: 100, B: 100 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  app.appendEvent(m2, { t: "FOUL", side: "A", d: { kind: "break" } }, tick());
  eq(app.reduceMatch(m2).score.A, -1, "正常なブレイクでのファウルは1点減点");

  // ブレイクファウルはスリーファールにカウントしない
  const st = app.reduceMatch(m2);
  eq(st.foulStreak.A, 0, "ブレイクファウルはスリーファールに数えない");
}

/* ============================================================ */
section("14-1以外の種目では減点が起きないこと");
{
  const m = app.createMatch({
    gameId: "rotation",
    goal: { type: "score", targets: { A: 120, B: 120 }, source: "free" },
    firstSide: "A",
    now: tick(),
  });
  pocket(m, "A", [10]);
  foul(m, "A", false);
  eq(app.reduceMatch(m).score.A, 10, "ローテーションはファウルで減点されない");
  eq(app.reduceMatch(m).stats.A.penaltyPoints, 0, "減点は記録されない");
}

/* ============================================================ */
section("エンジンに種目名の分岐がないこと（設計ゲート）");
{
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8");
  const gameIds = Object.keys(app.GAMES);
  const found = gameIds.filter(function (id) {
    return src.indexOf('"' + id + '"') >= 0 || src.indexOf("'" + id + "'") >= 0;
  });
  eq(found, [], "engine.js に種目名のハードコードがない");
}

/* ============================================================ */
section("ボールハンデ: 片側だけに付けた場合、無ハンデ側はキーボールのみ得点");
{
  // 実戦で一番多い形。「Bにだけハンデを与える」場合に
  // Aが1番を入れただけで点が入ってしまわないことを確かめる
  const m = app.createMatch({
    gameId: "9ball",
    goal: {
      type: "score",
      targets: { A: 5, B: 5 },
      source: "free",
      ballHandicap: {
        A: null, // ハンデなし＝9番のみ
        B: { from: 7, scoringBalls: [7, 8, 9] },
      },
    },
    firstSide: "A",
    now: tick(),
  });

  pocket(m, "A", [1, 2, 3]);
  eq(app.reduceMatch(m).score.A, 0, "ハンデなし側は1,2,3番では得点しない");

  pocket(m, "A", [8]);
  eq(app.reduceMatch(m).score.A, 0, "ハンデなし側は8番でも得点しない");

  pocket(m, "A", [9]);
  eq(app.reduceMatch(m).score.A, 1, "ハンデなし側は9番で1点");

  turnEnd(m, "A", "miss");
  pocket(m, "B", [1, 2]);
  eq(app.reduceMatch(m).score.B, 0, "ハンデあり側も6番以下では得点しない");

  pocket(m, "B", [7]);
  eq(app.reduceMatch(m).score.B, 1, "ハンデあり側は7番で1点");
  pocket(m, "B", [8]);
  eq(app.reduceMatch(m).score.B, 2, "8番でも1点");
}

/* ============================================================ */
section("ボールハンデ: 両側とも無ハンデならラック集計のまま");
{
  const m = app.createMatch({
    gameId: "9ball",
    goal: {
      type: "racks",
      targets: { A: 3, B: 3 },
      source: "free",
      ballHandicap: { A: null, B: null },
    },
    firstSide: "A",
    now: tick(),
  });
  eq(app.reduceMatch(m).score.A, 0, "初期状態は0点");
  // ラック集計の種目なので、ラック勝利で1つ増える
  app.appendEvent(m, { t: "RACK_WIN", side: "A", d: { winner: "A" } });
  eq(app.reduceMatch(m).racks.A, 1, "ラック集計はそのまま動く");
}

/* ============================================================ */
section("ボウラード: ボウリングと同じ計算になる");
{
  const cfg = { frames: 10, pinsPerFrame: 10 };

  // パーフェクト: 全部ストライク（12投）= 300点
  const perfect = [10,10,10,10,10,10,10,10,10,10,10,10];
  eq(app.buildBowlardScore(perfect, cfg).total, 300, "オールストライクで300点");
  eq(app.buildBowlardScore(perfect, cfg).complete, true, "完了として扱う");

  // 全部9本+ミス(0) = 90点
  const nines = [];
  for (let f = 0; f < 10; f++) { nines.push(9, 0); }
  eq(app.buildBowlardScore(nines, cfg).total, 90, "9本+ミスを10回で90点");

  // 全部スペア(5,5)＋最後に5 = 150点
  const spares = [];
  for (let f = 0; f < 10; f++) { spares.push(5, 5); }
  spares.push(5);
  eq(app.buildBowlardScore(spares, cfg).total, 150, "オールスペア(5-5)で150点");

  // 1投も入らない = 0点
  const gutter = [];
  for (let f = 0; f < 10; f++) { gutter.push(0, 0); }
  eq(app.buildBowlardScore(gutter, cfg).total, 0, "1個も入らなければ0点");
}

/* ============================================================ */
section("ボウラード: ストライクとスペアのボーナス");
{
  const cfg = { frames: 10, pinsPerFrame: 10 };

  // 1F ストライク → 次の2投(3,4)がボーナス = 17点
  const r = app.buildBowlardScore([10, 3, 4], cfg);
  eq(r.frames[0].kind, "strike", "1フレーム目はストライク");
  eq(r.frames[0].score, 17, "ストライクは10+3+4=17");
  eq(r.frames[1].score, 24, "2フレーム目は17+7=24");

  // スペア → 次の1投がボーナス
  const r2 = app.buildBowlardScore([6, 4, 5, 2], cfg);
  eq(r2.frames[0].kind, "spare", "6+4はスペア");
  eq(r2.frames[0].score, 15, "スペアは10+5=15");
  eq(r2.frames[1].score, 22, "2フレーム目は15+7=22");

  // オープンフレーム
  const r3 = app.buildBowlardScore([3, 4], cfg);
  eq(r3.frames[0].kind, "open", "10未満はオープン");
  eq(r3.frames[0].score, 7, "そのまま7点");

  // ボーナスが未確定のうちは score を出さない
  const r4 = app.buildBowlardScore([10], cfg);
  eq(r4.frames[0].score, null, "次の2投が無いうちは点数を確定させない");
  eq(r4.complete, false, "未完了");
}

/* ============================================================ */
section("ボウラード: 10フレーム目の扱い");
{
  const cfg = { frames: 10, pinsPerFrame: 10 };
  // 9フレームまで0点、10フレーム目でストライク→3投
  const t = [];
  for (let f = 0; f < 9; f++) { t.push(0, 0); }
  t.push(10, 10, 10);
  const r = app.buildBowlardScore(t, cfg);
  eq(r.total, 30, "10フレーム目のオールストライクは30点");
  eq(r.complete, true, "3投で完了");

  // 10フレーム目がオープンなら2投で終わり
  const t2 = [];
  for (let f = 0; f < 9; f++) { t2.push(0, 0); }
  t2.push(3, 4);
  const r2 = app.buildBowlardScore(t2, cfg);
  eq(r2.total, 7, "オープンは2投で7点");
  eq(r2.complete, true, "2投で完了");
}

/* ============================================================ */
section("ボウラード: 次の投球で入れられる残り球数");
{
  const cfg = { frames: 10, pinsPerFrame: 10 };
  eq(app.bowlardRemainingPins([], cfg), 10, "最初は10個");
  eq(app.bowlardRemainingPins([3], cfg), 7, "3個入れたら残り7個");
  eq(app.bowlardRemainingPins([3, 4], cfg), 10, "フレームが変わると10個に戻る");
  eq(app.bowlardRemainingPins([10], cfg), 10, "ストライクの次も10個");
  eq(app.bowlardRemainingPins([6, 4], cfg), 10, "スペアの次も10個");
}

/* ============================================================ */
console.log("\n========================================");
console.log("成功: " + pass + " / 失敗: " + fail);
if (failures.length) {
  console.log("\n【失敗した項目】");
  failures.forEach(function (f, i) {
    console.log("  " + (i + 1) + ". " + f);
  });
  process.exit(1);
} else {
  console.log("すべて成功");
}
