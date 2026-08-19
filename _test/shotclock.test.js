/**
 * shotclock.test.js — ショットクロックの検証
 * 実行: node _test/shotclock.test.js
 *
 * 時刻とタイマーを差し替えて、実時間を待たずに検証する。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
const failures = [];
function eq(a, e, label) {
  const as = JSON.stringify(a), es = JSON.stringify(e);
  if (as === es) pass++;
  else { fail++; failures.push(label + "\n    期待: " + es + "\n    実際: " + as); }
}
function ok(c, label) { eq(!!c, true, label); }
function section(n) { console.log("\n── " + n + " ──"); }

/** 仮想時計でショットクロックを読み込む */
function makeClock() {
  let vnow = 1000000;
  const timers = [];
  const sandbox = {
    console: console,
    Date: { now: function () { return vnow; } },
    Math: Math,
    setInterval: function (fn) { const t = { fn: fn }; timers.push(t); return t; },
    clearInterval: function (t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "shotclock.js"), "utf8");
  vm.runInContext(src + "\n;createShotClock;", sandbox, { filename: "shotclock.js" });

  return {
    create: function (cfg, cb) { return vm.runInContext("createShotClock", sandbox)(cfg, cb); },
    /** 仮想時間を進めてタイマーを発火させる */
    advance: function (ms, steps) {
      const n = steps || 1;
      for (let i = 0; i < n; i++) {
        vnow += ms / n;
        timers.slice().forEach(function (t) { t.fn(); });
      }
    },
    /** タイマーを発火させずに時間だけ飛ばす（バックグラウンド化の再現） */
    jump: function (ms) { vnow += ms; },
    fire: function () { timers.slice().forEach(function (t) { t.fn(); }); },
    timerCount: function () { return timers.length; },
  };
}

/* ============================================================ */
section("基本: 45秒から減っていく");
{
  const C = makeClock();
  const sc = C.create({ enabled: true, seconds: 45, warnAtSec: 15 }, {});
  sc.start("A");
  eq(sc.remainSec(), 45, "開始直後は45秒");
  C.advance(10000);
  eq(sc.remainSec(), 35, "10秒経過で35秒");
  C.advance(30000);
  eq(sc.remainSec(), 5, "40秒経過で5秒");
}

/* ============================================================ */
section("バックグラウンド化してもズレない（Date.now差分方式）");
{
  const C = makeClock();
  const sc = C.create({ enabled: true, seconds: 45, warnAtSec: 15 }, {});
  sc.start("A");
  // タイマーが一度も発火しないまま30秒経過（スマホのバックグラウンド化を再現）
  C.jump(30000);
  eq(sc.remainSec(), 15, "タイマー未発火でも正しく15秒");
  C.fire();
  eq(sc.remainSec(), 15, "発火後も15秒のまま");
}

/* ============================================================ */
section("警告: 残り15秒で1回だけ通知される");
{
  const C = makeClock();
  let warns = [];
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15 },
    { onWarn: function (side, sec) { warns.push({ side: side, sec: sec }); } }
  );
  sc.start("A");
  C.advance(29000, 29);
  eq(warns.length, 0, "残り16秒では警告しない");
  C.advance(2000, 2);
  eq(warns.length, 1, "残り15秒を切ると警告");
  C.advance(5000, 5);
  eq(warns.length, 1, "警告は1回だけ（連続通知しない）");
  eq(warns[0].side, "A", "警告対象は撞いている側");
}

/* ============================================================ */
section("タイムアップ: ファウル通知が飛ぶ");
{
  const C = makeClock();
  let violations = [];
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15, extension: { countPerSide: 0, seconds: 45, mode: "declare" } },
    { onViolation: function (side) { violations.push(side); } }
  );
  sc.start("A");
  C.advance(45000, 45);
  eq(violations, ["A"], "タイムアップでファウル通知");
  eq(sc.state().violated, true, "violated フラグが立つ");
  eq(sc.state().running, false, "計測は止まる");
  eq(C.timerCount(), 0, "タイマーが解放されている");
}

