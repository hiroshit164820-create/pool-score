/**
 * engine.js — スコアリングエンジン（純粋関数のみ）
 *
 * 設計の核:
 *   イベントログ（追記のみ・不変）→ reduce（純粋関数）→ 派生状態（保存しない）
 *
 * ここには種目名（gameId）による分岐を一切書かない。
 * 分岐は scoring.kind の4通り（rackCount / ballScore / rackScore / stepMachine）だけ。
 * 種目の差分は data/ 配下の定義データが持つ。
 *
 * DOM・localStorage には触らない（検証しやすさのため）。
 */

/* ============================================================
 * ID生成・試合の生成
 * ============================================================ */

function makeMatchId(now) {
  const d = now || new Date();
  const p = function (n, w) {
    return String(n).padStart(w || 2, "0");
  };
  const stamp =
    d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  const rand = Math.random().toString(36).slice(2, 6);
  return "m_" + stamp + "_" + rand;
}

function isoNow(now) {
  return (now || new Date()).toISOString();
}

function other(side) {
  return side === "A" ? "B" : "A";
}

/**
 * 新しい試合を作る。
 * cfg: { gameId, sides:[{name,playerIds}], goal, options, firstSide }
 */
function createMatch(cfg) {
  const g = GAMES[cfg.gameId];
  if (!g) throw new Error("未知の種目: " + cfg.gameId);
  const base = BASE_RULES[g.base];
  const now = cfg.now || new Date();
  const firstSide = cfg.firstSide || "A";

  const options = Object.assign(
    {
      breakType: base.defaultBreakType,
      shotClock: { enabled: false },
      inputMode: g.mode,
    },
    cfg.options || {}
  );
  // ローテーション・カイルンはブレイク方式が固定
  if (base.breakTypeFixed) options.breakType = base.defaultBreakType;

  const sideA = (cfg.sides && cfg.sides[0]) || {};
  const sideB = (cfg.sides && cfg.sides[1]) || {};

  const match = {
    id: cfg.id || makeMatchId(now),
    schemaVersion: 1,
    ownerId: "local",
    createdAt: isoNow(now),
    updatedAt: isoNow(now),
    syncState: "local",
    deletedAt: null,

    gameId: cfg.gameId,
    rulesetVersion: "2026-06",

    sides: [
      { sideId: "A", name: sideA.name || "プレーヤーA", playerIds: sideA.playerIds || [] },
      { sideId: "B", name: sideB.name || "プレーヤーB", playerIds: sideB.playerIds || [] },
    ],

    goal: cfg.goal,
    options: options,
    events: [],
    // 規程第5章第4条: オルタネイトブレイク時の記録責任者は非ブレイク側
    recordedBy: options.breakType === "alternate" ? other(firstSide) : firstSide,
    result: null,
    note: cfg.note || "",
  };

  appendEvent(match, { t: "MATCH_START", side: null, d: { firstSide: firstSide } }, now);
  appendEvent(match, { t: "RACK_START", side: null, d: { rackNo: 1, breakSide: firstSide } }, now);
  return match;
}

/* ============================================================
 * イベントの追記・訂正
 * ============================================================ */

/** イベントを追記する（既存イベントは書き換えない） */
function appendEvent(match, ev, now) {
  const seq = match.events.length ? match.events[match.events.length - 1].seq + 1 : 1;
  const full = {
    seq: seq,
    t: ev.t,
    side: ev.side === undefined ? null : ev.side,
    at: isoNow(now),
    voided: false,
    d: ev.d || {},
  };
  match.events.push(full);
  match.updatedAt = full.at;
  return full;
}

/**
 * イベントを無効化する（規程要件: 原記録を消さない）
 * VOIDイベントを追記した上で、対象の voided フラグも立てる二重記録。
 */
