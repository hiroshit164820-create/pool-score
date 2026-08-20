/**
 * ui_money.js — 5-9 / 5-10 の画面
 *
 * 既存の試合画面（ui_match.js）は左右2枚のパネル固定で、
 * スコア・番の管理・集計もすべてA/Bの2つ前提になっている。
 * 5-9は3人以上で遊ぶゲームなので、そこへ相乗りさせず別画面にしている。
 */
const MONEYUI = (function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };

  /** いまの種目（MONEY.GAMES の要素） */
  let game = MONEY.GAMES["59"];
  /** 参加者 [{ id, name }] */
  let players = [];
  /** ハンデ球 { playerId: [番号] } */
  let handicaps = {};
  /** 落球の記録 [{ by, ball, side, voided }] */
  let shots = [];
  /** ラックの区切り [{ at, runoutBy }] */
  let racks = [];
  /** いま選んでいる「落とした人」 */
  let shooter = null;

  let bound = false;

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("moneyAddBtn").addEventListener("click", UI.guard(addPlayer));
    $("moneyStartBtn").addEventListener("click", UI.guard(start));
    $("moneyUndoBtn").addEventListener("click", UI.guard(undo));
    $("moneyRackBtn").addEventListener("click", UI.guard(endRack));
    $("moneyQuitBtn").addEventListener("click", UI.guard(quit));
  }

  /* ---------- 準備 ---------- */

  /** 種目を選んで準備画面を開く。gameId は "59" | "510" */
  function open(gameId) {
    bindOnce();
    game = MONEY.GAMES[gameId] || MONEY.GAMES["59"];
    // 前回の人数を引き継ぐと事故のもとなので、空なら2人から始める
    if (!players.length) {
      players = [newPlayer(""), newPlayer("")];
      handicaps = {};
    }
    shots = [];
    racks = [];
    shooter = null;
    $("moneySetupTitle").textContent = game.label;
    renderSetup();
    UI.showScreen("screenMoneySetup");
  }

  function newPlayer(name) {
    return {
      id: "mp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: name || "",
    };
  }

  function addPlayer() {
    // 上限は置かない。台を囲む人数ぶん増やせる
    players.push(newPlayer(""));
    renderSetup();
  }

  function removePlayer(id) {
    if (players.length <= 2) {
      UI.toast("2人より少なくはできません。", "warn");
      return;
    }
    players = players.filter(function (p) { return p.id !== id; });
    delete handicaps[id];
    renderSetup();
  }

  function renderSetup() {
    const wrap = $("moneyPlayers");
    if (!wrap) return;
    UI.clear(wrap);

    players.forEach(function (p, i) {
      const row = UI.el("div", { class: "money-player-row" });
      const input = UI.el("input", {
        type: "text",
        class: "money-name",
        value: p.name,
        placeholder: (i + 1) + "人目の名前",
        autocomplete: "off",
      });
      input.addEventListener("input", function () {
        p.name = input.value;
        // 名前はハンデ欄の見出しにも出る。打つたびに全部描き直すと
        // 入力欄からフォーカスが外れるので、見出しだけ直す
        syncHandicapLabels();
      });
      row.appendChild(input);
      row.appendChild(
        UI.el("button", {
          type: "button",
          class: "small ghost",
          text: "消す",
          "aria-label": (i + 1) + "人目を消す",
          onclick: function () { removePlayer(p.id); },
        })
      );
      wrap.appendChild(row);
    });

    renderHandicapSetup();
  }

  /**
   * ハンデ球の割り当て。
   * 5番とキーボールは全員の得点球なので選ばせない
   * （選べると「自分だけの球」の意味が壊れる）。
   */
  function renderHandicapSetup() {
    const wrap = $("moneyHandicaps");
    if (!wrap) return;
    UI.clear(wrap);

    const taken = {};
    Object.keys(handicaps).forEach(function (pid) {
      (handicaps[pid] || []).forEach(function (b) { taken[b] = pid; });
    });

    players.forEach(function (p, i) {
      const mine = handicaps[p.id] || [];
      const chips = UI.el("div", { class: "chips bh-chips" });
      for (let n = 1; n <= 15; n++) {
        // 全員の得点球はハンデにできない
        if (n === 5 || n === game.keyBall) continue;
        const owner = taken[n];
        const isMine = mine.indexOf(n) >= 0;
        // ほかの人が持っている球は選べない（1つの球を2人で持てない）
        const disabled = !!owner && !isMine;
        const btn = UI.el("button", {
          type: "button",
          class: "chip small-chip",
          "aria-pressed": String(isMine),
          text: String(n),
          onclick: function () { toggleHandicap(p.id, n); },
        });
        if (disabled) btn.disabled = true;
        chips.appendChild(btn);
      }
      wrap.appendChild(
        UI.el("div", { class: "field money-hc", "data-pid": p.id }, [
          UI.el("label", {
            class: "money-hc-label",
            text: (p.name || (i + 1) + "人目") + " のハンデ球",
          }),
          chips,
        ])
      );
    });
  }

  /** 名前を打っている最中に見出しだけ追随させる */
  function syncHandicapLabels() {
    players.forEach(function (p, i) {
      const host = document.querySelector('.money-hc[data-pid="' + p.id + '"] .money-hc-label');
      if (host) host.textContent = (p.name || (i + 1) + "人目") + " のハンデ球";
    });
  }

  function toggleHandicap(pid, ball) {
    const cur = handicaps[pid] || [];
    handicaps[pid] = cur.indexOf(ball) >= 0
      ? cur.filter(function (b) { return b !== ball; })
      : cur.concat([ball]).sort(function (a, b) { return a - b; });
    renderHandicapSetup();
  }

  /* ---------- 試合 ---------- */

  function start() {
    // 名前が空の人は番号で呼ぶ。台の脇で入力が面倒なため強制しない
    players.forEach(function (p, i) {
      if (!p.name.trim()) p.name = (i + 1) + "人目";
    });
    const names = players.map(function (p) { return p.name.trim(); });
    const dup = names.some(function (n, i) { return names.indexOf(n) !== i; });
    if (dup) {
      UI.toast("同じ名前の人がいます。区別できる名前にしてください。", "warn");
      return;
    }
    shots = [];
    racks = [];
    shooter = players[0].id;
    $("moneyMatchTitle").textContent = game.label;
    renderMatch();
    UI.showScreen("screenMoneyMatch");
  }

  function renderMatch() {
    renderScores();
    renderShooter();
    renderBalls();
    renderLog();
    const sub = $("moneyMatchSub");
    if (sub) {
      sub.textContent = players.length + "人　" + (racks.length + 1) + "ラック目";
    }
    const undoBtn = $("moneyUndoBtn");
    if (undoBtn) undoBtn.disabled = !shots.length && !racks.length;
  }

  /** 持ち点。プラスマイナスが一目で分かるようにする */
  function renderScores() {
    const wrap = $("moneyScores");
    if (!wrap) return;
    UI.clear(wrap);
    const r = MONEY.tally(game, players, shots, handicaps, racks);
    players.forEach(function (p) {
      const v = r.totals[p.id] || 0;
      const card = UI.el("div", {
        class: "money-score" + (v > 0 ? " plus" : (v < 0 ? " minus" : "")),
        "data-pid": p.id,
      }, [
        UI.el("div", { class: "ms-name", text: p.name }),
        UI.el("div", { class: "ms-val", text: (v > 0 ? "+" : "") + v }),
      ]);
      wrap.appendChild(card);
    });
  }

  /** 落とした人を選ぶ。押した人に得点が入る */
  function renderShooter() {
    const wrap = $("moneyShooter");
    if (!wrap) return;
    UI.clear(wrap);
    players.forEach(function (p) {
      wrap.appendChild(
        UI.el("button", {
          type: "button",
          class: "money-pick",
          "data-pid": p.id,
          "aria-pressed": String(shooter === p.id),
          text: p.name,
          onclick: function () { shooter = p.id; renderMatch(); },
        })
      );
    });
  }

  /** 落とした球のボタン。いま選んでいる人が得点できる球だけ出す */
  function renderBalls() {
    const wrap = $("moneyBalls");
    if (!wrap) return;
    UI.clear(wrap);
    const hb = handicaps[shooter] || [];
    const balls = MONEY.scoringBalls(game, hb);
    const setId = currentBallSet();

    balls.forEach(function (n) {
      const ap = ballAppearance(setId, n);
      const per = MONEY.basePoint(game, n, hb);
      const btn = UI.el("button", {
        type: "button",
        class: "money-ball",
        "data-ball": String(n),
        title: n + "番（" + per + "点）",
        onclick: function () { record(n); },
      });
      btn.style.background = ap.band
        ? "linear-gradient(180deg," + ap.base + " 0 22%," + ap.band
          + " 22% 78%," + ap.base + " 78% 100%)"
        : ap.base;
      btn.style.color = ap.ink;
      btn.appendChild(UI.el("span", { class: "bb-num shape-" + ap.shape, text: String(n) }));
      btn.appendChild(UI.el("span", { class: "mb-pt", text: per + "点" }));
      wrap.appendChild(btn);
    });
  }

  function currentBallSet() {
    try {
      const st = STORE.getSettings() || {};
      if (st.ballSet && BALL_SETS[st.ballSet]) return st.ballSet;
    } catch (err) { /* 既定に倒す */ }
    return "standard";
  }

  function record(ball) {
    if (!shooter) {
      UI.toast("先に落とした人を選んでください。", "warn");
      return;
    }
    const side = !!($("moneySideChk") || {}).checked;
    shots.push({ by: shooter, ball: ball, side: side, voided: false });
    // サイドの印は1回ごとに戻す。付けっぱなしで倍が続くのを防ぐ
    if ($("moneySideChk")) $("moneySideChk").checked = false;
    renderMatch();
    const who = nameOf(shooter);
    const per = MONEY.pointPerOpponent(game, ball, handicaps[shooter] || [], side);
    UI.toast(who + " が " + ball + "番" + (side ? "（サイド）" : "")
      + "　1人あたり" + per + "点");
  }

  /**
   * ラックの終わり。撞き切った人がいればマスワリで倍になる。
   * 誰が撞き切ったかは記録から決められないので、その場で選ばせる。
   */
  function endRack() {
    const from = racks.length ? racks[racks.length - 1].at : 0;
    if (shots.length <= from) {
      UI.toast("このラックはまだ記録がありません。", "warn");
      return;
    }
    // このラックで得点した人だけがマスワリの候補になる
    const inRack = shots.slice(from).filter(function (s) { return !s.voided; });
    const cands = players.filter(function (p) {
      return inRack.some(function (s) { return s.by === p.id; });
    });

    const names = cands.map(function (p) { return p.name; }).join(" / ");
    const ans = window.prompt(
      "このラックを撞き切った人（マスワリ）がいれば名前を入れてください。\n"
        + "いなければ空のままOKを押してください。\n"
        + "候補: " + names,
      ""
    );
    if (ans === null) return; // キャンセル

    let runoutBy = null;
    const typed = (ans || "").trim();
    if (typed) {
      const hit = players.find(function (p) { return p.name === typed; });
      if (!hit) {
        UI.toast("「" + typed + "」が見つかりません。ラックはそのまま終了しました。", "warn");
      } else {
        runoutBy = hit.id;
      }
    }
    racks.push({ at: shots.length, runoutBy: runoutBy });
    renderMatch();
    UI.toast(runoutBy
      ? nameOf(runoutBy) + " のマスワリ。このラックの得点が倍になりました。"
      : "ラックを終了しました。");
  }

  function undo() {
    // ラックの区切りが最後なら、それを先に戻す
    if (racks.length && racks[racks.length - 1].at >= shots.length) {
      racks.pop();
      renderMatch();
      UI.toast("ラックの終了を取り消しました。");
      return;
    }
    if (!shots.length) {
      UI.toast("戻せる記録がありません。", "warn");
      return;
    }
    const s = shots.pop();
    // 区切りが宙に浮かないよう、記録より後ろの区切りは詰める
    racks = racks.filter(function (r) { return r.at <= shots.length; });
    renderMatch();
    UI.toast(nameOf(s.by) + " の " + s.ball + "番を取り消しました。");
  }

  function nameOf(id) {
    const p = players.find(function (x) { return x.id === id; });
    return p ? p.name : "";
  }

  /** 記録の履歴。あとから見て確かめられるようにする */
  function renderLog() {
    const wrap = $("moneyLog");
    if (!wrap) return;
    UI.clear(wrap);
    if (!shots.length) return;
    const bounds = MONEY.rackBounds(shots.length, racks);
    bounds.forEach(function (rk, i) {
      const items = [];
      for (let k = rk.from; k < rk.to; k++) {
        const s = shots[k];
        if (!s) continue;
        items.push(nameOf(s.by) + " " + s.ball + "番" + (s.side ? "(サイド)" : ""));
      }
      if (!items.length) return;
      wrap.appendChild(
        UI.el("div", { class: "money-log-row" }, [
          UI.el("span", {
            class: "mlr-head",
            text: (i + 1) + "R" + (rk.runoutBy ? "（" + nameOf(rk.runoutBy) + "のマスワリ）" : ""),
          }),
          UI.el("span", { class: "mlr-body", text: items.join("　") }),
        ])
      );
    });
  }

  function quit() {
    if (shots.length && !window.confirm("記録は保存されません。やめますか？")) return;
    players = [];
    handicaps = {};
    shots = [];
    racks = [];
    UI.showScreen("screenSetup");
  }

  return { open: open, render: renderMatch };
})();
