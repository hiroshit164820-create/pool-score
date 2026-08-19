/**
 * ui_setup.js — 試合作成画面
 *
 * Phase 1.0 では 9ボール／10ボール／8ボール（＋ダブルス）に対応する。
 * 種目の出し分けは games_data.js のフラグから自動生成し、ここに種目名の分岐を書かない。
 */

/* ---------- 共通ヘルパ（他のUIモジュールからも使う） ---------- */
const UI = (function () {
  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /** トグルグループ: 押された値を返し、見た目を更新する */
  function bindToggle(container, onChange) {
    container.addEventListener("click", function (e) {
      const btn = e.target.closest("button[data-v]");
      if (!btn || !container.contains(btn)) return;
      Array.prototype.forEach.call(container.querySelectorAll("button[data-v]"), function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      if (onChange) onChange(btn.getAttribute("data-v"));
    });
  }

  function toggleValue(container) {
    const on = container.querySelector('button[data-v][aria-pressed="true"]');
    return on ? on.getAttribute("data-v") : null;
  }

  function setToggle(container, value) {
    Array.prototype.forEach.call(container.querySelectorAll("button[data-v]"), function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-v") === value ? "true" : "false");
    });
  }

  let toastTimer = null;
  function toast(message, kind) {
    const wrap = $("toastWrap");
    const t = el("div", { class: "toast" + (kind ? " " + kind : ""), text: message });
    wrap.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
    }, 2600);
  }

  function showScreen(id) {
    // 画面はDOMから拾う（画面を足したときに列挙を直し忘れないように）
    const screens = document.querySelectorAll("section.screen");
    Array.prototype.forEach.call(screens, function (node) {
      node.classList.toggle("active", node.id === id);
    });
    window.scrollTo(0, 0);
  }

  /** 直近と同じボタンの連打を無視する（誤タップ防止） */
  function guard(fn, ms) {
    let last = 0;
    return function () {
      const now = Date.now();
      if (now - last < (ms || 200)) return;
      last = now;
      return fn.apply(this, arguments);
    };
  }

  return {
    $: $, el: el, clear: clear,
    bindToggle: bindToggle, toggleValue: toggleValue, setToggle: setToggle,
    toast: toast, showScreen: showScreen, guard: guard,
  };
})();

