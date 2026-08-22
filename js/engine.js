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
  // ローテーション・カイルンは基礎種目としてブレイク方式が固定。
  // JPAは基礎種目（9/8ボール）は自由だが種目としてウィナーズ固定なので、
  // 種目側の指定も見る（games_data.js の breakTypeFixed）
  if (base.breakTypeFixed) options.breakType = base.defaultBreakType;
  if (g.breakTypeFixed) options.breakType = g.defaultBreakType || base.defaultBreakType;

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
      // teamLabel / members はダブルスの表示用（「チームA（2人の名前）」）。
      // 無い種目では undefined のままで構わない
      // guest = 名前を入れずに始めた側。選手一覧には登録しないので
      // 成績の集計からも外れる（playerIds が空になる）
      { sideId: "A", name: sideA.name || "プレーヤーA", playerIds: sideA.playerIds || [],
        teamLabel: sideA.teamLabel || null, members: sideA.members || null,
        guest: !!sideA.guest },
      { sideId: "B", name: sideB.name || "プレーヤーB", playerIds: sideB.playerIds || [],
        teamLabel: sideB.teamLabel || null, members: sideB.members || null,
        guest: !!sideB.guest },
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
    // ショットクロックが自動で残す記録（平均タイムの算出用）は人の操作ではない。
    // これを取り消すと、得点が残ったまま「取り消した」ことになり、
    // 押しても何も起きないように見える。ショットクロックONのときだけ
    // 起きるため再現しにくい不具合になっていた（2026-08-20に実測で特定）
    if (e.t === "SHOT_CLOCK" && e.d && e.d.event === "shot") continue;
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
 *
 * @param base 基礎種目。相手だけにハンデが付いた場合の既定を決めるのに使う
 */