/* ============================================================ */
section("一時停止: 規程第5章第5条第2項a");
{
  const C = makeClock();
  const sc = C.create({ enabled: true, seconds: 45, warnAtSec: 15 }, {});
  sc.start("A");
  C.advance(10000);
  sc.pause();
  eq(sc.remainSec(), 35, "一時停止時点は35秒");
  C.jump(60000); // 停止中に60秒経過しても減らない
  eq(sc.remainSec(), 35, "停止中は時間が減らない");
  eq(sc.state().violated, false, "停止中はタイムアップしない");
  sc.resume();
  C.advance(5000);
  eq(sc.remainSec(), 30, "再開後は続きから減る");
}

/* ============================================================ */
section("エクステンション（宣言式）: 回数制限を守る");
{
  const C = makeClock();
  let exts = [];
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15, extension: { countPerSide: 2, seconds: 45, mode: "declare" } },
    { onExtension: function (side, n, isAuto) { exts.push({ side: side, n: n, auto: isAuto }); } }
  );
  sc.start("A");
  C.advance(40000, 40);
  eq(sc.remainSec(), 5, "残り5秒");

  ok(sc.extend(), "1回目のエクステンションが使える");
  eq(sc.remainSec(), 45, "延長で45秒に戻る");
  eq(exts[0], { side: "A", n: 1, auto: false }, "宣言式として記録される");
  eq(sc.state().extensionsLeft.A, 1, "残り1回");

  C.advance(45000, 45);
  // 2回目は start しないと使えない（同一ショット内で連続延長はしない想定）
  sc.start("A");
  C.advance(44000, 44);
  ok(sc.extend(), "2回目のエクステンションが使える");
  eq(sc.state().extensionsLeft.A, 0, "残り0回");

  sc.start("A");
  C.advance(44000, 44);
  eq(sc.extend(), false, "3回目は使えない");
  eq(sc.canExtend("A"), false, "canExtendもfalse");
}

/* ============================================================ */
section("オートエクステンション: 宣言なしで自動延長");
{
  const C = makeClock();
  let exts = [], violations = [];
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15, extension: { countPerSide: 1, seconds: 30, mode: "auto" } },
    {
      onExtension: function (side, n, isAuto) { exts.push({ side: side, n: n, auto: isAuto }); },
      onViolation: function (side) { violations.push(side); },
    }
  );
  sc.start("A");
  C.advance(45000, 45);
  eq(violations.length, 0, "自動延長が入るのでファウルにならない");
  eq(exts.length, 1, "エクステンションが自動発動");
  eq(exts[0].auto, true, "auto:true として記録される");
  eq(sc.remainSec(), 30, "延長時間30秒");

  C.advance(30000, 30);
  eq(violations, ["A"], "延長も使い切るとファウル");
}

/* ============================================================ */
section("エクステンション回数は左右で独立");
{
  const C = makeClock();
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15, extension: { countPerSide: 1, seconds: 45, mode: "declare" } },
    {}
  );
  sc.start("A");
  C.advance(44000, 44);
  sc.extend();
  eq(sc.state().extensionsLeft, { A: 0, B: 1 }, "Aだけ消費される");

  sc.start("B");
  C.advance(44000, 44);
  ok(sc.extend(), "Bはまだ使える");
  eq(sc.state().extensionsLeft, { A: 0, B: 0 }, "両者とも使い切り");
}

/* ============================================================ */
section("無効時: startしても動かない");
{
  const C = makeClock();
  const sc = C.create({ enabled: false, seconds: 45 }, {});
  sc.start("A");
  eq(sc.state().running, false, "enabled:false では起動しない");
  eq(C.timerCount(), 0, "タイマーも作られない");
}

