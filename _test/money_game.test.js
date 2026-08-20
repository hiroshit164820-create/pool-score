/**
 * money_game.test.js — 5-9 / 5-10 の点数計算
 *
 * ルールは本人からの聞き取り（2026-08-20）。公式競技規程は存在しない。
 */
const MONEY = require("../js/money_game.js");

let ok = 0;
const ng = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { ok++; console.log("OK  " + label); }
  else { ng.push({ label: label, a: a, e: e }); console.log("NG  " + label); }
}

function section(name) { console.log("\n── " + name + " ──"); }

const G59 = MONEY.GAMES["59"];
const G510 = MONEY.GAMES["510"];
const P2 = [{ id: "a" }, { id: "b" }];
const P3 = [{ id: "a" }, { id: "b" }, { id: "c" }];

/* ============================================================ */
section("素点: 5番=1点、9番=2点");
eq(MONEY.basePoint(G59, 5, []), 1, "5番は1点");
eq(MONEY.basePoint(G59, 9, []), 2, "9番は2点");
eq(MONEY.basePoint(G59, 3, []), 0, "関係ない球は0点");
eq(MONEY.basePoint(G510, 10, []), 2, "5-10は10番が2点");
eq(MONEY.basePoint(G510, 9, []), 0, "5-10で9番は点にならない");

section("ハンデボールは1点。持っている本人だけ");
eq(MONEY.basePoint(G59, 7, [7]), 1, "自分のハンデ球は1点");
eq(MONEY.basePoint(G59, 7, []), 0, "持っていなければ0点");
eq(MONEY.basePoint(G59, 3, [3, 7]), 1, "複数持てる（3番）");
eq(MONEY.basePoint(G59, 7, [3, 7]), 1, "複数持てる（7番）");

section("サイドポケットは倍");
eq(MONEY.pointPerOpponent(G59, 9, [], true), 4, "9番サイドは4点");
eq(MONEY.pointPerOpponent(G59, 9, [], false), 2, "9番コーナーは2点");
eq(MONEY.pointPerOpponent(G59, 5, [], true), 2, "5番サイドは2点");

/* ============================================================ */
section("2人: 相手からもらう（ゼロサム）");
{
  // 9番をコーナーで落とす → aが2点もらい、bが2点払う
  const r = MONEY.tally(G59, P2, [{ by: "a", ball: 9 }], {}, []);
  eq(r.totals.a, 2, "aは+2");
  eq(r.totals.b, -2, "bは-2");
  eq(r.totals.a + r.totals.b, 0, "合計は0（ゼロサム）");
}

section("3人: 全員からもらう");
{
  // 9番コーナー = 2点を2人からもらう → a +4 / b -2 / c -2
  const r = MONEY.tally(G59, P3, [{ by: "a", ball: 9 }], {}, []);
  eq(r.totals.a, 4, "aは+4（2人ぶん）");
  eq(r.totals.b, -2, "bは-2");
  eq(r.totals.c, -2, "cは-2");
  eq(r.totals.a + r.totals.b + r.totals.c, 0, "合計は0");
}

section("3人: 9番サイドは倍で全員から");
{
  // 2点 ×サイド2倍 = 4点 を2人から → a +8
  const r = MONEY.tally(G59, P3, [{ by: "a", ball: 9, side: true }], {}, []);
  eq(r.totals.a, 8, "aは+8（4点×2人）");
  eq(r.totals.b, -4, "bは-4");
}

/* ============================================================ */
section("マスワリ: そのラックの得点すべてが倍");
{
  // aが5番と9番を落として撞き切った → (1+2)=3点が倍で6点
  const shots = [{ by: "a", ball: 5 }, { by: "a", ball: 9 }];
  const racks = [{ at: 2, runoutBy: "a" }];
  const r = MONEY.tally(G59, P2, shots, {}, racks);
  eq(r.totals.a, 6, "5番+9番=3点がマスワリで6点");
  eq(r.totals.b, -6, "bは-6");
}

section("マスワリでない場合は倍にしない");
{
  const shots = [{ by: "a", ball: 5 }, { by: "a", ball: 9 }];
  const racks = [{ at: 2, runoutBy: null }];
  const r = MONEY.tally(G59, P2, shots, {}, racks);
  eq(r.totals.a, 3, "倍にならず3点");
}

section("サイド倍とマスワリ倍が重なると4倍（掛け算）");
{
  // 9番をサイドに落として撞き切った → 2点 ×サイド2 ×マスワリ2 = 8点
  const shots = [{ by: "a", ball: 9, side: true }];
  const racks = [{ at: 1, runoutBy: "a" }];
  const r = MONEY.tally(G59, P2, shots, {}, racks);
  eq(r.totals.a, 8, "2点×2×2=8点");
}

section("マスワリの倍はそのラックの得点だけ");
{
  // 1ラック目は普通に9番、2ラック目でマスワリ
  const shots = [
    { by: "a", ball: 9 },                    // ラック1: 2点
    { by: "a", ball: 5 }, { by: "a", ball: 9 }, // ラック2: 3点 → 倍で6点
  ];
  const racks = [{ at: 1, runoutBy: null }, { at: 3, runoutBy: "a" }];
  const r = MONEY.tally(G59, P2, shots, {}, racks);
  eq(r.totals.a, 8, "2点 + 6点 = 8点（1ラック目は倍にならない）");
}

/* ============================================================ */
section("ハンデ: 持っている本人だけが得点する");
{
  // aは7番を持つ。aが7番を入れれば1点、bが入れても0点
  const hc = { a: [7] };
  const r1 = MONEY.tally(G59, P2, [{ by: "a", ball: 7 }], hc, []);
  eq(r1.totals.a, 1, "持っている人が入れれば1点");
  const r2 = MONEY.tally(G59, P2, [{ by: "b", ball: 7 }], hc, []);
  eq(r2.totals.b, 0, "持っていない人が入れても0点");
}

section("ハンデ: 人ごとに別々の球を持てる");
{
  const hc = { a: [3, 7], b: [11] };
  const r = MONEY.tally(G59, P2, [
    { by: "a", ball: 3 }, { by: "a", ball: 7 }, { by: "b", ball: 11 },
  ], hc, []);
  eq(r.totals.a, 1, "aは2点取ってbに1点払う → +1");
  eq(r.totals.b, -1, "bは1点取ってaに2点払う → -1");
}

section("取り消した記録は数えない");
{
  const r = MONEY.tally(G59, P2, [
    { by: "a", ball: 9 }, { by: "a", ball: 9, voided: true },
  ], {}, []);
  eq(r.totals.a, 2, "取り消したぶんは入らない");
}

/* ============================================================ */
section("得点になる球の一覧");
eq(MONEY.scoringBalls(G59, []), [5, 9], "5-9は5番と9番");
eq(MONEY.scoringBalls(G510, []), [5, 10], "5-10は5番と10番");
eq(MONEY.scoringBalls(G59, [3, 7]), [3, 5, 7, 9], "ハンデ球も並ぶ（番号順）");
eq(MONEY.scoringBalls(G59, [9]), [5, 9], "重複しない");

console.log("\n========================================");
console.log("成功: " + ok + " / 失敗: " + ng.length);
if (ng.length) {
  console.log("\n【失敗した項目】");
  ng.forEach(function (x, i) {
    console.log("  " + (i + 1) + ". " + x.label + "\n    期待: " + x.e + "\n    実際: " + x.a);
  });
  process.exit(1);
}
console.log("すべて成功");