function makeScorer(scoring, goal, side, base) {
  const bhAll = (goal && goal.ballHandicap) || {};
  const bh = bhAll[side];

  // この側にハンデがある: 指定された球だけが1点
  if (bh && bh.scoringBalls && bh.scoringBalls.length) {
    const allowed = {};
    bh.scoringBalls.forEach(function (b) {
      allowed[b] = true;
    });
    return function (ball) {
      return allowed[ball] ? 1 : 0;
    };
  }

  // 相手だけにハンデがある場合。
  // この側はハンデ無しなので「種目本来の勝ち球（キーボール）だけが1点」になる。
  // ここを既定の「何でも1点」に落とすと、ハンデを付けていない側が
  // 1番を入れただけで得点してしまう（ラック集計型の種目には scoreOf が無いため）。
  const otherSide = side === "A" ? "B" : "A";
  const opponentHasBh =
    bhAll[otherSide] && bhAll[otherSide].scoringBalls && bhAll[otherSide].scoringBalls.length;
  if (opponentHasBh && !scoring.scoreOf && base && base.keyBall) {
    const key = base.keyBall;
    return function (ball) {
      return ball === key ? 1 : 0;
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
    penaltyPoints: 0, // 減点の合計（14-1・カイルン）
    threeFouls: 0,
    // ショットクロックの平均タイム算出用
    shotClockShots: 0, // 計測できたショット数
    shotClockTotalSec: 0, // その合計秒数
    turns: 0, // ターンを取った回数
    chessTimeUsedSec: 0, // チェスクロックで使った時間
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
    // 無効球の合計（個数）と、その球が本来持っていた点の合計。
    // ラックの区切りは「両者のスコア＋無効球ぶんの点」で見る（本人の指示 2026-08-21）
    deadBalls: 0,
    deadPoints: 0,
    // ラックごとの無効球の数（本人の指示 2026-08-22）。
    // スコアシートに「どのラックで何個無効になったか」を書くために使う。
    // 添字はラック番号-1。手で押した無効球と、9番投入時に残っていた球の両方を数える
    rackDead: [],
    // そのラックを取った側（'A'/'B'）。添字はラック番号-1。
    // スコアシートの斜線を、9番を入れた側にだけ付けるために使う
    rackWinner: [],
    rackPocketed: { A: [], B: [] },
    // スリーファール管理（同一ラック内・連続）
    foulStreak: { A: 0, B: 0 },
    twoFoulWarned: { A: false, B: false },
    // セット制（本人の指示 2026-08-21）。goal.sets が2以上のときだけ動く。
    // 目標に届いた側が1セット取り、点とラックを0に戻して次のセットへ進む
    sets: { A: 0, B: 0 },
    setNo: 1,
    step: { A: 1, B: 1 }, // カイルン
    // カイルンで、このイニングに既に得点したか（連続得点を許さない設定用）
    stepScoredThisInning: null,
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
      A: makeScorer(r.scoring, match.goal, "A", r.base),
      B: makeScorer(r.scoring, match.goal, "B", r.base),
    },
    // 実効スコアリング種別。ボールハンデ等で goal.type が score のときは
    // ラック集計型の種目でもボール単位で加点する（計画書§3.3の意図）。
    effKind: effectiveScoreKind(r.scoring, match.goal),
    runScore: { A: 0, B: 0 }, // イニング内の連続得点（ハイラン算出用）
    rackBrokenBy: null,
    rackHadOpponentTurn: false,
    // このラックがブレイクエースで終わったか（終わった側）。
    // ブレイクエースとマスワリは別物なので、両方を数えないための印
    // （本人の指示 2026-08-22）
    rackBreakAce: null,
    lastRackWinner: null,
  };

  // 何セット先取か。1（既定）のときは今までどおりの動きにする
  const setsToWin = Math.max(1, (match.goal && match.goal.sets) || 1);

  for (let i = 0; i < match.events.length; i++) {
    const ev = match.events[i];
    if (ev.voided) continue;
    if (ev.t === "VOID") continue;
    applyEvent(st, ev, ctx);
    if (!st.winner && setsToWin > 1) {
      const sw = checkWin(st, match.goal);
      if (sw) {
        st.sets[sw] += 1;
        if (st.sets[sw] >= setsToWin) {
          st.winner = sw;
          st.endReason = "goal";
        } else {
          // 次のセットへ。点とラックだけ戻す（セーフティ等の記録は通して数える）
          st.score = { A: 0, B: 0 };
          st.racks = { A: 0, B: 0 };
          st.setNo += 1;
        }
      }
    }
    if (st.winner) break; // 決着後のイベントは無視
  }

  // セット制のときは上のループで判定済み（点を戻したあとに再判定すると
  // 0点で勝ちになってしまうため、ここは通さない）
  if (!st.winner && setsToWin <= 1) {
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
    case "INNING_ADJ":
      applyInningAdj(st, ev);
      break;
    case "SAFETY":
      applySafety(st, ev, ctx);
      break;
    case "FOUL":
      applyFoul(st, ev, ctx);
      break;
    case "STEP":
      applyStep(st, ev, ctx);
      break;
    case "DEAD_BALLS":
      applyDeadBalls(st, ev, ctx);
      break;
    case "MARK":
      applyMark(st, ev, ctx);
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
  ctx.rackBreakAce = null;
}

function applyPocket(st, ev, ctx) {
  const side = ev.side;
  if (!side) return;
  // 交代ボタンを押さずに相手が入力したときも、手番が移ったものとして数える
  ensureTurnBy(st, side, ctx);
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
    // マスワリ（ブレイクから撞き切った）とは別物なので、
    // このラックはマスワリとして数えない（本人の指示 2026-08-22）
    ctx.rackBreakAce = side;
  }

  if (hitKey) finishRack(st, side, ctx);
}

/**
 * ラックごとの無効球を数える（本人の指示 2026-08-22）。
 *
 * 添字はラック番号-1。rackNo は最初のラックが 1 だが、
 * 記録の入り方によっては 0 のまま進むことがあるので下限を 1 にする。
 */
function addRackDead(st, n) {
  if (!n) return;
  if (!st.rackDead) st.rackDead = [];
  const i = Math.max(1, st.rackNo || 1) - 1;
  while (st.rackDead.length <= i) st.rackDead.push(0);
  st.rackDead[i] += n;
}

/** そのラックを取った側を残す。添字は addRackDead と同じ */
function addRackWinner(st, side) {
  if (!side) return;
  if (!st.rackWinner) st.rackWinner = [];
  const i = Math.max(1, st.rackNo || 1) - 1;
  while (st.rackWinner.length <= i) st.rackWinner.push(null);
  st.rackWinner[i] = side;
}