function voidEvent(match, targetSeq, reason, now) {
  const target = match.events.find(function (e) {
    return e.seq === targetSeq;
  });
  if (!target) throw new Error("対象イベントが見つかりません: seq=" + targetSeq);
  if (target.t === "VOID") throw new Error("VOIDイベントは訂正できません");
  if (target.voided) return null; // 既に無効化済み
  target.voided = true;
  return appendEvent(
    match,
    { t: "VOID", side: null, d: { targetSeq: targetSeq, reason: reason || "訂正" } },
    now
  );
}

/** 直近の取り消せるイベントを1件無効化（undo） */
function undoLast(match, now) {
  for (let i = match.events.length - 1; i >= 0; i--) {
    const e = match.events[i];
    if (e.voided) continue;
    if (e.t === "VOID" || e.t === "MATCH_START") continue;
    // 自動発行された RACK_START は単独では取り消さない（直前の得点イベントと一緒に消える）
    if (e.t === "RACK_START" && e.d && e.d.auto) continue;
    return voidEvent(match, e.seq, "undo", now);
  }
  return null;
}

/* ============================================================
 * ブレイク権
 * ============================================================ */

/**
 * 次のラックのブレイク側を決める。
 * winner      : 直前のラックの勝者（NBA各種目章第4条第6項a）
 * alternate   : 交互（同b）
 * continuation: ローテーション。前ラックを撞き切った側が続けてブレイク（第11章第4条第5項）
 */
function nextBreakSide(breakType, prevBreakSide, rackWinner) {
  if (breakType === "alternate") return other(prevBreakSide);
  if (breakType === "winner" || breakType === "continuation") {
    return rackWinner || prevBreakSide;
  }
  return prevBreakSide;
}

/* ============================================================
 * スコアラー（ボールハンデ対応）
 * ============================================================ */

/**
 * 球→点数の変換関数を返す。
 * ボールハンデが設定されていれば種目既定の scoreOf を差し替える。
 */
function makeScorer(scoring, goal, side) {
  const bh = goal && goal.ballHandicap && goal.ballHandicap[side];
  if (bh && bh.scoringBalls && bh.scoringBalls.length) {
    const allowed = {};
    bh.scoringBalls.forEach(function (b) {
      allowed[b] = true;
    });
    return function (ball) {
      return allowed[ball] ? 1 : 0;
    };
  }
  if (!scoring.scoreOf) {
    return function () {
      return 1;
    };
  }
  return scoring.scoreOf;
}

/**
 * 実効スコアリング種別を返す。
 * ラック集計型の種目でも goal.type === "score" なら（＝ボールハンデ等）
 * ボール単位の加点に切り替える。種目定義は変更しない。
 */
function effectiveScoreKind(scoring, goal) {
  if (scoring.kind === "rackCount" && goal && goal.type === "score") {
    return "ballScore";
  }
  return scoring.kind;
}

/* ============================================================
 * リデューサ
 * ============================================================ */

function emptySideStats() {
  return {
    masuwari: 0,
    breakAce: 0,
    safety: 0,
    deadBalls: 0,
    timeouts: 0,
    fouls: 0,
    breaks: 0,
    breakWins: 0,
    shotClockViolations: 0,
    shotClockExtensions: 0,
    highRun: 0,
    stepPenalty: 0,
    stepCycles: 0,
  };
}

function initState(match, base) {
  const firstEv = match.events[0];
  const firstSide = (firstEv && firstEv.d && firstEv.d.firstSide) || "A";
  return {
    gameId: match.gameId,
    firstSide: firstSide,
    score: { A: 0, B: 0 },
    racks: { A: 0, B: 0 },
    rackNo: 0,
    breakSide: null,
    turn: firstSide,
    innings: 0,
    onTable: base.balls.slice(), // 盤面に残っている球
    rackPocketed: { A: [], B: [] },
    // スリーファール管理（同一ラック内・連続）
    foulStreak: { A: 0, B: 0 },
    twoFoulWarned: { A: false, B: false },
    step: { A: 1, B: 1 }, // カイルン
    stats: { A: emptySideStats(), B: emptySideStats() },
    winner: null,
    endReason: null,
    hasUnresolvedError: false,
  };
}