/* ---------- 試合作成画面 ---------- */
const SETUP = (function () {
  const $ = UI.$;

  // Phase 1.0 で出す種目（実装済みのものだけ並べる）
  // 画面に出す種目。data/games_data.js に定義があるものだけ並べる
  const AVAILABLE = [
    "9ball", "9ball_doubles", "10ball", "10ball_doubles", "8ball", "straight",
    "jpa_9ball", "jpa_9ball_doubles", "jpa_8ball",
  ];

  let selectedGame = "9ball";
  let goalMode = "same"; // same | handicap
  let goalValues = { A: 5, B: 5 };
  // JPA用。スキルレベルから持ち点を自動算出する
  let skillLevels = { A: 5, B: 5 };

  function init() {
    renderGameChips();
    UI.bindToggle($("breakTypeToggle"), function () {});
    UI.bindToggle($("firstSideToggle"), function () {});
    UI.bindToggle($("clockTypeToggle"), function (v) {
      // ショットクロックとチェスクロックは同時には使わない
      $("scDetail").hidden = v !== "shot";
      $("ccDetail").hidden = v !== "chess";
    });
    UI.bindToggle($("scModeToggle"), function () {});
    $("startMatchBtn").addEventListener("click", UI.guard(startMatch));
    selectGame("9ball");
  }

  function renderGameChips() {
    const wrap = $("gameChips");
    UI.clear(wrap);
    AVAILABLE.forEach(function (id) {
      const g = GAMES[id];
      wrap.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip",
          "data-game": id,
          "aria-pressed": String(id === selectedGame),
          text: g.label,
          onclick: function () {
            selectGame(id);
          },
        })
      );
    });
  }

  function selectGame(id) {
    selectedGame = id;
    Array.prototype.forEach.call($("gameChips").querySelectorAll(".chip"), function (c) {
      c.setAttribute("aria-pressed", String(c.getAttribute("data-game") === id));
    });
    const g = GAMES[id];
    const base = BASE_RULES[g.base];

    // 種目ごとの注意書き（規程に基づく事実のみ）
    const notes = [];
    if (!base.hasBreakAce && base.keyBall) {
      notes.push(
        base.label + "では" + base.keyBall + "番を必ずフットスポットに戻すため、ブレイクエースはありません。"
      );
    }
    if (base.safetyCallable === false) {
      notes.push("10ボールは2026年6月のルール改定でセーフティコールが廃止されました。");
    }
    $("gameNote").textContent = notes.join(" ");

    // ブレイク方式の既定値
    UI.setToggle($("breakTypeToggle"), base.defaultBreakType);
    $("breakTypeNote").textContent =
      base.defaultBreakType === "winner"
        ? "この種目は勝者ブレイクが一般的です。"
        : "この種目は交互ブレイクが一般的です。";

    // 種目に合った既定値にする（ラック先取か点数先取かで桁が違う）
    const preset = (g.goalPresets && g.goalPresets[0]) || null;
    if (preset) goalValues = { A: preset.v, B: preset.v };

    renderPlayerFields();
    renderGoalArea();
  }

  /** 登録済みプレーヤーを選ぶボタン列。押すと名前欄に入る */
  function playerPicker(targetId) {
    const players = STORE.listPlayers();
    if (!players.length) return null;
    const chips = UI.el("div", { class: "chips picker" });
    players.forEach(function (p) {
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip small-chip",
          text: p.name,
          onclick: function () {
            const node = $(targetId);
            if (node) node.value = p.name;
          },
        })
      );
    });
    return chips;
  }

  function renderPlayerFields() {
    const g = GAMES[selectedGame];
    const wrap = $("playerFields");
    UI.clear(wrap);
    const per = g.playersPerSide;

    [["A", "プレーヤーA"], ["B", "プレーヤーB"]].forEach(function (pair) {
      const side = pair[0];
      if (per === 1) {
        const field = UI.el("div", { class: "field" }, [
          UI.el("label", { text: pair[1] + " の名前" }),
          UI.el("input", { type: "text", id: "inName" + side, placeholder: pair[1] }),
        ]);
        const picker = playerPicker("inName" + side);
        if (picker) field.appendChild(picker);
        wrap.appendChild(field);
      } else {
        const field = UI.el("div", { class: "field" }, [
          UI.el("label", { text: (side === "A" ? "チームA" : "チームB") + " の2人" }),
          UI.el("div", { class: "row" }, [
            UI.el("input", { type: "text", id: "inName" + side, placeholder: "1人目" }),
            UI.el("input", { type: "text", id: "inName" + side + "2", placeholder: "2人目" }),
          ]),
        ]);
        const p1 = playerPicker("inName" + side);
        if (p1) {
          field.appendChild(UI.el("p", { class: "hint", text: "1人目に入れる:" }));
          field.appendChild(p1);
          const p2 = playerPicker("inName" + side + "2");
          field.appendChild(UI.el("p", { class: "hint", text: "2人目に入れる:" }));
          field.appendChild(p2);
        }
        wrap.appendChild(field);
      }
    });
  }

  function renderGoalArea() {
    const g = GAMES[selectedGame];
    const wrap = $("goalArea");
    UI.clear(wrap);

    // JPAはスキルレベルから持ち点が決まるため、専用のUIにする
    if (g.goal === "jpaSL" || g.goal === "jpaSL8") {
      renderJpaGoalArea(g, wrap);
      return;
    }

    const unit = g.goalType === "racks" ? "ラック" : "点";
    const presets = g.goalPresets || [];

    // プリセット
    if (presets.length) {
      const chips = UI.el("div", { class: "chips" });
      presets.forEach(function (p) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            text: p.label,
            onclick: function () {
              goalValues = { A: p.v, B: p.v };
              goalMode = "same";
              renderGoalArea();
            },
          })
        );
      });
      wrap.appendChild(UI.el("div", { class: "field" }, [UI.el("label", { text: "よく使う設定" }), chips]));
    }

    // ハンデの有無
    const modeToggle = UI.el("div", { class: "toggle-group" }, [
      UI.el("button", { type: "button", "data-v": "same", "aria-pressed": String(goalMode === "same"), text: "ハンデなし" }),
      UI.el("button", { type: "button", "data-v": "handicap", "aria-pressed": String(goalMode === "handicap"), text: "ハンデあり" }),
    ]);
    UI.bindToggle(modeToggle, function (v) {
      goalMode = v;
      if (v === "same") goalValues.B = goalValues.A;
      renderGoalArea();
    });
    wrap.appendChild(UI.el("div", { class: "field" }, [UI.el("label", { text: "ハンデ" }), modeToggle]));

    if (goalMode === "same") {
      const input = UI.el("input", {
        type: "number", id: "goalSame", min: "1", max: "999", value: String(goalValues.A),
      });
      input.addEventListener("input", function () {
        const v = parseInt(input.value, 10);
        if (!isNaN(v)) goalValues = { A: v, B: v };
      });
      wrap.appendChild(
        UI.el("div", { class: "field" }, [UI.el("label", { text: "何" + unit + "先取で勝ちか" }), input])
      );
    } else {
      const inA = UI.el("input", { type: "number", id: "goalA", min: "1", max: "999", value: String(goalValues.A) });
      const inB = UI.el("input", { type: "number", id: "goalB", min: "1", max: "999", value: String(goalValues.B) });
      inA.addEventListener("input", function () {
        const v = parseInt(inA.value, 10);
        if (!isNaN(v)) goalValues.A = v;
      });
      inB.addEventListener("input", function () {
        const v = parseInt(inB.value, 10);
        if (!isNaN(v)) goalValues.B = v;
      });
      wrap.appendChild(
        UI.el("div", { class: "row" }, [
          UI.el("div", { class: "field" }, [UI.el("label", { text: "Aの目標（" + unit + "）" }), inA]),
          UI.el("div", { class: "field" }, [UI.el("label", { text: "Bの目標（" + unit + "）" }), inB]),
        ])
      );
      wrap.appendChild(
        UI.el("p", { class: "hint", text: "実力差があるときは、強い側の数字を大きくします。" })
      );
    }
  }

  /**
   * JPAの勝利条件UI。
   * スキルレベルを選ぶと、公式表から持ち点（9ボール）または先取ゲーム数（8ボール）が決まる。
   * 数値は data/handicap_data.js（JPA公式・APA公式で確認済み）から引く。
   */
  function renderJpaGoalArea(g, wrap) {
    UI.clear(wrap); // 再描画のたびに作り直す（古い表示が残らないように）
    const is8 = g.goal === "jpaSL8";
    const isDoubles = g.playersPerSide === 2;

    // 選べるスキルレベルの範囲（8ボールは2〜7、9ボールは1〜9）
    const range = is8 ? [2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6, 7, 8, 9];

    ["A", "B"].forEach(function (side) {
      const chips = UI.el("div", { class: "chips" });
      range.forEach(function (sl) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            text: "SL" + sl,
            "aria-pressed": String(skillLevels[side] === sl),
            onclick: function () {
              skillLevels[side] = sl;
              renderJpaGoalArea(g, wrap);
            },
          })
        );
      });
      const label = isDoubles
        ? (side === "A" ? "チームA" : "チームB") + " のスキルレベル（2人の合計）"
        : (side === "A" ? "プレーヤーA" : "プレーヤーB") + " のスキルレベル";
      const holder = UI.el("div", { class: "field" }, [UI.el("label", { text: label }), chips]);
      wrap.appendChild(holder);
    });

    // 算出結果を表示する
    let targets = null;
    let err = null;
    try {
      targets = is8
        ? jpaGoal8Ball(skillLevels.A, skillLevels.B)
        : jpaGoal9Ball(skillLevels.A, skillLevels.B, isDoubles);
    } catch (e) {
      err = e && e.message ? e.message : "算出できません";
    }

    if (targets) {
      goalValues = { A: targets.A, B: targets.B };
      const unit = is8 ? "ゲーム先取" : "点";
      wrap.appendChild(
        UI.el("div", { class: "field" }, [
          UI.el("label", { text: "この組み合わせの勝利条件" }),
          UI.el("p", {
            class: "jpa-result",
            text: "SL" + skillLevels.A + " → " + targets.A + unit + "　／　SL" +
              skillLevels.B + " → " + targets.B + unit,
          }),
        ])
      );
      wrap.appendChild(
        UI.el("p", {
          class: "hint",
          text: is8
            ? "JPA（APA）の公式対戦表から自動で決まります。"
            : "JPA公式のスキルレベル別持ち点から自動で決まります。",
        })
      );
    } else {
      wrap.appendChild(UI.el("p", { class: "hint warn", text: err || "算出できません" }));
    }

    if (isDoubles) {
      wrap.appendChild(
        UI.el("p", {
          class: "hint",
          text: "ダブルスのスキルレベルは、2人のスキルレベルを足した数です。",
        })
      );
    }
  }

  function readName(id, fallback) {
    const node = $(id);
    const v = node && node.value ? node.value.trim() : "";
    return v || fallback;
  }

  function buildSides() {
    const g = GAMES[selectedGame];
    function one(side, fallback) {
      const n1 = readName("inName" + side, "");
      if (g.playersPerSide === 1) {
        const name = n1 || fallback;
        const p = STORE.upsertPlayer(name);
        return { name: name, playerIds: p ? [p.id] : [] };
      }
      const n2 = readName("inName" + side + "2", "");
      const names = [n1, n2].filter(Boolean);
      const label = names.length ? names.join("・") : fallback;
      const ids = names
        .map(function (n) {
          const p = STORE.upsertPlayer(n);
          return p ? p.id : null;
        })
        .filter(Boolean);
      return { name: label, playerIds: ids };
    }
    return [one("A", "プレーヤーA"), one("B", "プレーヤーB")];
  }

  function num(id, dflt) {
    const node = $(id);
    if (!node) return dflt;
    const v = parseInt(node.value, 10);
    return isNaN(v) ? dflt : v;
  }

  function clockType() {
    return UI.toggleValue($("clockTypeToggle")) || "none";
  }

  function buildShotClock() {
    if (clockType() !== "shot") return { enabled: false };
    return {
      enabled: true,
      seconds: num("scSeconds", 45),
      warnAtSec: num("scWarn", 15),
      extension: {
        countPerSide: num("scExtCount", 2),
        seconds: num("scExtSec", 45),
        mode: UI.toggleValue($("scModeToggle")) || "declare",
      },
      violationIsFoul: true,
    };
  }

  function buildChessClock() {
    if (clockType() !== "chess") return { enabled: false };
    return {
      enabled: true,
      minutes: num("ccMinutes", 30),
      warnAtSec: num("ccWarn", 60),
      byoyomiSec: num("ccByoyomi", 0),
      timeoutLoses: true,
    };
  }

  /** 勝利条件（ハンデ含む）を組み立てる */
  function buildGoal(g) {
    const isJpa = g.goal === "jpaSL" || g.goal === "jpaSL8";
    return {
      type: g.goalType === "racks" || g.goalType === "games" ? "racks" : "score",
      targets: { A: goalValues.A, B: goalValues.B },
      source: isJpa ? g.goal : "free",
      // JPAはチームポイントの算出に敗者のスキルレベルが要るため必ず持たせる
      meta: isJpa ? { skillLevel: { A: skillLevels.A, B: skillLevels.B } } : {},
      ballHandicap: { A: null, B: null },
      raceType: "raceTo",
    };
  }

  function startMatch() {
    const g = GAMES[selectedGame];
    if (goalValues.A < 1 || goalValues.B < 1) {
      UI.toast("勝利条件を1以上にしてください。", "warn");
      return;
    }

    const match = createMatch({
      gameId: selectedGame,
      sides: buildSides(),
      goal: buildGoal(g),
      options: {
        breakType: UI.toggleValue($("breakTypeToggle")) || BASE_RULES[g.base].defaultBreakType,
        shotClock: buildShotClock(),
        chessClock: buildChessClock(),
        inputMode: g.mode,
      },
      firstSide: UI.toggleValue($("firstSideToggle")) || "A",
    });

    if (!STORE.saveMatch(match)) {
      UI.toast("保存できませんでした。ブラウザの空き容量を確認してください。", "danger");
      return;
    }
    MATCH.open(match);
  }

  return { init: init };
})();
