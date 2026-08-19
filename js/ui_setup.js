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
    ["screenSetup", "screenMatch", "screenHistory"].forEach(function (s) {
      const node = $(s);
      if (node) node.classList.toggle("active", s === id);
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
  const AVAILABLE = ["9ball", "9ball_doubles", "10ball", "10ball_doubles", "8ball", "straight"];

  let selectedGame = "9ball";
  let goalMode = "same"; // same | handicap
  let goalValues = { A: 5, B: 5 };

  function init() {
    renderGameChips();
    UI.bindToggle($("breakTypeToggle"), function () {});
    UI.bindToggle($("firstSideToggle"), function () {});
    UI.bindToggle($("scEnableToggle"), function (v) {
      $("scDetail").hidden = v !== "on";
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

  function renderPlayerFields() {
    const g = GAMES[selectedGame];
    const wrap = $("playerFields");
    UI.clear(wrap);
    const per = g.playersPerSide;

    [["A", "プレーヤーA"], ["B", "プレーヤーB"]].forEach(function (pair) {
      const side = pair[0];
      if (per === 1) {
        wrap.appendChild(
          UI.el("div", { class: "field" }, [
            UI.el("label", { text: pair[1] + " の名前" }),
            UI.el("input", { type: "text", id: "inName" + side, placeholder: pair[1] }),
          ])
        );
      } else {
        wrap.appendChild(
          UI.el("div", { class: "field" }, [
            UI.el("label", { text: (side === "A" ? "チームA" : "チームB") + " の2人" }),
            UI.el("div", { class: "row" }, [
              UI.el("input", { type: "text", id: "inName" + side, placeholder: "1人目" }),
              UI.el("input", { type: "text", id: "inName" + side + "2", placeholder: "2人目" }),
            ]),
          ])
        );
      }
    });
  }

  function renderGoalArea() {
    const g = GAMES[selectedGame];
    const wrap = $("goalArea");
    UI.clear(wrap);

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

  function buildShotClock() {
    if (UI.toggleValue($("scEnableToggle")) !== "on") return { enabled: false };
    function num(id, dflt) {
      const v = parseInt($(id).value, 10);
      return isNaN(v) ? dflt : v;
    }
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

  function startMatch() {
    const g = GAMES[selectedGame];
    if (goalValues.A < 1 || goalValues.B < 1) {
      UI.toast("勝利条件を1以上にしてください。", "warn");
      return;
    }

    const match = createMatch({
      gameId: selectedGame,
      sides: buildSides(),
      goal: {
        type: g.goalType === "racks" ? "racks" : "score",
        targets: { A: goalValues.A, B: goalValues.B },
        source: "free",
        meta: {},
        ballHandicap: { A: null, B: null },
        raceType: "raceTo",
      },
      options: {
        breakType: UI.toggleValue($("breakTypeToggle")) || BASE_RULES[g.base].defaultBreakType,
        shotClock: buildShotClock(),
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
