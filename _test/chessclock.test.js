/**
 * chessclock.test.js — チェスクロック（持ち時間制）の検証
 * 実行: node _test/chessclock.test.js
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

function makeClock() {
  let vnow = 1000000;
  const timers = [];
  const sandbox = {
    console: console,
    Date: { now: function () { return vnow; } },
    Math: Math,
    String: String,
    setInterval: function (fn) { const t = { fn: fn }; timers.push(t); return t; },
    clearInterval: function (t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "chessclock.js"), "utf8");
  vm.runInContext(src + "\n;createChessClock;", sandbox, { filename: "chessclock.js" });

  return {
    create: function (cfg, cb) { return vm.runInContext("createChessClock", sandbox)(cfg, cb); },
    advance: function (ms, steps) {
      const n = steps || 1;
      for (let i = 0; i < n; i++) {
        vnow += ms / n;
        timers.slice().forEach(function (t) { t.fn(); });
      }
    },
    jump: function (ms) { vnow += ms; },
    fire: function () { timers.slice().forEach(function (t) { t.fn(); }); },
    timerCount: function () { return timers.length; },
  };
}

/* ============================================================ */
section("自分の番の間だけ減る");
{
  const C = makeClock();
  const cc = C.create({ enabled: true, minutes: 10, warnAtSec: 60 }, {});
  cc.start("A");
  eq(cc.remainSec("A"), 600, "開始時は10分＝600秒");
  eq(cc.remainSec("B"), 600, "相手も600秒");

  C.advance(30000, 30);
  eq(cc.remainSec("A"), 570, "Aは30秒使った");
  eq(cc.remainSec("B"), 600, "Bは減っていない（自分の番ではない）");
}

/* ============================================================ */
section("ターン交代で、使った秒数が返る");
{
  const C = makeClock();
  const cc = C.create({ enabled: true, minutes: 10, warnAtSec: 60 }, {});
  cc.start("A");
  C.advance(45000, 45);

  const r = cc.switchTurn();
  eq(r.side, "A", "交代したのはA");
  eq(r.usedSec, 45, "Aは45秒使った");
  eq(cc.state().side, "B", "いまはBの番");

  C.advance(20000, 20);
  eq(cc.remainSec("A"), 555, "Aは止まっている（600-45）");
  eq(cc.remainSec("B"), 580, "Bが減っている");

  const r2 = cc.switchTurn();
  eq(r2.usedSec, 20, "Bは20秒使った");
}

/* ============================================================ */
section("バックグラウンド化してもズレない");
{
  const C = makeClock();
  const cc = C.create({ enabled: true, minutes: 10, warnAtSec: 60 }, {});
  cc.start("A");
  C.jump(120000); // タイマーが発火しないまま2分経過
  eq(cc.remainSec("A"), 480, "タイマー未発火でも正しく減っている");
}

/* ============================================================ */
section("残り時間の警告は1回だけ");
{
  const C = makeClock();
  const warns = [];
  const cc = C.create(
    { enabled: true, minutes: 2, warnAtSec: 30 },
    { onWarn: function (s, sec) { warns.push({ side: s, sec: sec }); } }
  );
  cc.start("A");
  C.advance(89000, 89);
  eq(warns.length, 0, "残り31秒では警告しない");
  C.advance(2000, 2);
  eq(warns.length, 1, "残り30秒を切ると警告");
  eq(warns[0].side, "A", "警告対象が正しい");
  C.advance(10000, 10);
  eq(warns.length, 1, "警告は繰り返さない");
}

/* ============================================================ */
section("使い切ると時間切れになる");
{
  const C = makeClock();
  const expired = [];
  const cc = C.create(
    { enabled: true, minutes: 1, warnAtSec: 10 },
    { onExpire: function (s) { expired.push(s); } }
  );
  cc.start("A");
  C.advance(60000, 60);
  eq(expired, ["A"], "Aが時間切れ");
  eq(cc.state().expired, "A", "状態にも残る");
  eq(cc.remainSec("A"), 0, "残りは0");
  eq(C.timerCount(), 0, "タイマーが解放されている");
}

/* ============================================================ */
section("秒読み: 持ち時間を使い切っても1手ごとに撞ける");
{
  const C = makeClock();
  const events = [];
  const cc = C.create(
    { enabled: true, minutes: 1, warnAtSec: 10, byoyomiSec: 30 },
    {
      onByoyomi: function (s) { events.push("byoyomi:" + s); },
      onExpire: function (s) { events.push("expire:" + s); },
    }
  );
  cc.start("A");
  C.advance(60000, 60);
  eq(events, ["byoyomi:A"], "持ち時間切れで秒読みに入る（まだ負けではない）");
  eq(cc.state().inByoyomi.A, true, "秒読み中フラグ");
  eq(cc.state().byoyomiRemainSec, 30, "秒読みは30秒");

  // 秒読み中に交代すれば負けない
  C.advance(20000, 20);
  cc.switchTurn();
  eq(events.length, 1, "20秒で交代したので時間切れにならない");

  // 戻ってきて秒読みを使い切ると負け
  cc.start("A");
  C.advance(31000, 31);
  eq(events[events.length - 1], "expire:A", "秒読みを使い切ると時間切れ");
}

/* ============================================================ */
section("一時停止中は減らない");
{
  const C = makeClock();
  const cc = C.create({ enabled: true, minutes: 10, warnAtSec: 60 }, {});
  cc.start("A");
  C.advance(30000, 30);
  cc.pause();
  eq(cc.remainSec("A"), 570, "停止時点は570秒");
  C.jump(120000);
  eq(cc.remainSec("A"), 570, "停止中は減らない");
  cc.resume();
  C.advance(10000, 10);
  eq(cc.remainSec("A"), 560, "再開後は続きから減る");
}

/* ============================================================ */
section("無効時は動かない");
{
  const C = makeClock();
  const cc = C.create({ enabled: false, minutes: 10 }, {});
  cc.start("A");
  eq(cc.state().running, false, "enabled:false では起動しない");
  eq(C.timerCount(), 0, "タイマーも作られない");
}

/* ============================================================ */
section("タイマーが二重に走らない");
{
  const C = makeClock();
  const cc = C.create({ enabled: true, minutes: 10 }, {});
  cc.start("A");
  cc.start("A");
  cc.start("B");
  eq(C.timerCount(), 1, "何度startしてもタイマーは1つ");
  cc.stop();
  eq(C.timerCount(), 0, "stopで解放される");
}

/* ============================================================ */
section("表示形式（mm:ss）");
{
  const C = makeClock();
  const cc = C.create({ enabled: true, minutes: 10 }, {});
  eq(cc.fmt(600), "10:00", "600秒は10:00");
  eq(cc.fmt(65), "1:05", "65秒は1:05");
  eq(cc.fmt(5), "0:05", "5秒は0:05");
  eq(cc.fmt(0), "0:00", "0秒は0:00");
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