/* ============================================================ */
section("stop: タイマーが確実に解放される");
{
  const C = makeClock();
  const sc = C.create({ enabled: true, seconds: 45 }, {});
  sc.start("A");
  ok(C.timerCount() > 0, "起動中はタイマーがある");
  sc.stop();
  eq(C.timerCount(), 0, "stopでタイマー解放");
  sc.start("A");
  sc.start("A"); // 二重起動
  eq(C.timerCount(), 1, "二重startでもタイマーは1つ（リーク防止）");
}

/* ============================================================ */
section("エクステンションの回数: 既定は1ラックにつき1回");
{
  const C = makeClock();
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15, extension: { seconds: 30, mode: "declare" } },
    {}
  );
  eq(sc.state().extensionScope, "rack", "既定のスコープはラック");
  sc.start("A");
  eq(sc.state().extensionsLeft.A, 1, "ラック開始時は1回使える");
  eq(sc.extend(), true, "1回目は使える");
  eq(sc.state().extensionsLeft.A, 0, "使うと残り0回");
  eq(sc.extend(), false, "同じラックで2回目は使えない");

  sc.resetRack();
  sc.start("A");
  eq(sc.state().extensionsLeft.A, 1, "次のラックでは1回に戻る");
  eq(sc.extend(), true, "次のラックでまた使える");
  eq(sc.state().usedExtensions.A, 2, "試合を通しての累計は積み上がる");
}

/* ============================================================ */
section("エクステンションの回数: ラック単位でも左右は独立");
{
  const C = makeClock();
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15, extension: { countPerRack: 1, seconds: 30, mode: "declare" } },
    {}
  );
  sc.start("A");
  sc.extend();
  eq(sc.state().extensionsLeft, { A: 0, B: 1 }, "Aだけ消費される");
  sc.start("B");
  eq(sc.extend(), true, "同じラックでもBは使える");
  eq(sc.state().extensionsLeft, { A: 0, B: 0 }, "両者とも使い切り");
  sc.resetRack();
  eq(sc.state().extensionsLeft, { A: 1, B: 1 }, "ラックが変わると両者とも戻る");
}

/* ============================================================ */
section("エクステンションの回数: scope:match は試合を通しての総数");
{
  const C = makeClock();
  const sc = C.create(
    { enabled: true, seconds: 45, warnAtSec: 15,
      extension: { scope: "match", countPerSide: 2, seconds: 30, mode: "declare" } },
    {}
  );
  sc.start("A");
  eq(sc.extend(), true, "1回目");
  sc.resetRack();
  sc.start("A");
  eq(sc.state().extensionsLeft.A, 1, "ラックが変わっても回数は戻らない");
  eq(sc.extend(), true, "2回目");
  sc.resetRack();
  sc.start("A");
  eq(sc.extend(), false, "試合を通して2回で打ち止め");
}

/* ============================================================ */
section("オートエクステンションもラック単位で戻る");
{
  const C = makeClock();
  const fired = [];
  const sc = C.create(
    { enabled: true, seconds: 10, warnAtSec: 5, extension: { countPerRack: 1, seconds: 10, mode: "auto" } },
    { onExtension: function (side, n, auto) { fired.push([side, n, auto]); },
      onViolation: function (side) { fired.push(["violation", side]); } }
  );
  sc.start("A");
  C.advance(10000, 10);
  eq(fired.length, 1, "自動延長が1回発動した");
  eq(fired[0][2], true, "自動発動として通知される");
  eq(sc.state().inExtension, true, "延長中");
  C.advance(10000, 10);
  eq(fired[1][0], "violation", "1ラック1回なので2度目は時間切れになる");

  sc.resetRack();
  sc.start("B");
  C.advance(10000, 10);
  eq(fired[2][2], true, "次のラックでは自動延長がまた効く");
}

/* ============================================================ */
console.log("\n========================================");
console.log("成功: " + pass + " / 失敗: " + fail);
if (failures.length) {
  console.log("\n【失敗した項目】");
  failures.forEach(function (f, i) { console.log("  " + (i + 1) + ". " + f); });
  process.exit(1);
} else {
  console.log("すべて成功");
}