/**
 * 試合のイベント列を畳んで現在の状態を出す。
 * 毎回全リプレイする（1試合数百件なので1ms未満）。
 */
function reduceMatch(match) {
  const r = resolveGame(match.gameId);
  const st = initState(match, r.base);
  const ctx = {
    base: r.base,
    scoring: r.scoring,
    game: r.game,
    goal: match.goal,
    options: match.options || {},
    scorer: {
      A: makeScorer(r.scoring, match.goal, "A"),
      B: makeScorer(r.scoring, match.goal, "B"),
    },
    // 実効スコアリング種別。ボールハンデ等で goal.type が score のときは
    // ラック集計型の種目でもボール単位で加点する（計画書§3.3の意図）。
    effKind: effectiveScoreKind(r.scoring, match.goal),
    runScore: { A: 0, B: 0 }, // イニング内の連続得点（ハイラン算出用）
    rackBrokenBy: null,
    rackHadOpponentTurn: false,
    lastRackWinner: null,
  };

  for (let i = 0; i < match.events.length; i++) {
    const ev = match.events[i];
    if (ev.voided) continue;
    if (ev.t === "VOID") continue;
    applyEvent(st, ev, ctx);
    if (st.winner) break; // 決着後のイベントは無視
  }

  if (!st.winner) {
    const w = checkWin(st, match.goal);
    if (w) {
      st.winner = w;
      st.endReason = "goal";
    }
  }
  st.lastRackWinner = ctx.lastRackWinner;
  return st;
}

/** 1イベントを状態に適用する */
function applyEvent(st, ev, ctx) {
  switch (ev.t) {
    case "MATCH_START":
      st.firstSide = (ev.d && ev.d.firstSide) || "A";
      st.turn = st.firstSide;
      break;
    case "RACK_START":
      startRack(st, ev, ctx);
      break;
    case "POCKET":
      applyPocket(st, ev, ctx);
      break;
    case "RACK_WIN":
      applyRackWin(st, ev, ctx);
      break;
    case "TURN_END":
      applyTurnEnd(st, ev, ctx);
      break;
    case "FOUL":
      applyFoul(st, ev, ctx);
      break;
    case "STEP":
      applyStep(st, ev, ctx);
      break;
    case "DEAD_BALLS":
      applyDeadBalls(st, ev);
      break;
    case "TIMEOUT":
      if (ev.side) st.stats[ev.side].timeouts++;
      break;
    case "SHOT_CLOCK":
      applyShotClock(st, ev);
      break;
    case "MATCH_END":
      st.winner = (ev.d && ev.d.winner) || null;
      st.endReason = (ev.d && ev.d.by) || "manual";
      st.hasUnresolvedError = !!(ev.d && ev.d.hasUnresolvedError);
      break;
  }
}

function startRack(st, ev, ctx) {
  st.rackNo = (ev.d && ev.d.rackNo) || st.rackNo + 1;
  const bs = ev.d && ev.d.breakSide;
  st.breakSide = bs || st.breakSide || st.firstSide;
  st.onTable = ctx.base.balls.slice();
  st.rackPocketed = { A: [], B: [] };
  st.foulStreak = { A: 0, B: 0 };
  st.twoFoulWarned = { A: false, B: false };
  st.stats[st.breakSide].breaks++;
  st.turn = st.breakSide;
  ctx.rackBrokenBy = st.breakSide;
  ctx.rackHadOpponentTurn = false;
}

