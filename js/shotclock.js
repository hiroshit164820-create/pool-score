/**
 * shotclock.js — ショットクロック
 *
 * NBA規程 第5章第5条（タイム制）に準拠:
 *   第2項    決められたタイム内に1ショットしなければファウル
 *   第2項(a) 計測開始は台上の全ボールが停止してから。
 *            プレーに支障がある場合は申告して計測を一時止められる
 *   第2項(b) 経過時間・残り時間の宣告方法は大会ごとに定める
 *   第3項    エクステンション（回数・時間は大会ごと）。
 *            宣言式(declare)とオートエクステンション(auto)がある
 *
 * エクステンションの回数の数え方は大会によって2通りある。
 *   scope:"rack"  ラックごとに回数が戻る（既定。1ラックにつき countPerRack 回）
 *   scope:"match" 試合を通しての総数（countPerSide 回）
 * 既定は「1ラックにつき1回」。ラックが変わったら resetRack() を呼ぶ。
 *
 * 残り時間は Date.now() との差分で計算する（setIntervalの累積誤差や
 * バックグラウンド化によるタイマー間引きの影響を受けないため）。
 */

function createShotClock(config, callbacks) {
  const cfg = Object.assign(
    {
      enabled: false,
      seconds: 45,
      warnAtSec: 15,
      extension: { scope: "rack", countPerRack: 1, countPerSide: 2, seconds: 45, mode: "declare" },
      violationIsFoul: true,
    },
    config || {}
  );
  // extension は入れ子なので Object.assign では既定値が丸ごと置き換わる。
  // 呼び出し側が一部だけ渡してきた場合に既定値が消えないよう、ここで補う。
  const extIn = cfg.extension || {};
  cfg.extension = Object.assign(
    { countPerRack: 1, countPerSide: 2, seconds: 45, mode: "declare" },
    extIn
  );
  // scope が明示されていない場合の解釈。
  // countPerSide だけを渡してきた呼び出しは「試合を通しての総数」を意図しているため
  // match として扱う（このフィールドの元々の意味を変えない）。
  if (!extIn.scope) {
    cfg.extension.scope =
      extIn.countPerSide !== undefined && extIn.countPerRack === undefined ? "match" : "rack";
  }
  const cb = callbacks || {};

  let running = false;
  let paused = false;
  let deadline = 0; // 期限（epoch ms）
  let remainAtPause = 0;
  let side = null;
  let inExtension = false;
  let violated = false;
  const usedExtensions = { A: 0, B: 0 }; // 試合を通しての累計（記録・成績用）
  const usedThisRack = { A: 0, B: 0 }; // 現在のラックでの使用回数
  let timerId = null;
  let lastWarned = false;

  function now() {
    return Date.now();
  }

  function remainMs() {
    if (!running) return 0;
    if (paused) return remainAtPause;
    return Math.max(0, deadline - now());
  }

  function remainSec() {
    return Math.ceil(remainMs() / 1000);
  }

  function tick() {
    if (!running || paused) return;
    const left = remainMs();

    if (left <= 0) {
      if (!inExtension && cfg.extension.mode === "auto" && canExtend(side)) {
        // オートエクステンション: 宣言なしで自動的に延長に入る
        startExtension(true);
        return;
      }
      violated = true;
      running = false;
      stopTimer();
      if (cb.onViolation) cb.onViolation(side);
      if (cb.onTick) cb.onTick(0, state());
      return;
    }

    // 残り警告（1回だけ通知）
    const warn = left <= cfg.warnAtSec * 1000;
    if (warn && !lastWarned) {
      lastWarned = true;
      if (cb.onWarn) cb.onWarn(side, Math.ceil(left / 1000));
    }
    if (cb.onTick) cb.onTick(Math.ceil(left / 1000), state());
  }

  function startTimer() {
    stopTimer();
    // 200msごとに再描画。残り時間自体は常にDate.now差分で算出する
    timerId = setInterval(tick, 200);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /** ショット計測を開始する（台上の全ボールが停止した時点で呼ぶ） */
  function start(forSide) {
    if (!cfg.enabled) return;
    side = forSide;
    inExtension = false;
    violated = false;
    paused = false;
    lastWarned = false;
    deadline = now() + cfg.seconds * 1000;
    running = true;
    startTimer();
    tick();
  }

  /** 計測を止める（ショットが行われた／ラックが終わった等） */
  function stop() {
    running = false;
    paused = false;
    inExtension = false;
    lastWarned = false;
    stopTimer();
    if (cb.onTick) cb.onTick(null, state());
  }

  /** 一時停止（規程第5章第5条第2項a: プレーに支障がある場合） */
  function pause() {
    if (!running || paused) return;
    remainAtPause = remainMs();
    paused = true;
    stopTimer();
    if (cb.onTick) cb.onTick(Math.ceil(remainAtPause / 1000), state());
  }

  function resume() {
    if (!running || !paused) return;
    deadline = now() + remainAtPause;
    paused = false;
    startTimer();
    tick();
  }

  function togglePause() {
    if (paused) resume();
    else pause();
  }

  /** このスコープでの上限回数 */
  function extLimit() {
    return cfg.extension.scope === "match"
      ? cfg.extension.countPerSide
      : cfg.extension.countPerRack;
  }

  /** このスコープでの使用済み回数 */
  function extUsed(s) {
    return cfg.extension.scope === "match" ? usedExtensions[s] : usedThisRack[s];
  }

  function canExtend(forSide) {
    const s = forSide || side;
    if (!s) return false;
    return extUsed(s) < extLimit();
  }

  /** ラックが変わったときに呼ぶ。scope:"rack" のとき回数が戻る */
  function resetRack() {
    usedThisRack.A = 0;
    usedThisRack.B = 0;
  }

  /**
   * エクステンションを使う。
   * @param {boolean} isAuto オートエクステンションによる自動発動か
   */
  function startExtension(isAuto) {
    if (!running || !canExtend(side)) return false;
    usedExtensions[side]++;
    usedThisRack[side]++;
    inExtension = true;
    lastWarned = false;
    deadline = now() + cfg.extension.seconds * 1000;
    paused = false;
    startTimer();
    if (cb.onExtension) cb.onExtension(side, usedExtensions[side], !!isAuto);
    tick();
    return true;
  }

  function state() {
    return {
      enabled: cfg.enabled,
      running: running,
      paused: paused,
      side: side,
      inExtension: inExtension,
      violated: violated,
      remainSec: remainSec(),
      totalSec: inExtension ? cfg.extension.seconds : cfg.seconds,
      warnAtSec: cfg.warnAtSec,
      usedExtensions: { A: usedExtensions.A, B: usedExtensions.B },
      usedThisRack: { A: usedThisRack.A, B: usedThisRack.B },
      extensionScope: cfg.extension.scope,
      // 残り回数は「いま効いている数え方」で出す。画面もこの値をそのまま出す
      extensionsLeft: {
        A: Math.max(0, extLimit() - extUsed("A")),
        B: Math.max(0, extLimit() - extUsed("B")),
      },
      canExtend: canExtend(side),
      violationIsFoul: cfg.violationIsFoul,
    };
  }

  function destroy() {
    stopTimer();
    running = false;
  }

  return {
    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    togglePause: togglePause,
    extend: function () {
      return startExtension(false);
    },
    canExtend: canExtend,
    resetRack: resetRack,
    state: state,
    remainSec: remainSec,
    destroy: destroy,
    config: cfg,
  };
}
