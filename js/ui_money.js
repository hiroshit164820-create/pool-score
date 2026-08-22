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
  /** ハンデを使うか { playerId: bool }。既定は使わない（本人の指示 2026-08-20） */
  let handicapOn = {};
  /** 得点の記録 [{ by, pts, voided }]（相手1人あたりの点） */
  let shots = [];
  /** ラックの区切り [{ at, runoutBy }] */
  let racks = [];
  // いま進んでいるラックで撞き切った人（マスワリ）。
  // 名前の下のボタンで選ぶ。選んだ時点でそのラックの得点が倍になる
  // （本人の指示 2026-08-21）
  let pendingRunout = null;
  /** いま選んでいる「落とした人」 */
  let shooter = null;
  /** 保存する結果のID。同じ試合を何度保存しても1件にまとまるよう持つ */
  let matchId = null;
  let startedAt = null;

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
      handicapOn = {};
    }
    shots = [];
    racks = [];
    pendingRunout = null;
    pendingRunout = null;
    pendingRunout = null;
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
    delete handicapOn[id];
    renderSetup();
  }

  /**
   * 名前の候補を3つに分ける（本人の指示 2026-08-20）。
   *
   *   self   自分
   *   recent 最近この種目（5-9系）をやった人を5人まで
   *   rest   それ以外。あいうえお順でプルダウンに入れる
   *
   * ボタンに全員を並べると、登録が増えたときに探せなくなる。
   */
  function nameChoices() {
    const self = STORE.getSelf ? STORE.getSelf() : null;
    const selfName = self ? self.name : null;

    // 5-9系の記録から、新しい順に名前を拾う
    const recent = [];
    const seen = {};
    if (selfName) seen[selfName] = true;
    (STORE.listMoneyResults ? STORE.listMoneyResults() : []).forEach(function (m) {
      (m.players || []).forEach(function (p) {
        if (!p.name || seen[p.name] || recent.length >= 5) return;
        seen[p.name] = true;
        recent.push(p.name);
      });
    });

    // まだ5人に足りなければ、登録の新しい順で埋める。
    // 5-9をやったことが無いうちは履歴が空で、ボタンが1つも出なくなるため
    const registered = STORE.listPlayers();
    for (let i = registered.length - 1; i >= 0 && recent.length < 5; i--) {
      const n = registered[i].name;
      if (!n || seen[n]) continue;
      seen[n] = true;
      recent.push(n);
    }

    // 残りは登録済みの選手から。あいうえお順
    const rest = registered
      .map(function (p) { return p.name; })
      .filter(function (n) { return n && !seen[n]; })
      .sort(function (a, b) { return a.localeCompare(b, "ja"); });

    return { self: selfName, recent: recent, rest: rest };
  }

  /** すでに他の欄に入っている名前（同じ人を2回選ばせない） */
  function takenNames(exceptId) {
    return players
      .filter(function (p) { return p.id !== exceptId && p.name.trim(); })
      .map(function (p) { return p.name.trim(); });
  }

  /** 名前を選ぶ欄（ボタン＋プルダウン）を1人ぶん作る */
  function namePicker(p) {
    const choices = nameChoices();
    const taken = takenNames(p.id);
    const box = UI.el("div", { class: "money-name-pick" });

    const quick = [];
    if (choices.self) quick.push({ name: choices.self, self: true });
    choices.recent.forEach(function (n) { quick.push({ name: n, self: false }); });

    const chips = UI.el("div", { class: "chips picker" });
    quick.forEach(function (q) {
      if (taken.indexOf(q.name) >= 0) return;
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip small-chip picker-chip"
            + (p.name.trim() === q.name ? " is-chosen" : ""),
          "aria-pressed": String(p.name.trim() === q.name),
          onclick: function () {
            p.name = q.name;
            renderSetup();
          },
        }, [
          UI.el("span", { class: "pc-name", text: q.name }),
          q.self ? UI.el("span", { class: "pc-sl", text: "自分" }) : null,
        ])
      );
    });
    if (chips.children.length) box.appendChild(chips);

    const rest = choices.rest.filter(function (n) { return taken.indexOf(n) < 0; });
    if (rest.length) {
      const sel = UI.el("select", { class: "picker-select" });
      sel.appendChild(UI.el("option", { value: "", text: "ほかの人から選ぶ（" + rest.length + "人）" }));
      rest.forEach(function (n) { sel.appendChild(UI.el("option", { value: n, text: n })); });
      sel.addEventListener("change", function () {
        if (!sel.value) return;
        p.name = sel.value;
        renderSetup();
      });
      box.appendChild(sel);
    }
    return box.children.length ? box : null;
  }

  function renderSetup() {
    const wrap = $("moneyPlayers");
    if (!wrap) return;
    UI.clear(wrap);

    players.forEach(function (p, i) {
      const holder = UI.el("div", { class: "money-player" });
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
      holder.appendChild(row);
      const pick = namePicker(p);
      if (pick) holder.appendChild(pick);
      wrap.appendChild(holder);
    });

    renderHandicapSetup();
  }

  /**
   * ハンデ球にできる番号（本人の指示 2026-08-20）。
   *
   * 5-9 なら9番以降、5-10 なら10番以降は出さない。
   * それらは全員の得点球（またはその先の球）で、
   * 「その人だけの球」にはできないため。
   * 5番も全員の得点球なので外す。
   */
  function handicapCandidates() {
    const out = [];
    for (let n = 1; n < game.keyBall; n++) {
      if (n === 5) continue;
      out.push(n);
    }
    return out;
  }

  /**
   * ハンデ球の割り当て。
   *
   * まず人ごとに「ハンデなし／あり」を選ぶ。既定はなし（本人の指示 2026-08-20）。
   * 「あり」にしたときだけ番号のボタンを出す。
   * 使わない人にまで15個の番号を並べると、何を設定する欄なのか分からなくなるため。
   */
  function renderHandicapSetup() {
    const wrap = $("moneyHandicaps");
    if (!wrap) return;
    UI.clear(wrap);

    const taken = {};
    Object.keys(handicaps).forEach(function (pid) {
      if (!handicapOn[pid]) return;
      (handicaps[pid] || []).forEach(function (b) { taken[b] = pid; });
    });

    players.forEach(function (p, i) {
      const on = !!handicapOn[p.id];
      const mine = handicaps[p.id] || [];

      const toggle = UI.el("div", { class: "toggle-group money-hc-toggle" }, [
        UI.el("button", {
          type: "button", "data-v": "off", "aria-pressed": String(!on), text: "ハンデなし",
          onclick: function () { setHandicapOn(p.id, false); },
        }),
        UI.el("button", {
          type: "button", "data-v": "on", "aria-pressed": String(on), text: "ハンデあり",
          onclick: function () { setHandicapOn(p.id, true); },
        }),
      ]);

      const field = UI.el("div", { class: "field money-hc", "data-pid": p.id }, [
        UI.el("label", {
          class: "money-hc-label",
          text: (p.name || (i + 1) + "人目") + " のハンデ球",
        }),
        toggle,
      ]);

      // 「あり」のときだけ番号を出す
      if (on) {
        const chips = UI.el("div", { class: "chips bh-chips" });
        handicapCandidates().forEach(function (n) {
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
        });
        field.appendChild(chips);
      }
      wrap.appendChild(field);
    });
  }

  function setHandicapOn(pid, on) {
    handicapOn[pid] = !!on;
    // 「なし」に戻したら番号も外す。設定だけ残ると、
    // 次に「あり」にしたとき身に覚えのない球が付いてくる
    if (!on) handicaps[pid] = [];
    renderHandicapSetup();
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
    matchId = null;
    startedAt = new Date().toISOString();
    $("moneyMatchTitle").textContent = game.label;
    renderMatch();
    UI.showScreen("screenMoneyMatch");
  }

  function renderMatch() {
    renderScores();
    renderShooter();
    renderPointButtons();
    renderLog();
    const sub = $("moneyMatchSub");
    if (sub) {
      sub.textContent = players.length + "人　" + (racks.length + 1) + "ラック目";
    }
    const undoBtn = $("moneyUndoBtn");
    if (undoBtn) undoBtn.disabled = !shots.length && !racks.length;
  }

  /** 持ち点。プラスマイナスが一目で分かるようにする */
  /**
   * 集計に渡すラックの区切り。
   *
   * まだ終えていないラックでマスワリを選んでいるときは、
   * 仮の区切りを足して「いまの点」に倍を反映させる。
   * ここで足した仮の区切りは保存しない（endRack で本物を積む）。
   */
  function liveRacks() {
    if (!pendingRunout) return racks;
    const from = racks.length ? racks[racks.length - 1].at : 0;
    if (shots.length <= from) return racks;
    return racks.concat([{ at: shots.length, runoutBy: pendingRunout }]);
  }

  function renderScores() {
    const wrap = $("moneyScores");
    if (!wrap) return;
    UI.clear(wrap);
    const r = MONEY.tally(game, players, shots, handicaps, liveRacks());
    players.forEach(function (p) {
      const v = r.totals[p.id] || 0;
      const card = UI.el("div", {
        class: "money-score" + (v > 0 ? " plus" : (v < 0 ? " minus" : "")),
        "data-pid": p.id,
      }, [
        UI.el("div", { class: "ms-name", text: p.name }),
        UI.el("div", { class: "ms-val", text: (v > 0 ? "+" : "") + v }),
      ]);
      // 誰が何番を持っているかはここに出す（本人の指示 2026-08-20）。
      // 台の脇で見るのはこの1か所で足りるので、別の欄は置かない
      const hb = (handicapOn[p.id] && handicaps[p.id]) || [];
      if (hb.length) {
        card.appendChild(
          UI.el("div", { class: "ms-hc", text: "ハンデ " + hb.join("・") + "番" })
        );
      }
      // マスワリ。押すとこのラックの得点が倍になる（本人の指示 2026-08-21）。
      // 誰の記録かを置き場所で示すため、その人の名前の下に置く
      const on = pendingRunout === p.id;
      card.appendChild(
        UI.el("button", {
          type: "button",
          class: "ms-masu" + (on ? " is-on" : ""),
          "aria-pressed": on ? "true" : "false",
          text: on ? "マスワリ ✓" : "マスワリ",
          onclick: function () {
            pendingRunout = on ? null : p.id;
            renderMatch();
            UI.toast(on
              ? nameOf(p.id) + " のマスワリを取り消しました。"
              : nameOf(p.id) + " のマスワリ。このラックの得点が倍になります。");
          },
        })
      );
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

  /**
   * 得点のボタン。球をタップする方式から、点を直接入れる方式に変えた
   * （本人の指示 2026-08-20）。
   *
   * サイドで倍、マスワリで倍と倍々に増えるゲームなので、
   * 動く額は +1 / +2 / +4 / +8 / +16 で足りる。
   * 打ち間違いの戻しに -1 / -2 を別の行で置く。
   */
  function renderPointButtons() {
    [["moneyPlus", MONEY.PLUS_POINTS], ["moneyMinus", MONEY.MINUS_POINTS]]
      .forEach(function (pair) {
        const wrap = $(pair[0]);
        if (!wrap) return;
        UI.clear(wrap);
        pair[1].forEach(function (v) {
          wrap.appendChild(
            UI.el("button", {
              type: "button",
              class: "money-pt" + (v < 0 ? " minus" : ""),
              "data-pts": String(v),
              text: (v > 0 ? "+" : "") + v,
              onclick: function () { record(v); },
            })
          );
        });
      });
  }

  function currentBallSet() {
    try {
      const st = STORE.getSettings() || {};
      if (st.ballSet && BALL_SETS[st.ballSet]) return st.ballSet;
    } catch (err) { /* 既定に倒す */ }
    return "standard";
  }

  function record(pts) {
    if (!shooter) {
      UI.toast("先に落とした人を選んでください。", "warn");
      return;
    }
    shots.push({ by: shooter, pts: pts, voided: false });
    renderMatch();
    const others = players.length - 1;
    UI.toast(nameOf(shooter) + " に " + (pts > 0 ? "+" : "") + pts
      + "点（" + others + "人ぶんで " + (pts > 0 ? "+" : "") + (pts * others) + "点）");
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
    // 撞き切った人は、名前の下の「マスワリ」で選んである。
    // ここで聞き直さない（本人の指示 2026-08-21）
    const runoutBy = pendingRunout;
    racks.push({ at: shots.length, runoutBy: runoutBy });
    pendingRunout = null;
    renderMatch();
    UI.toast(runoutBy
      ? nameOf(runoutBy) + " のマスワリ。このラックの得点が倍になりました。"
      : "次のラックへ進みました。");
  }

  function undo() {
    // ラックの区切りが最後なら、それを先に戻す
    if (racks.length && racks[racks.length - 1].at >= shots.length) {
      const gone = racks.pop();
      // 選んでいたマスワリごと戻す（選び直さずに済むように）
      pendingRunout = (gone && gone.runoutBy) || null;
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
    const label = typeof s.pts === "number"
      ? ((s.pts > 0 ? "+" : "") + s.pts + "点")
      : (s.ball + "番");
    UI.toast(nameOf(s.by) + " の " + label + " を取り消しました。");
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
    const bounds = MONEY.rackBounds(shots.length, liveRacks());
    bounds.forEach(function (rk, i) {
      const items = [];
      for (let k = rk.from; k < rk.to; k++) {
        const s = shots[k];
        if (!s) continue;
        const v = MONEY.shotPoints(game, s, handicaps);
        items.push(nameOf(s.by) + " " + (v > 0 ? "+" : "") + v);
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

  /**
   * いまの最終結果を保存する。
   *
   * 記録するのは「その試合の最終結果だけ」（本人の指示 2026-08-20）。
   * 1球ずつの記録は保存しない。誰が何点で終わったかが残れば足りる。
   */
  function saveResult() {
    if (!shots.length) return null;
    const r = MONEY.tally(game, players, shots, handicaps, liveRacks());
    // 1ラック内の最大得点（本人の指示 2026-08-22）。
    // tally の moves はラックごとに「誰が相手1人あたり何点得たか」を1件ずつ積む。
    // 実際に得た点は per × 相手の人数なので、その最大を人ごとに取る。
    // 最終得点（totals）は試合ぶんの合計なので、ここでは使えない
    const maxRack = {};
    (r.moves || []).forEach(function (mv) {
      const got = mv.per * mv.from;
      if (maxRack[mv.by] === undefined || got > maxRack[mv.by]) maxRack[mv.by] = got;
    });
    const saved = STORE.saveMoneyResult({
      id: matchId,
      gameId: game.id,
      gameLabel: game.label,
      createdAt: startedAt,
      racks: racks.length + (shots.length > (racks.length ? racks[racks.length - 1].at : 0) ? 1 : 0),
      players: players.map(function (p) {
        // マスワリの回数。ラックの区切りに残してある
        // （本人の指示 2026-08-21・種目別の成績で使う）。
        // 途中でやめたときのために、まだ確定していないラックぶんも数える
        const mine = liveRacks().filter(function (rk) { return rk.runoutBy === p.id; });
        return {
          name: p.name,
          score: r.totals[p.id] || 0,
          masuwari: mine.length,
          // 1度も得点していない人は null（0点と「記録なし」を分けるため）
          maxRackScore: maxRack[p.id] === undefined ? null : maxRack[p.id],
          handicapBalls: (handicapOn[p.id] && handicaps[p.id]) || [],
        };
      }),
    });
    // 同じ試合を何度保存しても1件にまとまるようIDを覚える
    if (saved) matchId = saved.id;
    return saved;
  }

  /**
   * やめる。記録は自動で保存する（本人の指示 2026-08-20）。
   * 以前は「保存されません」と断ってから捨てていたが、
   * 台の脇で押したときに戻せないため保存に変えた。
   */
  function quit() {
    const saved = saveResult();
    players = [];
    handicaps = {};
    handicapOn = {};
    shots = [];
    racks = [];
    matchId = null;
    UI.showScreen("screenSetup");
    UI.toast(saved ? "この試合の結果を保存しました。" : "記録が無いので保存していません。");
  }

  return { open: open, render: renderMatch };
})();
