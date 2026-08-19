/**
 * chessclock.js — チェスクロック（持ち時間制）
 *
 * ショットクロック（1ショットごとの制限）とは別の仕組み。
 * 各プレーヤーに試合全体の持ち時間を与え、自分の番の間だけ減っていく。
 * 使い切ったら時間切れ負け。将棋・チェスと同じ方式。
 *
 * 残り時間は Date.now() の差分で計算する
 * （setInterval の累積誤差や、スマホのバックグラウンド化の影響を受けないため）。
 */

function createChessClock(config, callbacks) {
  const cfg = Object.assign(
    {
      enabled: false,
      minutes: 30, // 1人あたりの持ち時間（分）
      warnAtSec: 60, // 残りN秒で警告
      byoyomiSec: 0, // 秒読み（0なら無し）。使い切っても1手ごとにこの秒数だけ使える
      timeoutLoses: true, // 使い切ったら負けにするか
    },
    config || {}
  );
  const cb = callbacks || {};

  const totalMs = cfg.minutes * 60 * 1000;
  const remain = { A: totalMs, B: totalMs };
  const inByoyomi = { A: false, B: false };
  let byoyomiDeadline = 0;

  let side = null; // いま計測している側
  let running = false;
  let paused = false;
  let startedAt = 0; // このターンの計測開始時刻
  let turnStartRemain = 0; // このターン開始時点の残り
  let timerId = null;
  let warned = { A: false, B: false };
  let expired = null;

  function now() {
    return Date.now();
  }

  /** 現在の残り時間（ms） */
  function remainMs(forSide) {
    const s = forSide || side;
    if (!s) return totalMs;
    if (s !== side || !running || paused) return remain[s];
    return Math.max(0, turnStartRemain - (now() - startedAt));
  }

  function remainSec(forSide) {
    return Math.ceil(remainMs(forSide) / 1000);
  }

  /** 秒読み中の残り秒 */
  function byoyomiRemainSec() {
    if (!side || !inByoyomi[side] || !running || paused) return cfg.byoyomiSec;
    return Math.max(0, Math.ceil((byoyomiDeadline - now()) / 1000));
  }

  function tick() {
    if (!running || paused || !side) return;

    if (inByoyomi[side]) {
      if (byoyomiRemainSec() <= 0) {
        expire(side);
        return;
      }
      if (cb.onTick) cb.onTick(state());
      return;
    }

    const left = remainMs(side);
    if (left <= 0) {
      remain[side] = 0;
      if (cfg.byoyomiSec > 0) {
        // 持ち時間を使い切ったら秒読みに入る
        inByoyomi[side] = true;
        byoyomiDeadline = now() + cfg.byoyomiSec * 1000;
        if (cb.onByoyomi) cb.onByoyomi(side);
        if (cb.onTick) cb.onTick(state());
        return;
      }
      expire(side);
      return;
    }

    if (!warned[side] && left <= cfg.warnAtSec * 1000) {
      warned[side] = true;
      if (cb.onWarn) cb.onWarn(side, Math.ceil(left / 1000));
    }
    if (cb.onTick) cb.onTick(state());
  }

  function expire(s) {
    running = false;
    expired = s;
    stopTimer();
    if (cb.onExpire) cb.onExpire(s);
    if (cb.onTick) cb.onTick(state());
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(tick, 200);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /** その側の計測を始める（ターンが回ってきたとき） */
  function start(forSide) {
    if (!cfg.enabled || expired) return;
    // 別の側が動いていたら、その分を確定させる
    if (side && side !== forSide && running) commit();
    side = forSide;
    turnStartRemain = remain[forSide];
    startedAt = now();
    paused = false;
    running = true;
    if (inByoyomi[forSide]) byoyomiDeadline = now() + cfg.byoyomiSec * 1000;
    startTimer();
    tick();
  }

  /**
   * いまのターンの消費を確定して止める。
   * @returns {number} このターンで使った秒数
   */
  function commit() {
    if (!side || !running) return 0;
    const used = inByoyomi[side] ? 0 : turnStartRemain - remainMs(side);
    remain[side] = inByoyomi[side] ? 0 : Math.max(0, remainMs(side));
    running = false;
    stopTimer();
    return Math.round(used / 1000);
  }

  /**
   * ターンを相手に渡す。
   * @returns {{side:string, usedSec:number}} 渡した側と、その人が使った秒数
   */
  function switchTurn() {
    const from = side;
    const usedSec = commit();
    const to = from === "A" ? "B" : "A";
    start(to);
    return { side: from, usedSec: usedSec };
  }

  function pause() {
    if (!running || paused) return;
    commit();
    paused = true;
    if (cb.onTick) cb.onTick(state());
  }

  function resume() {
    if (!side || expired) return;
    paused = false;
    start(side);
  }

  function togglePause() {
    if (paused || !running) resume();
    else pause();
  }

  function stop() {
    commit();
    running = false;
    paused = false;
    stopTimer();
    if (cb.onTick) cb.onTick(state());
  }

  function state() {
    return {
      enabled: cfg.enabled,
      running: running,
      paused: paused,
      side: side,
      expired: expired,
      remainSec: { A: remainSec("A"), B: remainSec("B") },
      inByoyomi: { A: inByoyomi.A, B: inByoyomi.B },
      byoyomiSec: cfg.byoyomiSec,
      byoyomiRemainSec: byoyomiRemainSec(),
      warnAtSec: cfg.warnAtSec,
      totalSec: cfg.minutes * 60,
      timeoutLoses: cfg.timeoutLoses,
    };
  }

  function destroy() {
    stopTimer();
    running = false;
  }

  /** mm:ss 形式に整える */
  function fmt(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }

  return {
    start: start,
    stop: stop,
    commit: commit,
    switchTurn: switchTurn,
    pause: pause,
    resume: resume,
    togglePause: togglePause,
    remainSec: remainSec,
    state: state,
    destroy: destroy,
    fmt: fmt,
    config: cfg,
  };
}
