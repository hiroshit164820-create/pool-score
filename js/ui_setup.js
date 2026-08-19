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
  /**
   * 画面下に短い通知を出す。
   *
   * 表示するのは常に最新の1件だけにする。
   * 連続で操作すると通知が積み上がって、その下にある時計や
   * 操作ボタンが隠れてしまうため（台の脇で使う道具なので致命的）。
   */
  function toast(message, kind) {
    const wrap = $("toastWrap");
    clear(wrap);
    const t = el("div", { class: "toast" + (kind ? " " + kind : ""), text: message });
    wrap.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      clear(wrap);
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

  /**
   * 画面に出す種目。data/games_data.js に定義があるものだけ並べる。
   *
   * 9種目を平らに並べると選ぶのに時間がかかるため、
   *   ①よく使う種目（実際に選んだ履歴から自動）
   *   ②カテゴリごとの折りたたみ
   * の2段構えにする。ダブルスは親種目の中に畳んで、一覧の行数を減らす。
   */
  const GAME_GROUPS = [
    {
      key: "standard",
      label: "一般",
      items: [
        { id: "9ball", doubles: "9ball_doubles" },
        { id: "10ball", doubles: "10ball_doubles" },
        { id: "8ball", doubles: null },
        { id: "straight", doubles: null },
      ],
    },
    {
      key: "jpa",
      label: "JPA（スキルレベル制）",
      items: [
        { id: "jpa_9ball", doubles: "jpa_9ball_doubles" },
        { id: "jpa_8ball", doubles: null },
      ],
    },
  ];

  /** 折りたたみの中身も含めた、選べる種目のID一覧 */
  const AVAILABLE = GAME_GROUPS.reduce(function (acc, grp) {
    grp.items.forEach(function (it) {
      acc.push(it.id);
      if (it.doubles) acc.push(it.doubles);
    });
    return acc;
  }, []);

  // ダブルスをONにしているか（親種目ごとに覚える必要はなく、選択中の種目だけで足りる）
  let doublesOn = false;
  let openGroup = "standard";

  let selectedGame = "9ball";
  let goalMode = "same"; // same | handicap
  let goalValues = { A: 5, B: 5 };
  // JPA用。スキルレベルから持ち点を自動算出する
  let skillLevels = { A: 5, B: 5 };

  function init() {
    renderGames();
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

  /** よく使う種目（選んだ回数の多い順に最大3件） */
  function recentGameIds() {
    const counts = (STORE.getSettings() || {}).gameCounts || {};
    return Object.keys(counts)
      .filter(function (id) { return AVAILABLE.indexOf(id) >= 0; })
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, 3);
  }

  /** 種目を選んだ回数を1つ増やす（次回から「よく使う」に出るようにする） */
  function bumpGameCount(id) {
    const st = STORE.getSettings() || {};
    st.gameCounts = st.gameCounts || {};
    st.gameCounts[id] = (st.gameCounts[id] || 0) + 1;
    STORE.saveSettings(st);
  }

  /** 選択中の種目が属する親種目（ダブルスなら親を返す） */
  function parentOf(gameId) {
    let found = null;
    GAME_GROUPS.forEach(function (grp) {
      grp.items.forEach(function (it) {
        if (it.id === gameId || it.doubles === gameId) found = it;
      });
    });
    return found;
  }

  function groupOf(gameId) {
    let key = "standard";
    GAME_GROUPS.forEach(function (grp) {
      grp.items.forEach(function (it) {
        if (it.id === gameId || it.doubles === gameId) key = grp.key;
      });
    });
    return key;
  }

  function renderGames() {
    renderRecentGames();
    renderGameGroups();
  }

  /** よく使う種目。1タップで選べる近道 */
  function renderRecentGames() {
    const wrap = $("gameRecent");
    if (!wrap) return;
    UI.clear(wrap);
    const ids = recentGameIds();
    if (!ids.length) return; // 初回は履歴が無いので何も出さない

    wrap.appendChild(UI.el("div", { class: "recent-label", text: "よく使う種目" }));
    const chips = UI.el("div", { class: "chips" });
    ids.forEach(function (id) {
      const g = GAMES[id];
      if (!g) return;
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip recent-chip",
          "data-game": id,
          "aria-pressed": String(id === selectedGame),
          text: g.label,
          onclick: function () { selectGame(id); },
        })
      );
    });
    wrap.appendChild(chips);
  }

  /**
   * カテゴリごとの種目選択。
   * 選んだカテゴリだけを開き、ダブルスは切替スイッチにして行数を減らす。
   */
  function renderGameGroups() {
    const wrap = $("gameGroups");
    if (!wrap) return;
    UI.clear(wrap);

    GAME_GROUPS.forEach(function (grp) {
      const isOpen = openGroup === grp.key;
      const head = UI.el("button", {
        type: "button",
        class: "group-head",
        "aria-expanded": String(isOpen),
        onclick: function () {
          openGroup = isOpen ? null : grp.key;
          renderGameGroups();
        },
      }, [
        UI.el("span", { class: "gh-label", text: grp.label }),
        UI.el("span", { class: "gh-mark", text: isOpen ? "−" : "＋" }),
      ]);
      wrap.appendChild(head);

      if (!isOpen) return;

      const body = UI.el("div", { class: "group-body" });
      grp.items.forEach(function (it) {
        const g = GAMES[it.id];
        if (!g) return;
        // この行が選択中か（シングル・ダブルスのどちらでも）
        const active = selectedGame === it.id || selectedGame === it.doubles;
        const row = UI.el("div", { class: "game-row" + (active ? " active" : "") });

        row.appendChild(
          UI.el("button", {
            type: "button",
            class: "game-pick",
            "data-game": it.id,
            "aria-pressed": String(active),
            onclick: function () {
              // ダブルスがONで、その種目にダブルスがあるならそちらを選ぶ
              const target = doublesOn && it.doubles ? it.doubles : it.id;
              selectGame(target);
            },
          }, [
            UI.el("span", { class: "gp-name", text: g.label }),
          ])
        );

        // ダブルス切替。対応する種目にだけ出す
        if (it.doubles) {
          const on = selectedGame === it.doubles;
          row.appendChild(
            UI.el("button", {
              type: "button",
              class: "doubles-toggle",
              "aria-pressed": String(on),
              title: "ダブルスに切り替える",
              text: "ダブルス",
              onclick: function () {
                doublesOn = !on;
                selectGame(doublesOn ? it.doubles : it.id);
              },
            })
          );
        }
        body.appendChild(row);
      });
      wrap.appendChild(body);
    });
  }

  function selectGame(id) {
    selectedGame = id;
    const gSel = GAMES[id];
    doublesOn = !!(gSel && gSel.playersPerSide === 2);
    openGroup = groupOf(id);
    renderGames();
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

  /**
   * 登録済みプレーヤーを呼び出すボタン列。押すと名前欄に入る。
   *
   * JPA種目のときは、その人に登録されたスキルレベルも一緒に反映する。
   * 手で選び直せるよう、反映後もスキルレベルの選択欄は触れるままにする。
   */
  function playerPicker(targetId, side) {
    const players = STORE.listPlayers();
    if (!players.length) return null;

    const wrap = UI.el("div", { class: "picker-wrap" });
    wrap.appendChild(UI.el("div", { class: "picker-label", text: "登録した人から選ぶ" }));

    const chips = UI.el("div", { class: "chips picker" });
    players.forEach(function (p) {
      const sk = p.skill || {};
      const slTag = jpaKind() === "eight" ? sk.eight : sk.nine;
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip small-chip picker-chip",
          onclick: function () {
            const node = $(targetId);
            if (node) node.value = p.name;
            applyPlayerSkill(p, side);
          },
        }, [
          UI.el("span", { class: "pc-name", text: p.name }),
          // JPA種目のときだけ、その人のスキルレベルを添えて選びやすくする
          jpaKind() && slTag ? UI.el("span", { class: "pc-sl", text: "SL" + slTag }) : null,
        ])
      );
    });
    wrap.appendChild(chips);
    return wrap;
  }

  /** いま選んでいる種目が使うJPAスキルレベルの種類。JPA以外なら null */
  function jpaKind() {
    const g = GAMES[selectedGame];
    if (!g) return null;
    if (g.goal === "jpaSL8") return "eight";
    if (g.goal === "jpaSL") return "nine";
    return null;
  }

  /**
   * 選んだプレーヤーのスキルレベルを勝利条件に反映する。
   * ダブルスは2人の合計を使うため、片方だけ選んだ時点では上書きしない。
   */
  function applyPlayerSkill(player, side) {
    const kind = jpaKind();
    if (!kind || !side) return;
    const g = GAMES[selectedGame];
    const sk = (player && player.skill) || {};
    const v = sk[kind];
    if (!v) return;

    if (g.playersPerSide === 2) {
      // ダブルスは合計。両方の欄に登録済みの人が入っているときだけ自動計算する
      const n1 = readName("inName" + side, "");
      const n2 = readName("inName" + side + "2", "");
      const p1 = STORE.findPlayerByName(n1);
      const p2 = STORE.findPlayerByName(n2);
      const v1 = p1 && p1.skill ? p1.skill[kind] : null;
      const v2 = p2 && p2.skill ? p2.skill[kind] : null;
      if (!v1 || !v2) return;
      const sum = v1 + v2;
      // 合計が表の範囲を超える場合は反映しない（誤った勝利条件を出さない）
      const max = kind === "eight" ? 7 : 9;
      if (sum < 2 || sum > max * 2) return;
      skillLevels[side] = sum;
    } else {
      skillLevels[side] = v;
    }
    renderGoalArea();
    UI.toast(player.name + " のスキルレベル（SL" + v + "）を反映しました。");
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
        const picker = playerPicker("inName" + side, side);
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
        const p1 = playerPicker("inName" + side, side);
        if (p1) {
          field.appendChild(UI.el("p", { class: "hint", text: "1人目に入れる" }));
          field.appendChild(p1);
          const p2 = playerPicker("inName" + side + "2", side);
          field.appendChild(UI.el("p", { class: "hint", text: "2人目に入れる" }));
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
    const kind = jpaKind();
    function one(side, fallback) {
      const n1 = readName("inName" + side, "");
      if (g.playersPerSide === 1) {
        const name = n1 || fallback;
        // JPAシングルスは、この試合で使ったスキルレベルをその人に覚えさせる。
        // 次回この人を選んだときに自動で入る
        const skill = kind ? (function () { const o = {}; o[kind] = skillLevels[side]; return o; })() : null;
        const p = STORE.upsertPlayer(name, skill);
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
        // 既定は「1ラックにつき1回」。scope を "match" にすると試合を通しての総数になる
        scope: UI.toggleValue($("scScopeToggle")) || "rack",
        countPerRack: num("scExtCount", 1),
        countPerSide: num("scExtCount", 1),
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

    bumpGameCount(selectedGame);

    if (!STORE.saveMatch(match)) {
      UI.toast("保存できませんでした。ブラウザの空き容量を確認してください。", "danger");
      return;
    }
    MATCH.open(match);
  }

  return { init: init };
})();
