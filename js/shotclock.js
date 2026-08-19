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
 * 残り時間は Date.now() との差分で計算する（setIntervalの累積誤差や
 * バックグラウンド化によるタイマー間引きの影響を受けないため）。
 */

function createShotClock(config, callbacks) {
  const cfg = Object.assign(
    {
      enabled: false,
      seconds: 45,
      warnAtSec: 15,
      extension: { countPerSide: 2, seconds: 45, mode: "declare" },
      violationIsFoul: true,
    },
    config || {}
  );
  const cb = callbacks || {};

  let running = false;
  let paused = false;
  let deadline = 0; // 期限（epoch ms）
  let remainAtPause = 0;
  let side = null;
  let inExtension = false;
  let violated = false;
  const usedExtensions = { A: 0, B: 0 };
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

  function canExtend(forSide) {
    const s = forSide || side;
    if (!s) return false;
    return usedExtensions[s] < cfg.extension.countPerSide;
  }

  /**
   * エクステンションを使う。
   * @param {boolean} isAuto オートエクステンションによる自動発動か
   */
  function startExtension(isAuto) {
    if (!running || !canExtend(side)) return false;
    usedExtensions[side]++;
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
      extensionsLeft: {
        A: cfg.extension.countPerSide - usedExtensions.A,
        B: cfg.extension.countPerSide - usedExtensions.B,
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
    state: state,
    remainSec: remainSec,
    destroy: destroy,
    config: cfg,
  };
}
