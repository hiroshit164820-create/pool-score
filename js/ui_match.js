/**
 * ui_match.js — 試合中の画面（Phase 1.0: ラック単位モード）
 *
 * 操作原則:
 *   - 確認ダイアログを出さない。即時反映し、取り消しで戻す
 *   - 主要ボタンは画面下部（親指到達域）
 *   - 種目ごとのボタン出し分けは BASE_RULES のフラグから自動生成する
 */

const MATCH = (function () {
  const $ = UI.$;

  let match = null;
  let clock = null; // ショットクロック
  let chess = null; // チェスクロック
  let wakeLock = null;
  // 次のラック勝者と一緒に記録する補助フラグ
  let flags = { masuwari: false, breakAce: false };
  // ダブルスで、いまチームの何人目が撞いているか（{A:0|1, B:0|1}）。
  // 得点計算には使わない。時計のリセットと「次は誰か」の表示のためだけに持つ
  let memberTurn = { A: 0, B: 0 };

  /* ---------- 起動・終了 ---------- */

  function open(m) {
    match = m;
    flags = { masuwari: false, breakAce: false };
    setupShotClock();
    setupChessClock();
    bindOnce();
    render();
    UI.showScreen("screenMatch");
    requestWakeLock();
    // 未決着なら計測を開始する（規程第5章第5条第2項a: 全球停止＝記録操作の時点）
    if (!reduceMatch(match).winner) {
      startClockForCurrentTurn();
      startChessForCurrentTurn();
    }
  }

  function close() {
    if (clock) {
      clock.destroy();
      clock = null;
    }
    if (chess) {
      chess.destroy();
      chess = null;
    }
    releaseWakeLock();
    match = null;
  }

  let bound = false;
  function bindOnce() {
    if (bound) return;
    bound = true;

    // 画面の向きや高さが変わったら数字の大きさを取り直す
    // （横向きにすると使える高さが変わり、そのままだと数字が切れる）
    window.addEventListener("resize", function () {
      if (match) fitScoreFont();
    });

    // スコア欄そのものがボタン。タップで1点（1ラック）加算し、
    // 長押しで1点戻す（本人の指示。加算と同じ場所で減算までできるようにする）
    ["A", "B"].forEach(function (sd) {
      bindPanelPress($("panel" + sd), sd);
    });
    $("undoBtn").addEventListener("click", UI.guard(onUndo));
    $("reviseBtn").addEventListener("click", UI.guard(openRevise));
    $("finishBtn").addEventListener("click", UI.guard(openFinish));
    $("breakToggleBtn").addEventListener("click", UI.guard(toggleBreakSide));
    $("quitMatchBtn").addEventListener("click", UI.guard(function () {
      save();
      close();
      // 中断したら設定画面に戻す。いちばん上に「続きから再開する」が出る
      UI.showScreen("screenSetup");
      window.dispatchEvent(new Event("pool-score:refresh-resume"));
      UI.toast("中断しました。上の「続きから再開する」からいつでも戻れます。");
    }));

    $("scPauseBtn").addEventListener("click", UI.guard(function () {
      if (!clock) return;
      clock.togglePause();
      renderShotClock();
    }));
    $("scExtBtn").addEventListener("click", UI.guard(function () {
      if (!clock) return;
      if (!clock.extend()) UI.toast("延長はもう使えません。", "warn");
      renderShotClock();
    }));

    $("turnBtn").addEventListener("click", UI.guard(onTurnChange));
    $("memberTurnBtn").addEventListener("click", UI.guard(onMemberTurnChange));
    $("ccPauseBtn").addEventListener("click", UI.guard(function () {
      if (!chess) return;
      chess.togglePause();
      renderChessClock();
    }));

    $("closeReviseBtn").addEventListener("click", function () { $("reviseModal").hidden = true; });
    $("cancelFinishBtn").addEventListener("click", function () { $("finishModal").hidden = true; });
    $("confirmFinishBtn").addEventListener("click", UI.guard(confirmFinish));
  }

  /* ---------- ショットクロック ---------- */

  function setupShotClock() {
    if (clock) clock.destroy();
    const cfg = (match.options && match.options.shotClock) || { enabled: false };
    if (!cfg.enabled) {
      clock = null;
      $("shotClockBar").classList.add("hidden");
      return;
    }
    clock = createShotClock(cfg, {
      onTick: function () { renderShotClock(); },
      onWarn: function (side, sec) {
        vibrate([80, 60, 80]);
        UI.toast("残り " + sec + " 秒", "warn");
      },
      onViolation: function (side) {
        vibrate([200, 80, 200]);
        // 規程第5章第5条第2項: 時間内にショットできなければファウル
        appendEvent(match, { t: "SHOT_CLOCK", side: side, d: { event: "violation" } });
        if (cfg.violationIsFoul) {
          appendEvent(match, { t: "FOUL", side: side, d: { kind: "normal", warned: false } });
        }
        save();
        UI.toast("時間切れです。ファウルとして記録しました。", "danger");
        render();
      },
      onExtension: function (side, n, isAuto) {
        appendEvent(match, { t: "SHOT_CLOCK", side: side, d: { event: "extension", auto: !!isAuto } });
        save();
        UI.toast(isAuto ? "自動で延長しました（" + n + "回目）" : "延長しました（" + n + "回目）");
      },
    });
    $("shotClockBar").classList.remove("hidden");
  }

  /* ---------- チェスクロック ---------- */

  function setupChessClock() {
    if (chess) chess.destroy();
    const cfg = (match.options && match.options.chessClock) || { enabled: false };
    if (!cfg.enabled) {
      chess = null;
      $("chessClockBar").classList.add("hidden");
      return;
    }
    chess = createChessClock(cfg, {
      onTick: function () { renderChessClock(); },
      onWarn: function (side, sec) {
        vibrate([80, 60, 80]);
        UI.toast(sideName(side) + " の残り時間 " + sec + "秒", "warn");
      },
      onByoyomi: function (side) {
        vibrate([120, 60, 120]);
        UI.toast(sideName(side) + " は秒読みに入りました。", "warn");
      },
      onExpire: function (side) {
        vibrate([200, 80, 200, 80, 200]);
        appendEvent(match, { t: "SHOT_CLOCK", side: side, d: { event: "chessTimeout" } });
        if (cfg.timeoutLoses) {
          // 時間切れ負け。相手の勝ちとして確定させる
          appendEvent(match, {
            t: "MATCH_END",
            side: null,
            d: { winner: side === "A" ? "B" : "A", by: "time", hasUnresolvedError: false },
          });
          save();
          render();
          UI.toast(sideName(side) + " の時間切れです。" + sideName(side === "A" ? "B" : "A") + " の勝ちになります。", "danger");
          openFinish();
        } else {
          save();
          render();
          UI.toast(sideName(side) + " の持ち時間がなくなりました。", "danger");
        }
      },
    });
    $("chessClockBar").classList.remove("hidden");
  }

  function renderChessClock() {
    if (!chess) return;
    const s = chess.state();
    ["A", "B"].forEach(function (side) {
      $("ccName" + side).textContent = sideName(side);
      const inByo = s.inByoyomi[side];
      $("ccTime" + side).textContent = inByo
        ? "秒読み " + (s.side === side ? s.byoyomiRemainSec : s.byoyomiSec)
        : chess.fmt(s.remainSec[side]);
      const node = $("ccSide" + side);
      node.classList.toggle("active", s.side === side && s.running && !s.paused);
      node.classList.toggle("warn", !inByo && s.remainSec[side] <= s.warnAtSec);
      node.classList.toggle("byoyomi", !!inByo);
      node.classList.toggle("expired", s.expired === side);
    });
    $("ccPauseBtn").textContent = s.paused || !s.running ? "再開" : "一時停止";
    $("ccPauseBtn").disabled = !!s.expired;
  }

  /** いまターンを持っている側のチェスクロックを動かす */
  function startChessForCurrentTurn() {
    if (!chess) return;
    const st = reduceMatch(match);
    chess.start(st.turn || st.breakSide || "A");
    renderChessClock();
  }

  /** ターン交代（チェスクロックの切替と、イニング計算の土台になる） */
  /**
   * ダブルスのチーム内交代。
   *
   * 相手には回さず、同じチームの相方に代わる。
   * 交代したのに時計が動き続けると、いつまでも前の人の時間で測られるため
   * ショットクロックを撞き直しの状態に戻す（本人指摘）。
   */
  /**
   * スコア欄の押し分け。
   *
   * 短く押す = 1点加算 / 長く押す（500ms）= 1点戻す。
   * 減算を別のボタンにすると、台の脇で押し間違えるうえに場所も取るため
   * 同じ場所に集約する。長押しの瞬間に振動で知らせて、
   * 指を離す前に「戻る側だ」と分かるようにする。
   */
  const LONG_PRESS_MS = 500;
  function bindPanelPress(node, side) {
    if (!node) return;
    let timer = null;
    let fired = false;

    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    function start() {
      if (node.disabled) return;
      fired = false;
      clear();
      timer = setTimeout(function () {
        fired = true;
        vibrate([60, 40, 60]);
        decrementSide(side);
      }, LONG_PRESS_MS);
    }
    function end(e) {
      clear();
      // fired はここで落とさない。
      // このあとに来る click を無視するために残す必要がある
      if (fired && e) { e.preventDefault(); }
    }

    node.addEventListener("pointerdown", start);
    node.addEventListener("pointerup", end);
    node.addEventListener("pointerleave", function () { clear(); fired = false; });
    node.addEventListener("pointercancel", function () { clear(); fired = false; });
    // click は「長押しでなかったとき」だけ加算する。
    // 長押しで減算した直後の click は捨てる（でないと減らして足すので変わらない）
    node.addEventListener("click", UI.guard(function () {
      if (fired) { fired = false; return; }
      recordRackWin(side);
    }));
    // 長押しでテキスト選択メニューが出ないようにする
    node.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function onMemberTurnChange() {
    const st = reduceMatch(match);
    if (st.winner) return;
    const side = st.turn || st.breakSide || st.firstSide;
    const members = membersOf(side);
    if (members.length < 2) return;

    memberTurn[side] = memberTurn[side] === 0 ? 1 : 0;
    // 時計を撞き直しに戻す（相手には回さないので TURN_END は出さない）
    if (clock) startClockForCurrentTurn();
    render();
    vibrate(30);
    UI.toast(members[memberTurn[side]] + " に交代しました。");
  }

  /** その側のメンバー名（ダブルスのみ。シングルスは空） */
  function membersOf(side) {
    const sd = match && match.sides[side === "A" ? 0 : 1];
    return (sd && sd.members) || [];
  }

  function onTurnChange() {
    const st = reduceMatch(match);
    if (st.winner) return;

    const from = st.turn;
    let usedSec = null;
    if (chess) {
      const r = chess.switchTurn();
      usedSec = r.usedSec;
    }
    const d = { reason: "miss" };
    if (usedSec !== null) d.usedSec = usedSec;
    appendEvent(match, { t: "TURN_END", side: from, d: d });

    // 相手に回ったら、そのチームは1人目から撞き始める
    const to = from === "A" ? "B" : "A";
    memberTurn[to] = 0;

    save();
    render();
    vibrate(30);

    // 交代したことをはっきり伝える。
    // 押しても画面がほとんど変わらないと「効いていない」と思われる
    const now = reduceMatch(match);
    UI.toast(sideName(now.turn) + " の番です");
    const tb = $("turnBanner");
    if (tb) {
      tb.classList.remove("swapped");
      void tb.offsetWidth;
      tb.classList.add("swapped");
    }

    if (clock) startClockForCurrentTurn();
  }

  function startClockForCurrentTurn() {
    if (!clock) return;
    const st = reduceMatch(match);
    // 直前のショットにかかった時間を記録する（平均タイムの算出に使う）
    const prev = clock.state();
    if (prev.running && prev.side) {
      const used = prev.totalSec - prev.remainSec;
      if (used > 0) {
        appendEvent(match, {
          t: "SHOT_CLOCK",
          side: prev.side,
          d: { event: "shot", usedSec: used },
        });
      }
    }
    clock.start(st.turn || st.breakSide || "A");
    renderShotClock();
  }

  function renderShotClock() {
    if (!clock) return;
    const bar = $("shotClockBar");
    const s = clock.state();
    const sec = s.running ? s.remainSec : s.totalSec;
    $("scTime").textContent = String(sec);

    bar.classList.toggle("warn", s.running && !s.violated && sec <= s.warnAtSec);
    bar.classList.toggle("over", s.violated);

    // 撞いている人の名前はスコアボードに大きく出ているので、ここでは繰り返さない。
    // 狭い画面でも省略されないよう、状態と延長の残り回数だけを出す。
    const info = [];
    if (s.violated) info.push("時間切れ");
    else if (!s.running) info.push("停止中");
    else if (s.paused) info.push("一時停止");
    else if (s.inExtension) info.push("延長中");
    if (s.side && !s.violated) {
      info.push(
        "延長あと" + s.extensionsLeft[s.side] + "回" +
          (s.extensionScope === "rack" ? "（このラック）" : "")
      );
    }
    $("scInfo").textContent = info.join(" ・ ");

    $("scPauseBtn").textContent = s.paused ? "再開" : "一時停止";
    $("scPauseBtn").disabled = !s.running;
    $("scExtBtn").disabled = !s.running || !s.canExtend;
  }

  /** 押した側のパネルを一瞬だけ拡大して、加算されたことを伝える */
  function bump(side) {
    const node = $("panel" + side);
    if (!node) return;
    node.classList.remove("bump");
    void node.offsetWidth; // アニメーションを再生し直すため
    node.classList.add("bump");
    vibrate(30);
  }

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* 非対応環境は無視 */
    }
  }

  /* ---------- 画面スリープ抑止 ---------- */

  function requestWakeLock() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request("screen").then(
          function (lock) { wakeLock = lock; },
          function () { /* 非対応・拒否は無視 */ }
        );
      }
    } catch (e) { /* 無視 */ }
  }

  function releaseWakeLock() {
    try {
      if (wakeLock && wakeLock.release) wakeLock.release();
    } catch (e) { /* 無視 */ }
    wakeLock = null;
  }

  /* ---------- 記録 ---------- */

  function save() {
    if (match) STORE.saveMatch(match);
  }

  /**
   * ラックを取ったことを記録する。
   *
   * opts.instantFlag に "masuwari" / "breakAce" を渡すと、
   * その項目を付けたうえでラック取得を記録する（ボタンを押した時点で確定させる）。
   */
  function recordRackWin(side, opts) {
    const st = reduceMatch(match);
    if (st.winner) {
      UI.toast("この試合はもう終わっています。", "warn");
      return;
    }

    const instant = (opts && opts.instantFlag) || null;
    const r = resolveGame(match.gameId);

    // 球1個=1点の種目（14-1）は、タップ1回を「1個ポケットした」として記録する。
    // ラック単位の種目とは記録するイベントが違う。
    if (isPerBallInput(r)) {
      recordOneBall(side, r);
      return;
    }

    appendEvent(match, {
      t: "RACK_WIN",
      side: side,
      d: {
        winner: side,
        // 予約されているぶんに加え、押して即記録したぶんも立てる
        masuwari: (flags.masuwari || instant === "masuwari") && r.base.hasMasuwari,
        breakAce: (flags.breakAce || instant === "breakAce") && r.base.hasBreakAce,
      },
    });

    const after = reduceMatch(match);
    const prevBreak = st.breakSide || st.firstSide;
    let nextBreak = null;
    let bt = null;
    if (!after.winner) {
      // 次のラックを開始する（ブレイク権は方式に従って自動決定）
      bt = (match.options && match.options.breakType) || r.base.defaultBreakType;
      nextBreak = nextBreakSide(bt, prevBreak, side);
      appendEvent(match, {
        t: "RACK_START",
        side: null,
        d: { rackNo: after.rackNo + 1, breakSide: nextBreak, auto: true },
      });
    }

    flags = { masuwari: false, breakAce: false };
    save();
    render();
    bump(side);

    const final = reduceMatch(match);
    if (final.winner) {
      vibrate([120, 60, 120, 60, 200]);
      openFinish();
    } else {
      // 次のラックに移ったこと、ブレイク権がどうなったかを知らせる。
      // オルタネートでは自動で入れ替わるので、黙って変わると混乱する
      announceNextRack(final.rackNo, prevBreak, nextBreak, bt);
      if (clock) {
        // ラックが変わったのでエクステンション回数を戻す（既定は1ラック1回）
        clock.resetRack();
        startClockForCurrentTurn();
      }
    }
  }

  /**
   * 次のラックへ移ったことを画面で知らせる。
   *
   * ブレイク権が入れ替わった場合はそれも一緒に伝える。
   * オルタネートブレイクは自動で交代するため、黙って変わると
   * 誰がブレイクするのか分からなくなる。
   */
  function announceNextRack(rackNo, prevBreak, nextBreak, breakType) {
    const parts = ["ラック " + rackNo + " へ"];
    if (nextBreak) {
      if (nextBreak !== prevBreak) {
        parts.push("ブレイクは " + sideName(nextBreak) + " に交代");
      } else {
        parts.push(sideName(nextBreak) + " が続けてブレイク");
      }
    }
    UI.toast(parts.join(" ／ "));

    // バナーを一瞬光らせて、ブレイク権が変わったことを目でも分かるようにする
    if (nextBreak && nextBreak !== prevBreak) {
      const banner = $("breakBanner");
      if (banner) {
        banner.classList.remove("swapped");
        void banner.offsetWidth; // アニメーションを再生し直す
        banner.classList.add("swapped");
      }
      vibrate([40, 50, 40]);
    }
  }

  /**
   * 球1個ぶんの得点を記録する（14-1）。
   * ballsPerRack 個たまったら、ブレイクボールを残してラックを組み直す（規程第13章第1条第3項）。
   */
  function recordOneBall(side, r) {
    const before = reduceMatch(match);
    const ball = pickBallToPocket(side, before);
    if (ball === null) {
      UI.toast("この人が得点できる球が盤面に残っていません。", "warn");
      return;
    }
    appendEvent(match, { t: "POCKET", side: side, d: { balls: [ball], onBreak: false } });

    const after = reduceMatch(match);
    const perRack = r.base.ballsPerRack;
    if (perRack && after.onTable.length <= r.base.balls.length - perRack) {
      // 14個入れたので次のラックへ（ブレイクボール1個は残ったまま）
      appendEvent(match, {
        t: "RACK_START",
        side: null,
        d: { rackNo: after.rackNo + 1, breakSide: side, auto: true, continuation: true },
      });
      UI.toast("14個入りました。ラックを組み直してください。");
    } else if (r.base.keyBall && ball === r.base.keyBall && !after.winner) {
      // キーボール（9番など）が入った＝そのラックは終わり。
      // ボールハンデで球単位に数えている場合、ここで区切らないと
      // 盤面が空のままになり次のラックに進めない。
      // ブレイク権は種目の方式に従って決める
      const bt = (match.options && match.options.breakType) || r.base.defaultBreakType;
      const nextBreak = nextBreakSide(bt, before.breakSide || before.firstSide, side);
      appendEvent(match, {
        t: "RACK_START",
        side: null,
        d: { rackNo: after.rackNo + 1, breakSide: nextBreak, auto: true },
      });
      UI.toast(r.base.keyBall + "番が入りました。次のラックです。");
    }

    save();
    render();
    bump(side);

    if (reduceMatch(match).winner) {
      vibrate([120, 60, 120, 60, 200]);
      openFinish();
    } else if (clock) {
      if (after.rackNo !== before.rackNo) clock.resetRack();
      startClockForCurrentTurn();
    }
  }

  /**
   * タップ1回で「どの球を入れたことにするか」を決める。
   *
   * 番号を1つずつ選ばせると台の脇での操作が重くなるため、こちらで選ぶ。
   * ボールハンデがある場合は、その人にとって得点になる球のうち
   * 一番若い番号を消費する。ハンデが無ければ盤面の最若番。
   *
   * 得点になる球が残っていなければ null を返す（呼び出し側で知らせる）。
   */
  function pickBallToPocket(side, st) {
    const onTable = st.onTable || [];
    if (!onTable.length) return null;

    const bh = match.goal.ballHandicap && match.goal.ballHandicap[side];
    if (bh && bh.scoringBalls && bh.scoringBalls.length) {
      const allowed = {};
      bh.scoringBalls.forEach(function (b) { allowed[b] = true; });
      const hit = onTable.filter(function (b) { return allowed[b]; });
      return hit.length ? hit[0] : null;
    }
    return onTable[0];
  }

  /** ファウルを記録する（14-1は減点があるため専用ボタンを出す） */
  function recordFoul(side) {
    const st = reduceMatch(match);
    if (st.winner) return;
    appendEvent(match, { t: "FOUL", side: side, d: { kind: "normal", warned: false } });
    save();
    render();
    const after = reduceMatch(match);
    const diff = after.score[side] - st.score[side];
    UI.toast(
      diff < 0
        ? sideName(side) + " のファウル（" + diff + "点）"
        : sideName(side) + " のファウルを記録しました。",
      "warn"
    );
  }

  /**
   * その側の得点を1つ戻す（長押しで呼ばれる）。
   *
   * 「直前の記録」ではなく「その側の直近の得点」を消すので、
   * 相手が先に点を入れていても、押した側の点だけが減る。
   */
  function decrementSide(side) {
    const st = reduceMatch(match);
    if (st.winner) {
      UI.toast("この試合はもう終わっています。", "warn");
      return;
    }

    // その側の得点になっている記録を新しい順に探す
    const evs = match.events || [];
    let target = null;
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i];
      if (e.voided || e.t === "VOID") continue;
      const isScore = (e.t === "RACK_WIN" && ((e.d && e.d.winner) || e.side) === side)
        || (e.t === "POCKET" && e.side === side);
      if (isScore) { target = e; break; }
    }
    if (!target) {
      UI.toast(sideName(side) + " に戻せる得点がありません。", "warn");
      return;
    }

    voidEvent(match, target.seq, "長押しで1点戻す", new Date());
    // ラック取得を消したときは、それに続いて自動で始まったラックも戻す
    if (target.t === "RACK_WIN") {
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i];
        if (e.voided || e.t === "VOID") continue;
        if (e.t === "RACK_START" && e.d && e.d.auto && e.seq > target.seq) {
          voidEvent(match, e.seq, "得点を戻したことに伴う自動取り消し", new Date());
        }
      }
    }
    save();
    render();
    vibrate([40, 40, 40]);
    UI.toast(sideName(side) + " の得点を1つ戻しました。");
  }

  function onUndo() {
    const ev = undoLast(match, new Date());
    if (!ev) {
      UI.toast("取り消せる記録がありません。", "warn");
      return;
    }
    // 自動発行された RACK_START も一緒に取り消す
    const evs = match.events;
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i];
      if (e.voided || e.t === "VOID") continue;
      if (e.t === "RACK_START" && e.d && e.d.auto) {
        voidEvent(match, e.seq, "undoに伴う自動取り消し", new Date());
      }
      break;
    }
    save();
    render();
    UI.toast("直前の記録を取り消しました。");
  }

  function toggleBreakSide() {
    const st = reduceMatch(match);
    if (st.winner) return;
    const cur = st.breakSide || st.firstSide;
    const next = cur === "A" ? "B" : "A";
    appendEvent(match, {
      t: "RACK_START",
      side: null,
      d: { rackNo: st.rackNo, breakSide: next, manual: true },
    });
    save();
    render();
    UI.toast("ブレイクを " + sideName(next) + " に変えました。");
  }

  /* ---------- 描画 ---------- */

  /**
   * スコアの数字を、パネルに収まる大きさに合わせる。
   *
   * CSSの vh だけでは決められない。名前・メンバー名・ハンデ・進捗バーが
   * 乗るぶんだけ数字に使える高さが変わり、はみ出すと上下が切れるため
   * （実機のスクショで数字が半分になっていたのがこれ）。
   * 実際に測ってから決める。
   */
  function fitScoreFont() {
    // 左右で別々に決めると、マスワリのボタンが付く側だけ数字が小さくなり
    // 「同じスコアなのに大きさが違う」状態になる。
    // 両方を測ってから、小さい方に揃える
    const sizes = {};
    ["A", "B"].forEach(function (side) {
      const panel = $("panel" + side);
      const row = panel && panel.querySelector(".val-row");
      const val = $("score" + side);
      const box = panel && panel.getBoundingClientRect();
      // 高さが取れないとき（画面が閉じている等）は計算しない
      if (!panel || !row || !val || !box || box.height < 20) return;

      // パネルの内側で、数字以外が使っている高さを引く
      const cs = getComputedStyle(panel);
      const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      let used = 0;
      Array.prototype.forEach.call(panel.children, function (k) {
        if (k === row || k.hidden) return;
        used += k.getBoundingClientRect().height;
      });
      const gap = parseFloat(cs.rowGap || cs.gap) || 0;
      const slots = Math.max(0, panel.children.length - 1);
      const avail = box.height - padding - used - gap * slots;

      // 幅の制約も見る（3桁になっても収まるように）
      const byWidth = box.width * 0.42;
      // 0.9 は行の高さぶんの余裕。これを超えると上下が切れる。
      // 下限は台の脇から読める大きさ（32px）。
      // それも入らないほど狭いときは、パネル側の作りを見直すべきで
      // ここで無理に縮めても読めない
      sizes[side] = Math.max(40, Math.min(avail * 0.9, byWidth, 96));
    });

    // 両側が見えているときは小さい方に揃える（片方だけ大きいと不揃いに見える）
    const vals = Object.keys(sizes).map(function (k) { return sizes[k]; });
    if (!vals.length) return;
    const unified = Math.min.apply(null, vals);
    Object.keys(sizes).forEach(function (side) {
      const panel = $("panel" + side);
      if (panel) panel.style.setProperty("--val-size", Math.floor(unified) + "px");
    });
  }

  function sideName(side) {
    if (!match) return side;
    return side === "A" ? match.sides[0].name : match.sides[1].name;
  }

  /**
   * 球の番号によって点数が変わる種目か（ローテーション）。
   * この種目は「どの球を入れたか」を記録しないと点数が出せないため、
   * スコアのタップではなく盤面のボタンで入力する。
   */
  function usesBallGrid(r) {
    return !!(r.scoring.scoreOf && r.scoring.kind === "ballScore" && !r.base.keyBall
      && r.base.rackTotal);
  }

  /**
   * タップ1回が「球1個」か「ラック1つ」かを返す。
   *
   * engine.js の effectiveScoreKind と同じ規則で判断する。
   * ボールハンデを付けると goal.type が "score" になり、
   * ラック集計の種目でもボール単位の加点に切り替わるため、
   * ここで種目のフラグだけを見ていると記録の粒度がずれる。
   */
  function isPerBallInput(r) {
    return effectiveScoreKind(r.scoring, match.goal) === "ballScore";
  }

  /**
   * 画面に出すスコアを返す。
   *
   * ボウラードはストライク／スペアのボーナスがあるため、
   * 落球数の合計（st.score）ではなくボウリング式の集計を出す。
   */
  function displayScore(st) {
    const r = resolveGame(match.gameId);
    if (r.scoring.kind === "bowling") {
      const bsc = buildBowlardScore(SHEET.bowlardThrows(match), {
        frames: r.scoring.frames, pinsPerFrame: r.scoring.pinsPerFrame,
      });
      return { A: bsc.total, B: 0 };
    }
    return match.goal.type === "racks" ? st.racks : st.score;
  }

  /** どちらかにボールハンデが設定されているか */
  function hasAnyHandicap() {
    const bh = match && match.goal && match.goal.ballHandicap;
    if (!bh) return false;
    return !!(bh.A || bh.B);
  }

  /** 決着済みかどうか（ブレイク表示の出し分けに使う） */
  function finishedFlag(st) {
    return !!st.winner;
  }

  function render() {
    if (!match) return;
    const g = GAMES[match.gameId];
    const r = resolveGame(match.gameId);
    const st = reduceMatch(match);

    $("matchTitle").textContent = g.label;

    const unit = match.goal.type === "racks" ? "ラック" : "点";
    const bt = (match.options && match.options.breakType) || r.base.defaultBreakType;
    const btLabel = { winner: "ウィナーズブレイク", alternate: "オルタネートブレイク", continuation: "連続ブレイク" }[bt] || bt;
    const btShort = { winner: "ウィナーズ", alternate: "オルタネート", continuation: "連続" }[bt] || bt;
    const parts = [match.goal.targets.A + " 対 " + match.goal.targets.B + unit];
    if (!r.base.breakTypeFixed) parts.push(btShort);
    if (match.goal.targets.A !== match.goal.targets.B) parts.push("ハンデ戦");
    if (hasAnyHandicap()) parts.push("ボールハンデ");
    $("matchSubtitle").textContent = parts.join(" ・ ");

    const cur = displayScore(st);
    ["A", "B"].forEach(function (side) {
      // ダブルスは「チームA」を主役にして、下に2人の名前を小さく出す。
      // 名前を連結しただけだと、どちらのチームなのかが読み取りにくい（本人の指示）
      const sd = match.sides[side === "A" ? 0 : 1] || {};
      const members = sd.members || [];
      const isTeam = members.length >= 2;
      $("name" + side).textContent = isTeam
        ? (sd.teamLabel || (side === "A" ? "チームA" : "チームB"))
        : sideName(side);
      const memNode = $("teamMembers" + side);
      if (memNode) {
        if (isTeam) {
          // いま撞いている人が分かるように印を付ける。
          // ダブルスは2人のうちどちらが撞いているかが記録の前提になる
          const curSide = st.turn || st.breakSide || st.firstSide;
          const idx = memberTurn[side];
          memNode.textContent = members
            .map(function (nm, i) {
              return (side === curSide && i === idx) ? "▶ " + nm : nm;
            })
            .join("　");
          memNode.hidden = false;
        } else {
          memNode.hidden = true;
        }
      }
      $("score" + side).textContent = String(cur[side]);
      $("target" + side).textContent = "/ " + match.goal.targets[side];

      // ボールハンデ。試合中ずっと見えていないと、
      // どの球が得点になるのか分からなくなる
      const bh = match.goal.ballHandicap && match.goal.ballHandicap[side];
      const hNode = $("handicap" + side);
      if (bh && bh.from) {
        hNode.textContent = bh.from + "番以上で1点";
        hNode.hidden = false;
      } else if (bh && bh.scoringBalls && bh.scoringBalls.length) {
        // from を持たない古い記録でも表示できるようにする
        hNode.textContent = bh.scoringBalls.join("・") + "番で1点";
        hNode.hidden = false;
      } else if (hasAnyHandicap()) {
        // 片方だけハンデがある場合、もう片方にも基準を出して対比させる
        hNode.textContent = r.base.keyBall + "番のみ1点";
        hNode.hidden = false;
      } else {
        hNode.hidden = true;
      }

      // ダブルスで個人ごとにハンデを決めているときは、誰がどの球かを出す。
      // 「岸川 5番以上／タイラ 9番のみ」のように、台の脇で確認できるようにする
      const mh = match.goal.memberHandicap && match.goal.memberHandicap[side];
      if (mh && mh.length && mh.some(function (m) { return m.from; })) {
        hNode.textContent = mh.map(function (m) {
          return m.name + " " + (m.from ? m.from + "番〜" : r.base.keyBall + "番のみ");
        }).join(" ／ ");
        hNode.hidden = false;
      }
      const pct = Math.min(100, Math.round((cur[side] / match.goal.targets[side]) * 100));
      $("bar" + side).style.width = pct + "%";
      // ブレイク権はパネル自体にも印を付ける（下のバナーと二重に出す）
      const hasBreak = st.breakSide === side;
      $("breakMark" + side).textContent = hasBreak ? "BREAK" : "";
      $("panel" + side).classList.toggle("has-break", hasBreak);
    });

    $("rackInfo").textContent = "ラック " + Math.max(1, st.rackNo);

    // イニング表示。14-1のように交代回数が実力の指標になる種目で出す
    const inningNode = $("inningInfo");
    if (g.showInnings) {
      inningNode.hidden = false;
      // 1イニング目を戦っている間は「1イニング目」と出す
      // （engine は完了した回数を数えるため +1 して表示する）
      inningNode.textContent = (st.innings + 1) + "イニング目";
    } else {
      inningNode.hidden = true;
    }

    // ブレイク権の表示。台の脇から見て一目で分かるよう、名前を大きく出す
    const bs = st.breakSide || st.firstSide;
    $("breakToggleName").textContent = sideName(bs);
    $("breakBannerName").textContent = sideName(bs);
    const banner = $("breakBanner");
    banner.classList.toggle("side-a", bs === "A");
    banner.classList.toggle("side-b", bs === "B");
    banner.hidden = finishedFlag(st);

    // 決着後はタップで加算できないようにする。
    // ローテーションは盤面のボタンで入力するので、スコアのタップは使わない
    const finished = !!st.winner;
    const gridMode = usesBallGrid(r);
    $("panelA").disabled = finished || gridMode;
    $("panelB").disabled = finished || gridMode;
    const perBall = isPerBallInput(r);
    $("tapHint").textContent = finished
      ? "この試合は終了しています。下の「試合終了」から保存してください。"
      : gridMode
      ? "" // 盤面の側に案内を出すのでここは空にする
      : perBall
      ? (hasAnyHandicap()
          ? "得点になる球を入れたら、その人のスコアをタップ／長押しで1点戻す"
          : "球を入れたら、その人のスコアをタップ／長押しで1点戻す")
      : "ラックを取った側のスコアをタップ／長押しで1点戻す";
    $("tapHint").hidden = gridMode && !finished;

    // ターン交代ボタン。
    // 「いま誰の番か」と「押すと誰に渡るか」を別々に出す。
    // ボタンの文言だけだと、それが現在なのか次なのか読み取れない
    const turnBtn = $("turnBtn");
    turnBtn.hidden = finished;
    const curTurn = st.turn || st.breakSide || st.firstSide;
    $("turnNextName").textContent = sideName(curTurn === "A" ? "B" : "A");
    turnBtn.disabled = finished;

    // ダブルスのチーム内交代。撞いている側に2人いるときだけ出す
    const mBtn = $("memberTurnBtn");
    const mems = membersOf(curTurn);
    if (mBtn) {
      const show = !finished && mems.length >= 2;
      mBtn.hidden = !show;
      if (show) {
        const nextIdx = memberTurn[curTurn] === 0 ? 1 : 0;
        $("memberNextName").textContent = mems[nextIdx];
      }
    }

    const turnBanner = $("turnBanner");
    // イニングを数える種目（JPA・14-1）では特に重要なので必ず出す。
    // それ以外でも交代ボタンを使うので出しておく
    turnBanner.hidden = finished;
    $("turnBannerName").textContent = sideName(curTurn);
    turnBanner.classList.toggle("side-a", curTurn === "A");
    turnBanner.classList.toggle("side-b", curTurn === "B");
    // 撞いている側のパネルにも印を付ける
    ["A", "B"].forEach(function (sd) {
      $("panel" + sd).classList.toggle("is-turn", !finished && curTurn === sd);
    });

    // 盤面を使う種目は画面の詰め方を変える（スコアが押し出されないように）
    $("screenMatch").classList.toggle("grid-mode", gridMode);

    // 1人用の種目（ボウラード）は、相手側の欄とブレイク・交代を出さない。
    // 対戦していないので、出ていると何を操作するのか分からなくなる
    const solo = !!g.solo;
    $("screenMatch").classList.toggle("solo-mode", solo);
    if (solo) {
      $("panelWrapB").hidden = true;
      $("breakBanner").hidden = true;
      $("turnBanner").hidden = true;
      $("turnBtn").hidden = true;
      $("breakToggleBtn").hidden = true;
      $("tapHint").hidden = true;
    } else {
      $("panelWrapB").hidden = false;
      $("breakToggleBtn").hidden = false;
    }
    renderBallGrid(r, st);
    renderBowlPad(r, st);
    if (typeof SHEET !== "undefined") SHEET.render(match, st);
    renderFlagButtons(r.base);
    renderShotClock();
    renderChessClock();
    // 帯やボタンの出し入れで使える高さが変わるので、最後に数字を合わせる。
    // このときまだ配置が確定していないことがある（高さが0で返る）ので、
    // 描画が終わったフレームで測る
    fitScoreFont();
    requestAnimationFrame(fitScoreFont);
  }

  /**
   * 盤面（球番号のボタン）を描く。
   *
   * いま撞いている人の得点として記録する。盤面から消えた球は押せない。
   * 全部入ったら次のラックへ自動で進む（ローテーションはラックを跨いで
   * 得点が続くため、ラックは盤面のリセットにすぎない）。
   */
  function renderBallGrid(r, st) {
    const wrap = $("ballGrid");
    if (!usesBallGrid(r)) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    UI.clear(wrap);

    if (st.winner) {
      wrap.appendChild(
        UI.el("p", { class: "hint", text: "この試合は終了しています。" })
      );
      return;
    }

    const shooter = st.turn || st.breakSide || "A";
    wrap.appendChild(
      UI.el("p", {
        class: "bg-who",
        text: sideName(shooter) + " が入れた球を押してください",
      })
    );

    const onTable = {};
    (st.onTable || []).forEach(function (b) { onTable[b] = true; });

    // 実際に使っているボールセットの色で描く。
    // 番号だけの白いボタンより、手元の球と同じ色のほうが押し間違えにくい
    const setId = (match.options && match.options.ballSet) || "standard";

    const grid = UI.el("div", { class: "bg-balls" });
    r.base.balls.forEach(function (b) {
      const left = !!onTable[b];
      const ap = ballAppearance(setId, b);

      // ストライプ球は帯を描く。地と帯の向きはセットによって違う
      // ストライプは中央の帯。実物より細めにして地の色を残す
      // （地が見えないと何番の系統か分からなくなる）
      const style = ap.band
        ? "background: linear-gradient(180deg," + ap.base + " 0 22%," + ap.band
          + " 22% 78%," + ap.base + " 78% 100%); color:" + ap.ink
        : "background:" + ap.base + "; color:" + ap.ink;

      grid.appendChild(
        UI.el("button", {
          type: "button",
          class: "ball-btn" + (left ? "" : " gone"),
          disabled: left ? null : "disabled",
          "data-ball": String(b),
          style: style,
          title: b + "番（" + r.scoring.scoreOf(b) + "点）",
          onclick: UI.guard(function () { recordBall(shooter, b); }),
        }, [
          // 番号は白い丸の中に置く。実物と同じで、色地でも数字が読める
          UI.el("span", { class: "bb-num shape-" + ap.shape, text: String(b) }),
        ])
      );
    });
    wrap.appendChild(grid);
  }

  /**
   * 盤面から1球を記録する（ローテーション）。
   * 球の番号がそのまま得点になる（NBA第11章第1条第3項）。
   */
  function recordBall(side, ball) {
    const before = reduceMatch(match);
    if (before.winner) {
      UI.toast("この試合はもう終わっています。", "warn");
      return;
    }
    const r = resolveGame(match.gameId);

    appendEvent(match, { t: "POCKET", side: side, d: { balls: [ball], onBreak: false } });

    const after = reduceMatch(match);
    // 盤面が空になったら次のラックへ。
    // ローテーションは得点がラックを跨いで続くので、ここは仕切り直しではない
    if (!after.winner && (!after.onTable || !after.onTable.length)) {
      appendEvent(match, {
        t: "RACK_START",
        side: null,
        d: { rackNo: after.rackNo + 1, breakSide: side, auto: true, continuation: true },
      });
      UI.toast("全部入りました。次のラックを組んでください。");
    }

    save();
    render();
    bump(side);
    UI.toast(sideName(side) + " " + ball + "番（+" + r.scoring.scoreOf(ball) + "点）");

    const final = reduceMatch(match);
    if (final.winner) {
      vibrate([120, 60, 120, 60, 200]);
      openFinish();
    } else if (clock) {
      if (after.rackNo !== before.rackNo) clock.resetRack();
      startClockForCurrentTurn();
    }
  }

  /** ボウラードか（1人用・フレーム制） */
  function usesBowlPad(r) {
    return r.scoring.kind === "bowling";
  }

  /**
   * ボウラードの投球入力。
   * 「今の投球で何個入れたか」を押す。残り球数までしか押せない。
   */
  function renderBowlPad(r, st) {
    const wrap = $("bowlPad");
    if (!usesBowlPad(r)) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    UI.clear(wrap);

    if (st.winner) {
      wrap.appendChild(UI.el("p", { class: "hint", text: "全10フレームが終わりました。" }));
      return;
    }

    const cfg = { frames: r.scoring.frames, pinsPerFrame: r.scoring.pinsPerFrame };
    const throws = SHEET.bowlardThrows(match);
    const sc = buildBowlardScore(throws, cfg);
    const left = bowlardRemainingPins(throws, cfg);

    // 何フレームの何投目か
    let frameNo = sc.frames.length;
    for (let i = 0; i < sc.frames.length; i++) {
      if (sc.frames[i].score === null || !sc.frames[i].throws.length) { frameNo = i + 1; break; }
    }
    wrap.appendChild(
      UI.el("p", { class: "bp-who", text: frameNo + "フレーム目：入れた球の数を押してください" })
    );

    const pad = UI.el("div", { class: "bp-nums" });
    for (let n = 0; n <= left; n++) {
      pad.appendChild(
        UI.el("button", {
          type: "button",
          class: "bp-btn" + (n === left && left === cfg.pinsPerFrame ? " strike" : ""),
          "data-pins": String(n),
          text: String(n),
          onclick: UI.guard(function () { recordThrow(n); }),
        })
      );
    }
    wrap.appendChild(pad);
  }

  /**
   * ボウラードの1投を記録する。
   * 入れた球の数だけ POCKET イベントに球を積む（球番号は得点に影響しない）。
   */
  function recordThrow(pins) {
    const before = reduceMatch(match);
    if (before.winner) return;
    const r = resolveGame(match.gameId);
    const cfg = { frames: r.scoring.frames, pinsPerFrame: r.scoring.pinsPerFrame };

    // 入れた球の数を balls の個数で表す（1..pins の番号を使う）
    const balls = [];
    for (let i = 1; i <= pins; i++) balls.push(i);
    appendEvent(match, { t: "POCKET", side: "A", d: { balls: balls, onBreak: false } });

    const throws = SHEET.bowlardThrows(match);
    const sc = buildBowlardScore(throws, cfg);

    // 10フレーム全部が確定したら試合終了
    if (sc.complete) {
      appendEvent(match, {
        t: "MATCH_END",
        side: null,
        d: { winner: "A", by: "goal", hasUnresolvedError: false },
      });
    }

    save();
    render();
    bump("A");
    UI.toast(pins === cfg.pinsPerFrame ? "ストライク！" : pins + "個");

    if (sc.complete) {
      vibrate([120, 60, 120, 60, 200]);
      openFinish();
    }
  }

  /** 補助フラグのボタンを種目に応じて出し分ける */
  function renderFlagButtons(base) {
    const wrap = $("flagButtons");
    UI.clear(wrap);

    // パネル内のボタンも毎回消してから作り直す。
    // ここで消さないと、前の種目のボタンが残る
    // （14-1にマスワリが出ていた不具合）
    ["A", "B"].forEach(function (sd) {
      const host = $("panelFlags" + sd);
      const w = $("panelWrap" + sd);
      if (host) { UI.clear(host); host.hidden = true; }
      if (w) w.classList.remove("has-flags");
    });

    const r = resolveGame(match.gameId);
    // 減点がある種目（14-1）は、ファウルをその場で押せるようにする
    if (r.scoring.foulPenalty) {
      ["A", "B"].forEach(function (side) {
        wrap.appendChild(
          UI.el("button", {
            type: "button",
            text: sideName(side) + " ファウル",
            onclick: UI.guard(function () { recordFoul(side); }),
          })
        );
      });
      wrap.appendChild(
        UI.el("p", {
          class: "hint",
          text: "ファウルは1点減点、3回連続で合計16点減点になります。",
        })
      );
      return;
    }

    const defs = [
      // instant: 押した時点でラック取得まで記録する（予約にしない）
      { key: "masuwari", label: "マスワリ", show: base.hasMasuwari,
        hint: "ブレイクして撞き切った", instant: true },
      { key: "breakAce", label: "ブレイクエース", show: base.hasBreakAce,
        hint: "ブレイクで直接入れた", instant: true },
    ];

    const st = reduceMatch(match);
    const breaker = st.breakSide || st.firstSide;

    // ---- マスワリ・ブレイクエースはブレイク権のある側のパネル内に出す ----
    // どちらの記録になるのかを、置き場所そのもので示す（本人の指示）
    ["A", "B"].forEach(function (sd) {
      const host = $("panelFlags" + sd);
      if (!host) return;
      const instants = defs.filter(function (d) { return d.show && d.instant; });
      // ブレイク権のある側だけに出す。両方に出すと押し間違える
      const wrap = $("panelWrap" + sd);
      if (sd !== breaker || !instants.length || st.winner) {
        host.hidden = true;
        if (wrap) wrap.classList.remove("has-flags");
        return;
      }
      host.hidden = false;
      if (wrap) wrap.classList.add("has-flags");
      instants.forEach(function (d) {
        host.appendChild(
          UI.el("button", {
            type: "button",
            class: "flag-instant",
            title: d.hint,
            text: d.label,
            onclick: UI.guard(function () {
              recordRackWin(sd, { instantFlag: d.key });
            }),
          })
        );
      });
    });

    // ---- セーフティは人ごとの回数カウントにする（本人の指示） ----
    if (base.safetyCallable) {
      wrap.appendChild(UI.el("div", { class: "safety-title", text: "セーフティ" }));
      const row = UI.el("div", { class: "safety-row" });
      ["A", "B"].forEach(function (sd) {
        const n = (st.stats[sd] && st.stats[sd].safety) || 0;
        row.appendChild(
          UI.el("button", {
            type: "button",
            class: "safety-btn side-" + sd.toLowerCase(),
            onclick: UI.guard(function () { recordSafety(sd); }),
          }, [
            UI.el("span", { class: "sf-name", text: sideName(sd) }),
            UI.el("span", { class: "sf-count", text: String(n) }),
          ])
        );
      });
      wrap.appendChild(row);
    }

    if (!wrap.children.length) {
      wrap.appendChild(
        UI.el("p", { class: "hint", text: "この種目では追加で記録する項目はありません。" })
      );
    }
  }

  /**
   * セーフティを1回記録する。
   *
   * ラックの取得とは関係しないので、スコアは動かさない。
   * 誰が打ったかを分けて数えるため、side を明示して記録する。
   */
  function recordSafety(side) {
    const st = reduceMatch(match);
    if (st.winner) {
      UI.toast("この試合はもう終わっています。", "warn");
      return;
    }
    const r = resolveGame(match.gameId);
    if (!r.base.safetyCallable) return;

    appendEvent(match, { t: "SAFETY", side: side, d: { safety: true } });
    save();
    render();
    UI.toast(sideName(side) + " のセーフティを記録しました。");
  }

  /* ---------- 訂正 ---------- */

  function describeEvent(e) {
    const nm = e.side ? sideName(e.side) : "";
    switch (e.t) {
      case "MATCH_START": return "試合開始";
      case "RACK_START":
        return "ラック" + (e.d.rackNo || "") + " 開始（ブレイク: " + sideName(e.d.breakSide) + "）";
      case "RACK_WIN": {
        const tags = [];
        if (e.d.masuwari) tags.push("マスワリ");
        if (e.d.breakAce) tags.push("ブレイクエース");
        if (e.d.safety) tags.push("セーフティ");
        return nm + " がラックを取った" + (tags.length ? "（" + tags.join("・") + "）" : "");
      }
      case "POCKET": return nm + " が " + (e.d.balls || []).join(",") + "番をポケット";
      case "TURN_END": return nm + " のターン終了";
      case "SAFETY": return nm + " のセーフティ";
      case "FOUL": return nm + " のファウル";
      case "TIMEOUT": return nm + " のタイムアウト";
      case "SHOT_CLOCK":
        return nm + " " + (e.d.event === "violation" ? "時間切れ" : "延長を使用");
      case "VOID": return "訂正（" + (e.d.reason || "") + "）";
      case "MATCH_END": return "試合終了";
      default: return e.t;
    }
  }

  function openRevise() {
    const list = $("evList");
    UI.clear(list);
    const evs = match.events.slice().reverse();
    evs.forEach(function (e) {
      if (e.t === "VOID" || e.t === "MATCH_START") return;
      const row = UI.el("div", { class: "ev-item" + (e.voided ? " voided" : "") }, [
        UI.el("span", { class: "ev-seq", text: "#" + e.seq }),
        UI.el("span", { class: "ev-desc", text: describeEvent(e) }),
      ]);
      if (!e.voided) {
        row.appendChild(
          UI.el("button", {
            class: "small danger",
            text: "取り消す",
            onclick: function () {
              voidEvent(match, e.seq, "訂正", new Date());
              save();
              render();
              openRevise();
              UI.toast("記録 #" + e.seq + " を取り消しました。");
            },
          })
        );
      }
      list.appendChild(row);
    });
    if (!list.children.length) {
      list.appendChild(UI.el("p", { class: "hint", text: "まだ記録がありません。" }));
    }
    $("reviseModal").hidden = false;
  }

  /* ---------- 試合終了 ---------- */

  function openFinish() {
    const st = reduceMatch(match);
    const unit = match.goal.type === "racks" ? "ラック" : "点";
    const cur = displayScore(st);
    const box = $("finishSummary");
    UI.clear(box);

    box.appendChild(
      UI.el("p", {
        text: st.winner
          ? sideName(st.winner) + " の勝ちです。"
          : "まだ決着がついていません。この時点で記録を確定します。",
      })
    );
    box.appendChild(
      UI.el("p", {
        class: "hint",
        text: sideName("A") + " " + cur.A + unit + " 対 " + sideName("B") + " " + cur.B + unit,
      })
    );
    // すでに書いてあるメモがあれば引き継ぐ（中断→再開でも消えない）
    const noteBox = $("finishNote");
    if (noteBox) noteBox.value = match.note || "";
    $("finishModal").hidden = false;
  }

  function confirmFinish() {
    const st = reduceMatch(match);
    // メモは結果を組み立てる前に入れる（保存する内容に含めるため）
    const noteBox = $("finishNote");
    if (noteBox) match.note = (noteBox.value || "").trim();
    appendEvent(match, {
      t: "MATCH_END",
      side: null,
      d: { winner: st.winner, by: st.winner ? "goal" : "manual", hasUnresolvedError: false },
    });
    match.result = buildResult(match, new Date());
    save();
    $("finishModal").hidden = true;
    close();
    HISTORY.open();
    window.dispatchEvent(new Event("pool-score:refresh-resume"));
    UI.toast("試合を保存しました。");
  }

  return { open: open, close: close, render: render };
})();
