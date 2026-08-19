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
  let flags = { masuwari: false, breakAce: false, safety: false };

  /* ---------- 起動・終了 ---------- */

  function open(m) {
    match = m;
    flags = { masuwari: false, breakAce: false, safety: false };
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

    // スコア欄そのものがボタン。タップで1点（1ラック）加算する
    $("panelA").addEventListener("click", UI.guard(function () { recordRackWin("A"); }));
    $("panelB").addEventListener("click", UI.guard(function () { recordRackWin("B"); }));
    $("undoBtn").addEventListener("click", UI.guard(onUndo));
    $("reviseBtn").addEventListener("click", UI.guard(openRevise));
    $("finishBtn").addEventListener("click", UI.guard(openFinish));
    $("breakToggleBtn").addEventListener("click", UI.guard(toggleBreakSide));
    $("quitMatchBtn").addEventListener("click", UI.guard(function () {
      save();
      close();
      HISTORY.open();
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

    save();
    render();
    vibrate(30);

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
    if (s.side && !s.violated) info.push("延長" + s.extensionsLeft[s.side] + "回");
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

  function recordRackWin(side) {
    const st = reduceMatch(match);
    if (st.winner) {
      UI.toast("この試合はもう終わっています。", "warn");
      return;
    }

    const r = resolveGame(match.gameId);

    // 球1個=1点の種目（14-1）は、タップ1回を「1個ポケットした」として記録する。
    // ラック単位の種目とは記録するイベントが違う。
    if (r.scoring.kind === "ballScore" && !r.base.keyBall) {
      recordOneBall(side, r);
      return;
    }

    appendEvent(match, {
      t: "RACK_WIN",
      side: side,
      d: {
        winner: side,
        masuwari: flags.masuwari && r.base.hasMasuwari,
        breakAce: flags.breakAce && r.base.hasBreakAce,
        safety: flags.safety && r.base.safetyCallable,
      },
    });

    const after = reduceMatch(match);
    if (!after.winner) {
      // 次のラックを開始する（ブレイク権は方式に従って自動決定）
      const bt = (match.options && match.options.breakType) || r.base.defaultBreakType;
      const nextBreak = nextBreakSide(bt, st.breakSide || st.firstSide, side);
      appendEvent(match, {
        t: "RACK_START",
        side: null,
        d: { rackNo: after.rackNo + 1, breakSide: nextBreak, auto: true },
      });
    }

    flags = { masuwari: false, breakAce: false, safety: false };
    save();
    render();
    bump(side);

    const final = reduceMatch(match);
    if (final.winner) {
      vibrate([120, 60, 120, 60, 200]);
      openFinish();
    } else if (clock) {
      startClockForCurrentTurn();
    }
  }

  /**
   * 球1個ぶんの得点を記録する（14-1）。
   * ballsPerRack 個たまったら、ブレイクボールを残してラックを組み直す（規程第13章第1条第3項）。
   */
  function recordOneBall(side, r) {
    const before = reduceMatch(match);
    // 盤面に残っている球のうち、若い番号を1つ消費する（番号は得点に影響しない）
    const ball = before.onTable.length ? before.onTable[0] : 1;
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
    }

    save();
    render();
    bump(side);

    if (reduceMatch(match).winner) {
      vibrate([120, 60, 120, 60, 200]);
      openFinish();
    } else if (clock) {
      startClockForCurrentTurn();
    }
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

  function sideName(side) {
    if (!match) return side;
    return side === "A" ? match.sides[0].name : match.sides[1].name;
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
    const parts = [match.goal.targets.A + " 対 " + match.goal.targets.B + unit, btShort];
    if (match.goal.targets.A !== match.goal.targets.B) parts.push("ハンデ戦");
    $("matchSubtitle").textContent = parts.join(" ・ ");

    const cur = match.goal.type === "racks" ? st.racks : st.score;
    ["A", "B"].forEach(function (side) {
      $("name" + side).textContent = sideName(side);
      $("score" + side).textContent = String(cur[side]);
      $("target" + side).textContent = "/ " + match.goal.targets[side];
      const pct = Math.min(100, Math.round((cur[side] / match.goal.targets[side]) * 100));
      $("bar" + side).style.width = pct + "%";
      $("breakMark" + side).textContent = st.breakSide === side ? "●" : "";
    });

    $("rackInfo").textContent = "ラック " + Math.max(1, st.rackNo);
    $("breakToggleBtn").textContent = "ブレイク: " + sideName(st.breakSide || st.firstSide);

    // 決着後はタップで加算できないようにする
    const finished = !!st.winner;
    $("panelA").disabled = finished;
    $("panelB").disabled = finished;
    const perBall = r.scoring.kind === "ballScore" && !r.base.keyBall;
    $("tapHint").textContent = finished
      ? "この試合は終了しています。下の「試合終了」から保存してください。"
      : perBall
      ? "球を1個入れるごとに、その人のスコアをタップしてください"
      : "ラックを取った側のスコアをタップしてください";

    // ターン交代ボタン
    const turnBtn = $("turnBtn");
    turnBtn.hidden = finished;
    $("turnNextName").textContent = sideName(st.turn === "A" ? "B" : "A");
    turnBtn.disabled = finished;

    renderFlagButtons(r.base);
    renderShotClock();
    renderChessClock();
  }

  /** 補助フラグのボタンを種目に応じて出し分ける */
  function renderFlagButtons(base) {
    const wrap = $("flagButtons");
    UI.clear(wrap);

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
      { key: "masuwari", label: "マスワリ", show: base.hasMasuwari, hint: "ブレイクして撞き切った" },
      { key: "breakAce", label: "ブレイクエース", show: base.hasBreakAce, hint: "ブレイクで直接入れた" },
      { key: "safety", label: "セーフティ", show: base.safetyCallable, hint: "" },
    ];

    defs.filter(function (d) { return d.show; }).forEach(function (d) {
      wrap.appendChild(
        UI.el("button", {
          type: "button",
          "aria-pressed": String(!!flags[d.key]),
          title: d.hint,
          text: d.label,
          onclick: function () {
            flags[d.key] = !flags[d.key];
            renderFlagButtons(base);
          },
        })
      );
    });

    if (!wrap.children.length) {
      wrap.appendChild(
        UI.el("p", { class: "hint", text: "この種目では追加で記録する項目はありません。" })
      );
    }
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
    const cur = match.goal.type === "racks" ? st.racks : st.score;
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
    $("finishModal").hidden = false;
  }

  function confirmFinish() {
    const st = reduceMatch(match);
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
    UI.toast("試合を保存しました。");
  }

  return { open: open, close: close, render: render };
})();
