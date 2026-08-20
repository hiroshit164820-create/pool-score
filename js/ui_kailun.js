/**
 * ui_kailun.js — カイルン（複数人対応）
 *
 * カイルンは1番（黄）と3番・11番（赤）に当てていくハウスゲームで、
 * 公式の競技規程は存在しない（出典: Web CUE'S。04_種目ルール仕様.md 参照）。
 *
 * 2026-08-21 の指示で、次の5点をまとめて作り直した。
 *   1. 3人以上でも遊べるようにする（それまではA/B2人固定だった）
 *   2. 交代のボタンを1つにして、成功のボタンを大きくする
 *   3. 成功のボタンは押すたびに表示が変わる（何を狙う段階かが分かるように）
 *   4. スコアをタップして加点、長押しで減点できる
 *   5. 「1回の手順で」「ミスしたとき」の選択はやめる
 *
 * A/B2サイド前提の engine.js には人数を増やせないため、
 * 5-9 / 5-10（ui_money.js）と同じく専用画面として持つ。
 * 記録は 5-9 と同じ入れ物（STORE.saveMoneyResult）に残すので、
 * 履歴と「表計算へ」からそのまま読める。
 */
const KAILUNUI = (function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };

  /** 何段階当てれば1点になるか。data/rules_data.js の kailun.steps と揃える */
  const STEPS = 3;
  /** 選べる人数の上限。台の脇で名前を出せる範囲にする */
  const MAX_PLAYERS = 6;

  /**
   * 段階ごとの「次に何をするか」。
   * カイルンは1番が黄球、3番と11番が赤球（data/rules_data.js の balls）。
   * 本人の指示（2026-08-21）の文言をそのまま出す。
   */
  const STEP_LABELS = [
    { text: "赤→黄 or 黄→赤", dots: ["red", "yellow"] },
    { text: "赤→赤", dots: ["red", "red"] },
    { text: "全部（1点）", dots: ["red", "yellow", "red"] },
  ];

  let players = [];          // [{id, name}]
  let penaltyMode = "selfMinus"; // selfMinus | othersPlus
  let goal = 5;              // 何点先取で勝ちか
  let log = [];              // 取り消しできるよう、出来事を順に持つ
  let matchId = null;
  let startedAt = null;
  let bound = false;

  function uid() {
    return "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /* ============================================================
   * 状態の組み立て
   * ============================================================ */

  /**
   * 出来事の並びから、いまの持ち点・段階・手番を組み立てる。
   *
   * 画面はここが返した値だけを見る。取り消しは log を1つ削るだけで済む。
   */
  function reduce() {
    const scores = {};
    const step = {};
    players.forEach(function (p) { scores[p.id] = 0; step[p.id] = 1; });

    let idx = 0;
    const n = players.length || 1;

    log.forEach(function (ev) {
      const cur = players[idx] ? players[idx].id : null;
      if (ev.t === "ok" && cur) {
        if (step[cur] >= STEPS) {
          // 3段階そろったので1点。段階は最初に戻す
          scores[cur] += 1;
          step[cur] = 1;
        } else {
          step[cur] += 1;
        }
      } else if (ev.t === "penalty" && cur) {
        if (penaltyMode === "othersPlus") {
          players.forEach(function (p) { if (p.id !== cur) scores[p.id] += 1; });
        } else {
          scores[cur] -= 1;
        }
        step[cur] = 1;
        idx = (idx + 1) % n;
      } else if (ev.t === "turn" && cur) {
        // 交代すると段階は最初に戻る（本人の指示 2026-08-21）
        step[cur] = 1;
        idx = (idx + 1) % n;
      } else if (ev.t === "adjust" && scores[ev.pid] !== undefined) {
        scores[ev.pid] += ev.d;
      }
    });

    let winner = null;
    players.forEach(function (p) {
      if (winner === null && scores[p.id] >= goal) winner = p.id;
    });

    return { scores: scores, step: step, idx: idx, winner: winner };
  }

  function nameOf(pid) {
    const p = players.filter(function (x) { return x.id === pid; })[0];
    return p ? p.name : "";
  }

  /* ============================================================
   * 設定画面
   * ============================================================ */

  function open() {
    bindOnce();
    players = [newPlayer(""), newPlayer("")];
    penaltyMode = "selfMinus";
    goal = 5;
    log = [];
    matchId = null;
    startedAt = null;
    renderSetup();
    UI.showScreen("screenKailunSetup");
  }

  function newPlayer(name) {
    return { id: uid(), name: name || "" };
  }

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("kailunAddBtn").addEventListener("click", UI.guard(function () {
      if (players.length >= MAX_PLAYERS) {
        UI.toast(MAX_PLAYERS + "人までです。", "warn");
        return;
      }
      players.push(newPlayer(""));
      renderSetup();
    }));
    $("kailunStartBtn").addEventListener("click", UI.guard(start));
    $("kailunQuitBtn").addEventListener("click", UI.guard(quit));
    $("kailunUndoBtn").addEventListener("click", UI.guard(undo));
  }

  /** 登録済みのプレーヤー名（選びやすいように並べる） */
  function nameChoices() {
    const list = (STORE.listPlayers ? STORE.listPlayers() : []) || [];
    return list.map(function (p) { return p.name; }).filter(Boolean);
  }

  function renderSetup() {
    const wrap = $("kailunPlayers");
    UI.clear(wrap);

    const choices = nameChoices();
    players.forEach(function (p, i) {
      const row = UI.el("div", { class: "kl-prow" });
      const input = UI.el("input", {
        type: "text",
        value: p.name,
        placeholder: (i + 1) + "人目",
        "aria-label": (i + 1) + "人目の名前",
      });
      input.addEventListener("input", function () { p.name = input.value; });
      row.appendChild(input);

      if (choices.length) {
        const sel = UI.el("select", { "aria-label": "登録済みから選ぶ" });
        sel.appendChild(UI.el("option", { value: "", text: "選ぶ…" }));
        choices.forEach(function (n) {
          sel.appendChild(UI.el("option", { value: n, text: n }));
        });
        sel.addEventListener("change", function () {
          if (!sel.value) return;
          p.name = sel.value;
          input.value = sel.value;
          sel.value = "";
        });
        row.appendChild(sel);
      }

      if (players.length > 2) {
        row.appendChild(UI.el("button", {
          type: "button", class: "ghost small", text: "外す",
          onclick: function () {
            players = players.filter(function (x) { return x.id !== p.id; });
            renderSetup();
          },
        }));
      }
      wrap.appendChild(row);
    });

    $("kailunAddBtn").disabled = players.length >= MAX_PLAYERS;

    // 反則の扱い（公式規程が無いので店ごとに違う）
    const pen = $("kailunPenalty");
    UI.clear(pen);
    [["selfMinus", "自分が-1点"], ["othersPlus", "他の人に+1点"]].forEach(function (o) {
      pen.appendChild(UI.el("button", {
        type: "button",
        class: "chip",
        "aria-pressed": String(penaltyMode === o[0]),
        text: o[1],
        onclick: function () { penaltyMode = o[0]; renderSetup(); },
      }));
    });

    // 何点先取か
    const g = $("kailunGoal");
    UI.clear(g);
    [3, 5, 7, 10].forEach(function (v) {
      g.appendChild(UI.el("button", {
        type: "button",
        class: "chip",
        "aria-pressed": String(goal === v),
        text: v + "点先取",
        onclick: function () { goal = v; renderSetup(); },
      }));
    });
  }

  function start() {
    players.forEach(function (p, i) {
      if (!p.name.trim()) p.name = "プレーヤー" + (i + 1);
    });
    const names = players.map(function (p) { return p.name.trim(); });
    if (names.some(function (n, i) { return names.indexOf(n) !== i; })) {
      UI.toast("同じ名前が2人います。", "warn");
      return;
    }
    log = [];
    matchId = null;
    startedAt = new Date().toISOString();
    renderMatch();
    UI.showScreen("screenKailunMatch");
  }

  /* ============================================================
   * 試合画面
   * ============================================================ */

  function renderMatch() {
    const st = reduce();
    const sub = $("kailunSub");
    if (sub) sub.textContent = players.length + "人　" + goal + "点先取";

    renderScores(st);
    renderPad(st);
    renderLog();
    $("kailunUndoBtn").disabled = !log.length;
  }

  /**
   * 持ち点。タップで+1、長押しで-1（本人の指示 2026-08-21）。
   * 数え間違いをその場で直せるようにするための入口。
   */
  function renderScores(st) {
    const wrap = $("kailunScores");
    UI.clear(wrap);
    const top = Math.max.apply(null, players.map(function (p) { return st.scores[p.id]; }));

    players.forEach(function (p, i) {
      const isTurn = i === st.idx && !st.winner;
      const btn = UI.el("button", {
        type: "button",
        class: "kl-score" + (isTurn ? " is-turn" : "")
          + (st.scores[p.id] === top && top > 0 ? " is-top" : ""),
        "data-pid": p.id,
        "aria-label": p.name + " の持ち点。押すと1点、長押しで1点戻す",
      }, [
        UI.el("span", { class: "kl-name", text: p.name }),
        UI.el("span", { class: "kl-val", text: String(st.scores[p.id]) }),
      ]);
      bindScoreTap(btn, p.id);
      wrap.appendChild(btn);
    });
  }

  // 長押しで減点したあと、指を離したときの click で足し戻されないようにする。
  // 減点すると画面を描き直すのでボタンが別物に入れ替わり、
  // ボタン側の目印（held）では防げない。時刻で見張る
  let lastLongPressAt = 0;
  const LONG_MS = 500;
  const TAP_BLOCK_MS = 600;

  /** タップで+1、長押しで-1。試合画面のスコアと同じ操作にそろえる */
  function bindScoreTap(btn, pid) {
    let timer = null;

    function down() {
      timer = setTimeout(function () {
        timer = null;
        lastLongPressAt = Date.now();
        adjust(pid, -1);
      }, LONG_MS);
    }
    function up() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("click", function () {
      if (Date.now() - lastLongPressAt < TAP_BLOCK_MS) return;
      adjust(pid, 1);
    });
  }

  function adjust(pid, d) {
    const before = reduce();
    if (before.winner) {
      UI.toast("この試合はもう決まっています。", "warn");
      return;
    }
    log.push({ t: "adjust", pid: pid, d: d });
    after(nameOf(pid) + (d > 0 ? " に1点入れました。" : " から1点戻しました。"));
  }

  /**
   * 操作のボタン。
   * 「成功」を大きく1つ、「交代」を1つ、「反則」を1つ。
   * 以前は交代のボタンが2つ（ミス（交代）と画面下の交代）あった（本人の指摘）。
   */
  function renderPad(st) {
    const wrap = $("kailunPad");
    UI.clear(wrap);

    const cur = players[st.idx];
    if (!cur) return;

    if (st.winner) {
      wrap.appendChild(UI.el("p", { class: "kl-win", text: nameOf(st.winner) + " の勝ちです。" }));
      wrap.appendChild(UI.el("button", {
        type: "button", class: "primary kl-finish", text: "終わって保存する",
        onclick: UI.guard(quit),
      }));
      return;
    }

    const stepNo = st.step[cur.id] || 1;
    const label = STEP_LABELS[Math.min(stepNo, STEPS) - 1];

    wrap.appendChild(UI.el("div", { class: "kl-who" }, [
      UI.el("span", { class: "kl-who-name", text: cur.name }),
      UI.el("span", { class: "kl-who-step", text: stepNo + " / " + STEPS + "段目" }),
    ]));

    // 成功のボタン。押すたびに次の段階の内容に変わる
    const ok = UI.el("button", {
      type: "button",
      class: "kl-ok",
      onclick: UI.guard(function () { record("ok"); }),
    });
    const dots = UI.el("span", { class: "kl-dots" });
    label.dots.forEach(function (c, i) {
      if (i > 0) dots.appendChild(UI.el("span", { class: "kl-arrow", text: "→" }));
      dots.appendChild(UI.el("i", { class: "kl-dot is-" + c }));
    });
    ok.appendChild(dots);
    ok.appendChild(UI.el("span", { class: "kl-ok-text", text: label.text }));
    wrap.appendChild(ok);

    const row = UI.el("div", { class: "kl-row" });
    row.appendChild(UI.el("button", {
      type: "button", class: "kl-sub", text: "交代",
      onclick: UI.guard(function () { record("turn"); }),
    }));
    row.appendChild(UI.el("button", {
      type: "button", class: "kl-sub is-foul", text: "反則",
      onclick: UI.guard(function () { record("penalty"); }),
    }));
    wrap.appendChild(row);
  }

  function record(kind) {
    const before = reduce();
    if (before.winner) {
      UI.toast("この試合はもう決まっています。", "warn");
      return;
    }
    const cur = players[before.idx];
    log.push({ t: kind });

    const now = reduce();
    let msg = "";
    if (kind === "ok") {
      msg = now.scores[cur.id] > before.scores[cur.id]
        ? cur.name + " が1点取りました。"
        : cur.name + " 成功。次の段階です。";
    } else if (kind === "turn") {
      msg = "交代 → " + (players[now.idx] ? players[now.idx].name : "");
    } else {
      msg = cur.name + " の反則を記録しました。";
    }
    after(msg);
  }

  function after(msg) {
    renderMatch();
    if (msg) UI.toast(msg);
    const st = reduce();
    if (st.winner) UI.toast(nameOf(st.winner) + " の勝ちです。");
  }

  function undo() {
    if (!log.length) return;
    log.pop();
    renderMatch();
    UI.toast("1つ前に戻しました。");
  }

  function renderLog() {
    const wrap = $("kailunLog");
    if (!wrap) return;
    UI.clear(wrap);
    if (!log.length) {
      wrap.appendChild(UI.el("p", { class: "hint", text: "まだ記録はありません。" }));
      return;
    }
    // 直近の10手だけ出す。台の脇では古い手まで遡らない
    const recent = log.slice(-10).reverse();
    recent.forEach(function (ev) {
      const text = ev.t === "adjust"
        ? nameOf(ev.pid) + (ev.d > 0 ? " +1" : " -1")
        : (ev.t === "ok" ? "成功" : (ev.t === "turn" ? "交代" : "反則"));
      wrap.appendChild(UI.el("div", { class: "kl-logrow", text: text }));
    });
  }

  /**
   * やめる。記録は自動で保存する（5-9と同じ扱い）。
   * 台の脇で押したときに戻せないため、捨てずに残す。
   */
  function quit() {
    const saved = saveResult();
    UI.toast(saved ? "カイルンの記録を保存しました。" : "記録はありません。");
    if (typeof HISTORY !== "undefined" && saved) HISTORY.open();
    else UI.showScreen("screenSetup");
  }

  function saveResult() {
    if (!log.length) return null;
    const st = reduce();
    const saved = STORE.saveMoneyResult({
      id: matchId,
      gameId: "kailun",
      gameLabel: "カイルン",
      createdAt: startedAt,
      racks: 0,
      players: players.map(function (p) {
        return { name: p.name, score: st.scores[p.id] || 0, handicapBalls: [] };
      }),
    });
    if (saved) matchId = saved.id;
    return saved;
  }

  return { open: open, reduce: reduce, STEP_LABELS: STEP_LABELS };
})();