function applyPocket(st, ev, ctx) {
  const side = ev.side;
  if (!side) return;
  const balls = (ev.d && ev.d.balls) || [];
  const onBreak = !!(ev.d && ev.d.onBreak);
  const scorer = ctx.scorer[side];

  balls.forEach(function (b) {
    const idx = st.onTable.indexOf(b);
    if (idx >= 0) st.onTable.splice(idx, 1);
    st.rackPocketed[side].push(b);
  });

  const keyBall = ctx.base.keyBall;
  const hitKey = keyBall !== null && balls.indexOf(keyBall) >= 0;

  if (ctx.effKind === "ballScore") {
    let gained;
    if (ctx.scoring.keyBallExclusive && hitKey) {
      // JCL9: 9番を入れた側は14点のみ。このラックで既に加算した分を打ち消す
      const already = st.rackPocketed[side]
        .filter(function (b) { return b !== keyBall; })
        .reduce(function (s, b) { return s + scorer(b); }, 0);
      gained = scorer(keyBall) - already;
    } else {
      gained = balls.reduce(function (s, b) { return s + scorer(b); }, 0);
    }
    st.score[side] += gained;
    ctx.runScore[side] += gained;
    if (ctx.runScore[side] > st.stats[side].highRun) {
      st.stats[side].highRun = ctx.runScore[side];
    }
  }

  // ブレイクエース: ブレイク一撃でキーボールが入る（9ボールのみ）
  if (onBreak && hitKey && ctx.base.hasBreakAce) {
    st.stats[side].breakAce++;
  }

  if (hitKey) finishRack(st, side, ctx);
}

/** ラック確定処理 */
function finishRack(st, winnerSide, ctx) {
  st.racks[winnerSide]++;

  // 無効球（デッドボール）: JPAは9番投入時に盤面の残り球が全て無効
  if (ctx.scoring.deadBallOnKeyBall && st.onTable.length) {
    st.stats[winnerSide].deadBalls += st.onTable.length;
    st.onTable = [];
  }

  // JCL8: 勝者14点固定、敗者は自グループの落球数
  if (ctx.scoring.kind === "rackScore") {
    st.score[winnerSide] += ctx.scoring.winnerPoints;
    const loser = other(winnerSide);
    st.score[loser] += st.rackPocketed[loser].length;
  }

  if (ctx.rackBrokenBy === winnerSide) {
    st.stats[winnerSide].breakWins++;
    // マスワリ（ブレイクランアウト）: ブレイクした本人が相手にターンを渡さず撞き切った
    if (ctx.base.hasMasuwari && !ctx.rackHadOpponentTurn) {
      st.stats[winnerSide].masuwari++;
    }
  }

  ctx.lastRackWinner = winnerSide;
  ctx.runScore.A = 0;
  ctx.runScore.B = 0;
}

function applyRackWin(st, ev, ctx) {
  const side = (ev.d && ev.d.winner) || ev.side;
  if (!side) return;
  // ラック単位モードの補助フラグ（種目が対応していないものは無視）
  if (ev.d && ev.d.masuwari && ctx.base.hasMasuwari) st.stats[side].masuwari++;
  if (ev.d && ev.d.breakAce && ctx.base.hasBreakAce) st.stats[side].breakAce++;
  if (ev.d && ev.d.safety && ctx.base.safetyCallable) st.stats[side].safety++;
  st.racks[side]++;
  if (ctx.rackBrokenBy === side) st.stats[side].breakWins++;
  ctx.lastRackWinner = side;
}

function applyTurnEnd(st, ev, ctx) {
  const reason = (ev.d && ev.d.reason) || "miss";
  const from = ev.side || st.turn;
  if (reason === "safety" && ctx.base.safetyCallable) st.stats[from].safety++;

  const to = other(from);
  // イニング（JPA規則）: 後攻→先攻にターンが移った時に1イニング。ラックを跨いでも継続
  if (from === other(st.firstSide) && to === st.firstSide) {
    st.innings++;
  }
  if (to !== ctx.rackBrokenBy) ctx.rackHadOpponentTurn = true;
  st.turn = to;
  ctx.runScore[from] = 0;
}