/** ラック確定処理 */
function finishRack(st, winnerSide, ctx) {
  st.racks[winnerSide]++;

  // このラックを取った側を残す（本人の指示 2026-08-22）。
  // スコアシートの斜線を、9番を入れた側にだけ付けるために使う
  addRackWinner(st, winnerSide);

  // 無効球（デッドボール）: JPAは9番投入時に盤面の残り球が全て無効
  if (ctx.scoring.deadBallOnKeyBall && st.onTable.length) {
    st.stats[winnerSide].deadBalls += st.onTable.length;
    addRackDead(st, st.onTable.length);
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
    // マスワリ（ブレイクランアウト）: ブレイクした本人が相手にターンを渡さず撞き切った。
    // ブレイクエース（ブレイクの一撃で終わった）は別に数えるので、ここでは除く
    if (ctx.base.hasMasuwari && !ctx.rackHadOpponentTurn
        && ctx.rackBreakAce !== winnerSide) {
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

/**
 * セーフティを1回数える。
 *
 * ラックの取得・交代とは独立した記録なので、回数だけを足す。
 * 誰が打ったかを分けたいので side を必須にしている。
 */
function applySafety(st, ev, ctx) {
  const side = ev.side;
  if (!side || !ctx.base.safetyCallable) return;
  st.stats[side].safety++;
}

function applyTurnEnd(st, ev, ctx) {
  const reason = (ev.d && ev.d.reason) || "miss";
  const from = ev.side || st.turn;

  // カイルンのハウス設定: ミスでステップを1に戻すか。
  // 公式競技規程が存在しないゲームで、店ごとに扱いが違うため
  // 試合開始時に選ばせている（rules_data.js の unverified を参照）
  if (ctx.scoring.kind === "stepMachine" && st.step && st.step[from]) {
    if (ctx.options.stepResetOnMiss) st.step[from] = 1;
  }
  st.stepScoredThisInning = null;
  if (reason === "safety" && ctx.base.safetyCallable) st.stats[from].safety++;
  st.stats[from].turns++;
  // チェスクロック使用時、このターンで使った時間
  if (ev.d && typeof ev.d.usedSec === "number") {
    st.stats[from].chessTimeUsedSec += ev.d.usedSec;
  }

  const to = other(from);
  // イニング（JPA規則）: 後攻→先攻にターンが移った時に1イニング。ラックを跨いでも継続
  if (from === other(st.firstSide) && to === st.firstSide) {
    st.innings++;
  }
  if (to !== ctx.rackBrokenBy) ctx.rackHadOpponentTurn = true;
  st.turn = to;
  ctx.runScore[from] = 0;
}

/**
 * イニングを手で増減する（本人の指示 2026-08-21：スコア修正から直せるように）。
 * 0より下にはしない。
 */
function applyInningAdj(st, ev) {
  const d = (ev.d && ev.d.delta) || 0;
  st.innings = Math.max(0, st.innings + d);
}

/**
 * 得点した側が手番でなければ、手番が移ったものとして扱う。
 *
 * 交代ボタンを押さなくてもイニングを数えられるようにするため
 * （本人の指示 2026-08-21：A→B→A と入力されたらイニングを1増やす）。
 * 交代ボタンを押した場合は st.turn が既に移っているので、ここは何もしない。
 */
function ensureTurnBy(st, side, ctx) {
  if (!side || !st.turn || st.turn === side) return;
  const from = st.turn;
  // イニング（JPA規則）: 後攻→先攻に手番が移ったら1イニング
  if (from === other(st.firstSide) && side === st.firstSide) st.innings++;
  if (side !== ctx.rackBrokenBy) ctx.rackHadOpponentTurn = true;
  st.turn = side;
  ctx.runScore[from] = 0;
}

function applyFoul(st, ev, ctx) {
  const side = ev.side;
  if (!side) return;
  st.stats[side].fouls++;
  const kind = (ev.d && ev.d.kind) || "normal";
  const sc = ctx.scoring;

  // ブレイキングファールはスリーファールにカウントしない（全種目共通で規程に明記）
  if (kind === "break") {
    // ただし14-1は、オープニングブレイクが正常でないと2点減点（第9条第4項）
    if (sc.badBreakPenalty && ev.d && ev.d.illegalBreak) {
      st.score[side] += sc.badBreakPenalty;
      st.stats[side].penaltyPoints += sc.badBreakPenalty;
    } else if (sc.foulPenalty) {
      // 正常なブレイクでのスクラッチ等は1点減点（同項の後段）
      st.score[side] += sc.foulPenalty;
      st.stats[side].penaltyPoints += sc.foulPenalty;
    }
    return;
  }

  // 14-1はファウル1回につき1点減点（第9条第2項）。他種目は減点なし
  if (sc.foulPenalty) {
    st.score[side] += sc.foulPenalty;
    st.stats[side].penaltyPoints += sc.foulPenalty;
  }

  st.foulStreak[side]++;
  st.foulStreak[other(side)] = 0;
  if (ev.d && ev.d.warned) st.twoFoulWarned[side] = true;

  // スリーファールの成立条件は種目で違う。
  //   9/10/8ボール : 2ファールの宣告が必要（宣告がなければ成立しない）
  //   14-1        : 宣告の要件がない（第8条第2項）
  const needsWarning = ctx.base.threeFoulResult !== "penaltyOnly";
  const established =
    st.foulStreak[side] >= 3 && (!needsWarning || st.twoFoulWarned[side]);

  if (established) {
    const result = ctx.base.threeFoulResult;
    if (result === "loseRack") {
      finishRack(st, other(side), ctx);
    } else if (result === "penaltyOnly" && sc.threeFoulPenalty) {
      // 14-1: さらに15点減点（第9条第3項。当該ファールの1点と合わせて計16点減点）
      st.score[side] += sc.threeFoulPenalty;
      st.stats[side].penaltyPoints += sc.threeFoulPenalty;
      st.stats[side].threeFouls++;
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
      st.stats[side].penaltyPoints += ctx.scoring.penaltyPoint;
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
    // ハウス設定: 1イニング内に続けて得点できるか。
    // できない設定のときは、1点取った時点でそのイニングを終える
    // （UI側で交代を促すのではなく、記録として交代まで済ませる）
    st.stepScoredThisInning = side;
  } else {
    st.step[side] = cur + 1;
  }
}

/**
 * 回数だけを数える印（マスワリ・ブレイクエース）。
 *
 * 本人の指示（2026-08-22）:
 *   「マスワリもエースも押してもスコアボードの点数が増えないようにしてください。
 *     カウントを記録するのみのボタンとします」
 *
 * 点・盤面・ラック・手番のどれも動かさない。回数だけを足す。
 * 種目が持っていない項目（14-1のマスワリなど）は無視する。
 */
function applyMark(st, ev, ctx) {
  const side = ev.side;
  if (!side || !st.stats[side]) return;
  const d = ev.d || {};
  if (d.masuwari && ctx.base.hasMasuwari) st.stats[side].masuwari++;
  if (d.breakAce && ctx.base.hasBreakAce) st.stats[side].breakAce++;
  if (d.safety && ctx.base.safetyCallable) st.stats[side].safety++;
}

/**
 * 無効球（デッドボール）。
 *
 * balls を指定すればその球を、指定が無ければ d.count 個ぶんを盤面から外す。
 * 手で押す「無効球」ボタンは、どの球が落ちたか分からないので count で数える
 * （本人の指示 2026-08-21）。点は入れず、無効球の数だけを数える。
 */
function applyDeadBalls(st, ev, ctx) {
  const asked = (ev.d && ev.d.balls) || [];
  const scoreOf = (ctx && ctx.scoring && ctx.scoring.scoreOf)
    || function () { return 1; };
  const removed = [];
  if (asked.length) {
    asked.forEach(function (b) {
      const idx = st.onTable.indexOf(b);
      if (idx >= 0) {
        st.onTable.splice(idx, 1);
        removed.push(b);
      }
    });
  } else {
    const n = (ev.d && ev.d.count) || 1;
    const key = ctx && ctx.base ? ctx.base.keyBall : null;
    for (let i = 0; i < n; i++) {
      if (!st.onTable.length) break;
      // キーボール（9番）は最後まで残す。無効になるのは手前の球
      let idx = 0;
      if (key !== null && st.onTable[0] === key && st.onTable.length > 1) idx = 1;
      removed.push(st.onTable[idx]);
      st.onTable.splice(idx, 1);
    }
  }
  const n = removed.length;
  if (!n) return;
  // その球が本来持っていた点。9番のように2点の球が無効になることもある
  const pts = removed.reduce(function (sum, b) { return sum + scoreOf(b); }, 0);
  if (ev.side && st.stats[ev.side]) st.stats[ev.side].deadBalls += n;
  st.deadBalls = (st.deadBalls || 0) + n;
  st.deadPoints = (st.deadPoints || 0) + pts;
  // どのラックで無効になったかも残す（スコアシートに書くため）
  addRackDead(st, n);
}

function applyShotClock(st, ev) {
  if (!ev.side) return;
  const kind = ev.d && ev.d.event;
  const s = st.stats[ev.side];
  if (kind === "violation") s.shotClockViolations++;
  if (kind === "extension") s.shotClockExtensions++;
  // 1ショットにかかった秒数（平均タイムの算出に使う）
  if (kind === "shot" && typeof ev.d.usedSec === "number") {
    s.shotClockShots++;
    s.shotClockTotalSec += ev.d.usedSec;
  }
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
    // innings は「後攻→先攻に手番が戻った回数」＝完了したイニング数。
    // 既存のテストと集計がこの意味で使っているので、値は変えない。
    innings: st.innings,
    // inningsPlayed は「何イニング目まで戦ったか」。試合中の表示（Nイニング目）
    // と同じ数え方で、画面に出すのはこちらを使う。
    // 相手に一度も回らずに終わった試合を 0 と書くと、記録として読めないため
    inningsPlayed: st.innings + 1,
    hasUnresolvedError: st.hasUnresolvedError,
    // セット制。1セットの試合では { A: 0, B: 0 } のままになる
    sets: { A: st.sets.A, B: st.sets.B },
    setsToWin: Math.max(1, (match.goal && match.goal.sets) || 1),
    perSide: { A: st.stats.A, B: st.stats.B },
    // ショットクロックの平均タイム（計測できたショットのみ）
    avgShotSec: {
      A: st.stats.A.shotClockShots
        ? st.stats.A.shotClockTotalSec / st.stats.A.shotClockShots
        : null,
      B: st.stats.B.shotClockShots
        ? st.stats.B.shotClockTotalSec / st.stats.B.shotClockShots
        : null,
    },
  };

  // ボウラードはイニングではなくストライク／スペア／ミスの数を記録に残す
  if (r.scoring.kind === "bowling") {
    result.bowlard = bowlardTally(bowlardThrowsOf(match), {
      frames: r.scoring.frames,
      pinsPerFrame: r.scoring.pinsPerFrame,
    });
  }

  // JPA 8ボールは「何対何で勝ったか」の3段階でポイントが決まる
  if (r.game.goal === "jpaSL8" && st.winner) {
    const loser8 = other(st.winner);
    const tp8 = jpaTeamPoints8(st.racks[loser8], match.goal.targets[loser8]);
    result.jpa = {
      teamPoints:
        st.winner === "A"
          ? { A: tp8.winner, B: tp8.loser }
          : { A: tp8.loser, B: tp8.winner },
      loserRacks: st.racks[loser8],
      loserTarget: match.goal.targets[loser8],
    };
  }

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

  // スコア表の元データ。イベント列を間引いても表を描けるように、
  // 結果の中に最小限の形で残す（本人の指示 2026-08-22）。
  // 追加は最後に行う。share.js が「結果は計算し直せるか」を
  // JSON文字列の一致で見ているため、キーの並びを変えないこと
  const sheet = buildSheetData(match);
  if (sheet) result.sheet = sheet;

  return result;
}

/* ============================================================
 * スコア表の元データ（result.sheet）
 *
 * 終わった試合のスコア表を、1球ごとのイベント列なしで描けるようにする。
 * 画面（ui_sheet.js）は試合中このイベント列から表を組んでいるが、
 *   ・終わった試合を開く道が要る
 *   ・古い試合はイベント列を間引いて容量を減らす予定
 * の2つの理由で、確定時に必要最小限だけを結果に残す。
 *
 * 形（キーは短く、値は配列）:
 *   ボウラード { k:"b", t:[各投で入れた球数] }
 *   JPA        { k:"j", lr:最終ラック番号,
 *                A:{ b:[得点順の球番号], c:[ラックごとの得点数] }, B:{...} }
 *   JPA の b は「1点=1要素」。9番のように2点の球は同じ番号が2つ並ぶ。
 *   c は添字がラック番号-1。得点が無いラックは 0 が入る。
 * ============================================================ */

/**
 * その試合にスコア表があるか。無ければ null。
 * 返すのは保存データの k と同じ短い記号（"b" = ボウリング式 / "j" = JPA）。
 * 種目名（gameId）をエンジンに書かない決まりがあるため、
 * 画面に出す名前への読み替えは store.js 側で行う。
 */
function sheetKindOf(match) {
  if (!match || !match.gameId || !GAMES[match.gameId]) return null;
  const r = resolveGame(match.gameId);
  if (r.scoring.kind === "bowling") return "b";
  if (r.game.goal === "jpaSL" || r.game.goal === "jpaSL8") return "j";
  return null;
}

/**
 * JPAの「入った順の得点列」をイベント列から作る。
 * 画面（ui_sheet.js の jpaSeries）と同じものを返す。
 * こちらは最終ラック番号（lastRack）も返す。
 */
function jpaSeriesOf(match) {
  const r = resolveGame(match.gameId);
  const scoreOf = r.scoring.scoreOf || function () { return 1; };
  const out = { A: [], B: [], lastRack: 1, rackWinner: [] };
  let rackNo = 1;
  // 直前に球を入れた側。ラックが終わった時点でその人が9番を入れたとみなす
  let lastPocketSide = null;
  // 最初の RACK_START を通ったか（ラック1の始まりを「終わり」と数えないため）
  let started = false;

  ((match && match.events) || []).forEach(function (e) {
    if (e.voided) return;
    if (e.t === "RACK_START") {
      // ラックの終わりの斜線は、そのラックを取った側にだけ付ける
      // （両者に付くと、どちらが9番を入れたのか読めない／本人の指示 2026-08-22）。
      // 9番を入れた人がラックを終わらせるので、直前に球を入れた側がそれにあたる
      if (lastPocketSide && out[lastPocketSide].length) {
        const arr = out[lastPocketSide];
        arr[arr.length - 1].rackEnd = true;
      }
      // 記録するのは「終わったラックを取った側」。
      // 試合の最初の RACK_START はラック1の始まりであって、
      // 何かが終わったわけではないので数に入れない（数えると添字が1つずれる）
      if (started) out.rackWinner.push(lastPocketSide || null);
      started = true;
      lastPocketSide = null;
      rackNo = (e.d && e.d.rackNo) || rackNo + 1;
      if (rackNo > out.lastRack) out.lastRack = rackNo;
      return;
    }
    if (e.t !== "POCKET" || !e.side) return;
    const balls = (e.d && e.d.balls) || [];
    balls.forEach(function (b) {
      const pts = scoreOf(b);
      for (let i = 0; i < pts; i++) {
        out[e.side].push({ ball: b, rackNo: rackNo, rackEnd: false });
      }
    });
    lastPocketSide = e.side;
  });
  return out;
}

/** 試合からスコア表の元データを作る。対象外の種目は null */
function buildSheetData(match) {
  const kind = sheetKindOf(match);
  if (!kind) return null;
  if (!match.events || !match.events.length) return null;

  if (kind === "b") {
    return { k: "b", t: bowlardThrowsOf(match) };
  }

  const ser = jpaSeriesOf(match);
  const data = { k: "j", lr: ser.lastRack };
  ["A", "B"].forEach(function (side) {
    const b = [];
    const c = [];
    ser[side].forEach(function (p) {
      b.push(p.ball);
      const i = Math.max(1, p.rackNo) - 1;
      while (c.length <= i) c.push(0);
      c[i] += 1;
    });
    if (c.length > data.lr) data.lr = c.length;
    data[side] = { b: b, c: c };
  });
  // ラックを取った側（w）と、ラックごとの無効球（dd）。本人の指示 2026-08-22。
  // どちらも中身があるときだけ足す。空の配列まで持たせると、
  // 共有リンクに使う JSON がその分だけ長くなるため。
  // 古い記録にはこの2つが無く、読む側は「印は両方に付ける／無効球は出さない」に戻る
  const w = (ser.rackWinner || []).map(function (s) { return s || ""; });
  if (w.some(function (s) { return s; })) data.w = w;
  const dd = deadByRackOf(match);
  if (dd.some(function (n) { return n > 0; })) data.dd = dd;
  return data;
}

/**
 * ラックごとの無効球の数をイベント列から数える（本人の指示 2026-08-22）。
 *
 * リデューサを通した派生状態（st.rackDead）と同じものを、
 * 終わった試合の保存データを作るときにも使えるようにここで組み立てる。
 */
function deadByRackOf(match) {
  const st = reduceMatch(match);
  return (st && st.rackDead) ? st.rackDead.slice() : [];
}

/**
 * 保存したデータから、画面が使う得点列に戻す。
 * ラックの最後の点に付く印（rackEnd）は
 * 「そのラックの最後の点で、かつ後にもラックが始まっている」で決まる。
 *
 * 2026-08-22 から、印はそのラックを取った側にだけ付ける（sheet.w）。
 * w を持たない古い記録は、これまでどおり両方に付ける
 */
function jpaSeriesFromSheet(sheet) {
  const out = { A: [], B: [], rackDead: (sheet && sheet.dd) ? sheet.dd.slice() : [] };
  if (!sheet) return out;
  const lr = sheet.lr || 1;
  const w = sheet.w || null;
  ["A", "B"].forEach(function (side) {
    const d = sheet[side] || { b: [], c: [] };
    const balls = d.b || [];
    let i = 0;
    (d.c || []).forEach(function (cnt, ri) {
      const rackNo = ri + 1;
      // 取った側が分かる記録なら、その側にだけ印を付ける
      const mine = w ? (w[ri] === side) : true;
      for (let n = 0; n < cnt; n++) {
        out[side].push({
          ball: balls[i++],
          rackNo: rackNo,
          rackEnd: n === cnt - 1 && rackNo < lr && mine,
        });
      }
    });
  });
  return out;
}

/* ============================================================
 * ボウラード（ボウリング式スコア）
 *
 * 1フレームに10個の球を並べ、2投で何個入れるかを数える。
 *   1投目で10個 = ストライク → 10 + 次の2投ぶん
 *   2投で10個   = スペア     → 10 + 次の1投ぶん
 * 10フレーム目だけは、ストライク/スペアのときに投球を足す。
 *
 * ボウリングの規則そのままで、ビリヤード固有の規程ではない。
 * ============================================================ */

/**
 * 投球の並び（各投で入れた球数の配列）からフレームごとのスコアを組み立てる。
 *
 * @param {number[]} throws 各投で入れた球数。ストライクは10が1つ入る
 * @param {object} cfg      { frames, pinsPerFrame }
 * @returns {{frames: Array, total: number, complete: boolean}}
 */
/**
 * 試合の出来事から、投球ごとの「入れた球数」の並びを取り出す。
 * 画面側（ui_sheet.js）でも同じ計算をしていたので、ここを本体にする。
 */
function bowlardThrowsOf(match) {
  const out = [];
  ((match && match.events) || []).forEach(function (e) {
    if (e.voided || e.t !== "POCKET") return;
    out.push(((e.d && e.d.balls) || []).length);
  });
  return out;
}

/**
 * ストライク・スペア・ミス（オープンフレーム）の数を数える。
 *
 * ボウラードは1人でやる種目で、イニング（手番の入れ替わり）に意味が無い。
 * 結果と記録にはこの3つを出す（本人の指示 2026-08-21）。
 * まだ投げていないフレームはどれにも数えない。
 */
function bowlardTally(throws, cfg) {
  const sc = buildBowlardScore(throws, cfg);
  // total も一緒に返す。履歴に「獲得スコア」を出すのに使う（本人の指示 2026-08-21）
  const out = { strike: 0, spare: 0, miss: 0, total: sc.total };
  sc.frames.forEach(function (f) {
    if (f.kind === "strike") out.strike += 1;
    else if (f.kind === "spare") out.spare += 1;
    else if (f.kind === "open") out.miss += 1;
  });
  return out;
}

function buildBowlardScore(throws, cfg) {
  const nFrames = (cfg && cfg.frames) || 10;
  const pins = (cfg && cfg.pinsPerFrame) || 10;
  const t = (throws || []).slice();

  const frames = [];
  let i = 0;
  let total = 0;

  for (let f = 0; f < nFrames; f++) {
    const isLast = f === nFrames - 1;
    const frame = {
      no: f + 1,
      throws: [],
      kind: null, // "strike" | "spare" | "open" | null(未完了)
      score: null, // 累計。ボーナスが確定するまで null
    };

    if (i >= t.length) {
      frames.push(frame);
      continue;
    }

    if (!isLast) {
      const a = t[i];
      if (a === pins) {
        // ストライク。次の2投がボーナス
        frame.throws = [a];
        frame.kind = "strike";
        const b1 = t[i + 1];
        const b2 = t[i + 2];
        if (b1 !== undefined && b2 !== undefined) {
          total += pins + b1 + b2;
          frame.score = total;
        }
        i += 1;
      } else {
        const b = t[i + 1];
        frame.throws = b === undefined ? [a] : [a, b];
        if (b === undefined) {
          // 2投目がまだ
          frames.push(frame);
          i += 1;
          continue;
        }
        if (a + b === pins) {
          // スペア。次の1投がボーナス
          frame.kind = "spare";
          const b1 = t[i + 2];
          if (b1 !== undefined) {
            total += pins + b1;
            frame.score = total;
          }
        } else {
          frame.kind = "open";
          total += a + b;
          frame.score = total;
        }
        i += 2;
      }
    } else {
      // 10フレーム目。ストライク/スペアなら3投目まで
      const a = t[i];
      const b = t[i + 1];
      const c = t[i + 2];
      const got = [a, b, c].filter(function (x) { return x !== undefined; });
      frame.throws = got;

      const needThree = a === pins || (a !== undefined && b !== undefined && a + b === pins);
      const done = needThree ? got.length === 3 : got.length === 2;
      if (done) {
        frame.kind = a === pins ? "strike" : (a + b === pins ? "spare" : "open");
        total += got.reduce(function (x, y) { return x + y; }, 0);
        frame.score = total;
      }
      i += got.length;
    }

    frames.push(frame);
  }

  const complete = frames.every(function (f) { return f.score !== null; });
  return { frames: frames, total: total, complete: complete };
}

/**
 * 次にその投球で入れられる最大数を返す（入力ボタンの上限に使う）。
 * 1フレーム目の1投目なら10、1投目で3個入れたあとの2投目なら7。
 */
function bowlardRemainingPins(throws, cfg) {
  const nFrames = (cfg && cfg.frames) || 10;
  const pins = (cfg && cfg.pinsPerFrame) || 10;
  const t = (throws || []).slice();

  let i = 0;
  for (let f = 0; f < nFrames; f++) {
    const isLast = f === nFrames - 1;
    if (i >= t.length) return pins; // このフレームの1投目

    if (!isLast) {
      if (t[i] === pins) { i += 1; continue; }
      if (t[i + 1] === undefined) return pins - t[i]; // 2投目
      i += 2;
    } else {
      const a = t[i], b = t[i + 1], c = t[i + 2];
      if (a === undefined) return pins;
      if (b === undefined) return a === pins ? pins : pins - a;
      const needThree = a === pins || a + b === pins;
      if (!needThree) return 0; // 終了
      if (c === undefined) {
        // 3投目。直前がストライクなら10本立て直し
        if (a === pins && b === pins) return pins;
        if (a === pins) return pins - b;
        return pins; // スペア後は10本立て直し
      }
      return 0;
    }
  }
  return 0;
}