function applyFoul(st, ev, ctx) {
  const side = ev.side;
  if (!side) return;
  st.stats[side].fouls++;
  const kind = (ev.d && ev.d.kind) || "normal";

  // ブレイキングファールはスリーファールにカウントしない（全種目共通で規程に明記）
  if (kind === "break") return;

  st.foulStreak[side]++;
  st.foulStreak[other(side)] = 0;
  if (ev.d && ev.d.warned) st.twoFoulWarned[side] = true;

  // スリーファール成立には「2ファールの宣告」が必要（宣告なしだと成立しない）
  if (st.foulStreak[side] >= 3 && st.twoFoulWarned[side]) {
    const result = ctx.base.threeFoulResult;
    if (result === "loseRack") {
      finishRack(st, other(side), ctx);
    }
    // ローテーション(freeBallOnly)はラック負けにならず、カウントだけリセット
    st.foulStreak[side] = 0;
    st.twoFoulWarned[side] = false;
  }
}

function applyStep(st, ev, ctx) {
  const side = ev.side;
  if (!side) return;
  const result = (ev.d && ev.d.result) || "ok";

  if (result === "penalty") {
    // カイルン唯一の減点。selfMinus: 自分-1点 / othersPlus: 相手+1点
    const mode = ctx.options.penaltyMode || ctx.base.defaultPenaltyMode;
    if (mode === "othersPlus") {
      st.score[other(side)] += 1;
    } else {
      st.score[side] += ctx.scoring.penaltyPoint;
    }
    st.stats[side].stepPenalty++;
    st.step[side] = 1;
    return;
  }

  const cur = st.step[side];
  if (cur >= ctx.scoring.stepsToScore) {
    st.score[side] += ctx.scoring.pointPerCycle;
    st.stats[side].stepCycles++;
    st.step[side] = 1;
  } else {
    st.step[side] = cur + 1;
  }
}

function applyDeadBalls(st, ev) {
  const balls = (ev.d && ev.d.balls) || [];
  balls.forEach(function (b) {
    const idx = st.onTable.indexOf(b);
    if (idx >= 0) st.onTable.splice(idx, 1);
  });
  if (ev.side) st.stats[ev.side].deadBalls += balls.length;
}

function applyShotClock(st, ev) {
  if (!ev.side) return;
  const kind = ev.d && ev.d.event;
  if (kind === "violation") st.stats[ev.side].shotClockViolations++;
  if (kind === "extension") st.stats[ev.side].shotClockExtensions++;
}

/* ============================================================
 * 勝利判定
 * ============================================================ */

/**
 * 目標値に到達したかを判定する。
 * ハンデは goal.targets の非対称化として表現されるため、ここは対称に書ける。
 */
function checkWin(st, goal) {
  if (!goal || !goal.targets) return null;
  const cur = goal.type === "score" ? st.score : st.racks;
  if (goal.targets.A != null && cur.A >= goal.targets.A) return "A";
  if (goal.targets.B != null && cur.B >= goal.targets.B) return "B";
  return null;
}

/* ============================================================
 * サマリ（試合確定時に1回だけ計算して保存する）
 * ============================================================ */

function buildResult(match, now) {
  const st = reduceMatch(match);
  const r = resolveGame(match.gameId);
  const result = {
    endedAt: isoNow(now),
    winner: st.winner,
    by: st.endReason || "goal",
    scores: { A: st.score.A, B: st.score.B },
    racks: { A: st.racks.A, B: st.racks.B },
    innings: st.innings,
    hasUnresolvedError: st.hasUnresolvedError,
    perSide: { A: st.stats.A, B: st.stats.B },
  };

  // JPAはチームポイントも確定させる
  if (r.game.goal === "jpaSL" && st.winner) {
    const loser = other(st.winner);
    const meta = match.goal && match.goal.meta;
    const sl = meta && meta.skillLevel && meta.skillLevel[loser];
    if (sl != null) {
      const tp = jpaTeamPoints(sl, st.score[loser]);
      result.jpa = {
        teamPoints:
          st.winner === "A"
            ? { A: tp.winner, B: tp.loser }
            : { A: tp.loser, B: tp.winner },
        loserSL: sl,
        loserScore: st.score[loser],
      };
    }
  }
  return result;
}
