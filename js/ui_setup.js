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

  // どの画面から来たかを覚えておく（常時出る「戻る」で1つ前に戻すため）
  const screenStack = [];

  function currentScreen() {
    const on = document.querySelector("section.screen.active");
    return on ? on.id : null;
  }

  function showScreen(id, opts) {
    const from = currentScreen();
    // 履歴に積む。同じ画面への移動と、戻る操作自体は積まない
    if (from && from !== id && !(opts && opts.back)) {
      screenStack.push(from);
      // 積みっぱなしにならないよう上限を設ける
      if (screenStack.length > 20) screenStack.shift();
    }

    // 画面はDOMから拾う（画面を足したときに列挙を直し忘れないように）
    const screens = document.querySelectorAll("section.screen");
    Array.prototype.forEach.call(screens, function (node) {
      node.classList.toggle("active", node.id === id);
    });
    // 試合中は画面を1枚に収める（下部の操作ボタンがはみ出さないように）
    document.body.classList.toggle("match-active", id === "screenMatch");
    updateBackButton(id);
    window.scrollTo(0, 0);
  }

  /**
   * 常時出る「戻る」ボタンの出し入れ。
   *
   * 試合中は出さない。記録中に画面を離れる操作を親指の届く場所に置くと、
   * 誤って抜けてしまうため（試合画面には専用の「中断」がある）。
   */
  function updateBackButton(id) {
    const btn = document.getElementById("globalBackBtn");
    if (!btn) return;
    const hide = id === "screenMatch" || (id === "screenSetup" && !screenStack.length);
    btn.hidden = hide;
  }

  /** 1つ前の画面に戻る */
  function goBack() {
    const prev = screenStack.pop();
    showScreen(prev || "screenSetup", { back: true });
  }

  function bindBackButton() {
    const btn = document.getElementById("globalBackBtn");
    if (btn) btn.addEventListener("click", goBack);
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
    goBack: goBack, bindBackButton: bindBackButton,
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
        { id: "rotation", doubles: null },
        { id: "straight", doubles: null },
        { id: "bowlard", doubles: null },
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
  // 使うボールセット（盤面の色分けに使う）。前回選んだものを覚える
  let ballSet = (STORE.getSettings() || {}).ballSet || "standard";

  // ボールハンデ。「N番以上を入れたら1点」の N を持つ（null＝ハンデなし）
  // 出典: CUES「相手は9番、自分は7番以上を入れたら1ポイント」（04_種目ルール仕様.md）
  let ballHandicap = { A: null, B: null };

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
    // 「よく使う種目」は出さない（本人の指示）。
    // カテゴリを開けばすぐ選べるので、上に重複して並べる意味が薄いため
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
  /** 注意書きの要素。描き直しで一度DOMから外れるため参照を持っておく */
  let gameNoteEl = null;

  function renderGameGroups() {
    const wrap = $("gameGroups");
    if (!wrap) return;
    if (!gameNoteEl) gameNoteEl = $("gameNote");
    // 消される前に外へ退避する（clearは子を取り外すので参照が切れる）
    if (gameNoteEl && gameNoteEl.parentNode === wrap) wrap.removeChild(gameNoteEl);
    let noteHost = null;
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

        // 注意書きは選んだ種目のすぐ下に出す。
        // カテゴリの外（一覧の末尾）に置くと「JPAの説明」に見えてしまう
        if (active) noteHost = body;
      });
      wrap.appendChild(body);
    });

    // 選択行があればその直下、無ければ元の位置（種目一覧の直後）へ戻す
    if (gameNoteEl) {
      if (noteHost) noteHost.appendChild(gameNoteEl);
      else wrap.parentNode.insertBefore(gameNoteEl, wrap.nextSibling);
    }
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
    if (base.rackEndsScoring === false) {
      // NBA第11章第4条第5項。ラックは盤面のリセット単位でしかない
      notes.push(
        base.label + "は球の番号がそのまま得点で、ラックをまたいで点が続きます。"
          + "1ラックで合計" + base.rackTotal + "点です。"
      );
    }
    $("gameNote").textContent = notes.join(" ");

    // ブレイク方式の既定値
    UI.setToggle($("breakTypeToggle"), base.defaultBreakType);

    // ローテーションのようにブレイク方式が決まっている種目では
    // 選択肢を出さない（選べるように見せて engine が無視するのは不誠実なため）
    const btField = $("breakTypeToggle").closest(".field");
    if (base.breakTypeFixed) {
      if (btField) btField.hidden = true;
      $("breakTypeNote").textContent = "";
    } else {
      if (btField) btField.hidden = false;
      $("breakTypeNote").textContent =
        base.defaultBreakType === "winner"
          ? "この種目は勝者ブレイクが一般的です。"
          : "この種目は交互ブレイクが一般的です。";
    }

    // 種目に合った既定値にする（ラック先取か点数先取かで桁が違う）
    if (g.goalDefault) {
      goalValues = { A: g.goalDefault, B: g.goalDefault };
    } else {
      const preset = (g.goalPresets && g.goalPresets[0]) || null;
      if (preset) goalValues = { A: preset.v, B: preset.v };
    }
    // 種目が変わったらダブルスの段階表示を初期化する
    secondOpen.A = false;
    secondOpen.B = false;

    // 先取点を出さない種目ではハンデも使わないので、状態を戻しておく
    if (g.goalHidden) {
      goalMode = "same";
      ballHandicap = { A: null, B: null };
    }

    renderPlayerFields();
    renderGoalArea(); // 中で renderBallHandicap も呼ばれる
  }

  /**
   * ボールハンデの選択欄。
   *
   * 「N番以上を入れたら1点」という形で選ぶ。内部では該当する球すべてを
   * scoringBalls に展開して engine に渡す（engine 側は球の集合で解釈する）。
   *
   * キーボールがある種目（9/10/8ボール）でのみ意味を持つ。
   * 14-1・ローテーションは元から球ごとに得点する種目なので出さない。
   */
  function renderBallHandicap() {
    const section = $("ballHandicapSection");
    const wrap = $("ballHandicapArea");
    if (!section || !wrap) return;
    UI.clear(wrap);

    const g = GAMES[selectedGame];
    const base = BASE_RULES[g.base];

    // 出せる種目かどうか。ラック単位で数える種目のみ。
    // さらに「ハンデあり」を選んでいるときだけ出す
    // （ハンデなしの人に球ごとの設定を見せても迷わせるだけのため）
    const usableGame = SCORING[g.scoring].kind === "rackCount" && !!base.keyBall;
    const usable = usableGame && goalMode === "handicap";
    section.hidden = !usable;
    if (!usable) {
      if (!usableGame) ballHandicap = { A: null, B: null };
      return;
    }

    wrap.appendChild(
      UI.el("p", {
        class: "hint",
        text: "実力差があるとき、弱い側が「番号の若い球でも得点になる」ようにする決め方です。",
      })
    );

    // 選べる下限。キーボールと、その手前の2つまでを出す（実際に使われる範囲）
    const key = base.keyBall;
    const options = [key - 2, key - 1].filter(function (n) { return n >= 1; });

    ["A", "B"].forEach(function (side) {
      const chips = UI.el("div", { class: "chips bh-chips" });

      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip",
          "aria-pressed": String(ballHandicap[side] === null),
          text: "ハンデなし",
          onclick: function () {
            ballHandicap[side] = null;
            // 単位（ラック/点）が変わるので勝利条件ごと描き直す。
            // renderGoalArea が最後に renderBallHandicap を呼ぶ
            renderGoalArea();
          },
        })
      );

      options.forEach(function (n) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            "aria-pressed": String(ballHandicap[side] === n),
            text: n + "番以上",
            onclick: function () {
              ballHandicap[side] = n;
              renderGoalArea();
            },
          })
        );
      });

      const label = nameForSide(side);
      wrap.appendChild(
        UI.el("div", { class: "field" }, [UI.el("label", { text: label + " のハンデ" }), chips])
      );
    });

    // いまの設定を文章で確認できるようにする
    const summary = ["A", "B"].map(function (side) {
      const n = ballHandicap[side];
      return nameForSide(side) + "は" + (n === null ? key + "番のみ" : n + "番以上");
    });
    wrap.appendChild(
      UI.el("p", { class: "hint bh-summary", text: summary.join("　／　") + " で1点" })
    );

    // ハンデを付けると数え方が「ラック先取」から「点数先取」に変わる。
    // 勝利条件の意味が変わるので、その場ではっきり伝える
    if (ballHandicap.A !== null || ballHandicap.B !== null) {
      wrap.appendChild(
        UI.el("p", {
          class: "hint warn",
          text: "ハンデを付けると、勝利条件は「ラック先取」ではなく「点数先取」になります。"
            + "得点になる球を1個入れるごとに1点です。",
        })
      );
    }
  }

  /**
   * 使うボールの選択。
   * 盤面で番号を色分けする種目（ローテーション）でだけ出す。
   * セットによって6番7番の色が通常と違うため、実際に使う球に合わせる。
   */
  function renderBallSet() {
    const section = $("ballSetSection");
    const wrap = $("ballSetArea");
    if (!section || !wrap) return;
    UI.clear(wrap);

    const g = GAMES[selectedGame];
    const usesGrid = SCORING[g.scoring].kind === "ballScore"
      && !!SCORING[g.scoring].scoreOf && !!BASE_RULES[g.base].rackTotal;
    section.hidden = !usesGrid;
    if (!usesGrid) return;

    const chips = UI.el("div", { class: "chips ballset-chips" });
    BALL_SET_ORDER.forEach(function (id) {
      const set = BALL_SETS[id];
      const btn = UI.el("button", {
        type: "button",
        class: "chip ballset-chip",
        "data-set": id,
        "aria-pressed": String(ballSet === id),
        onclick: function () {
          ballSet = id;
          const st = STORE.getSettings() || {};
          st.ballSet = id;
          STORE.saveSettings(st);
          renderBallSet();
        },
      }, [UI.el("span", { class: "bs-name", text: set.label })]);

      // 見本を並べる。6番7番が違うセットがあるので見比べられるようにする
      const swatch = UI.el("span", { class: "bs-swatch" });
      [1, 4, 6, 7].forEach(function (n) {
        const ap = ballAppearance(id, n);
        swatch.appendChild(
          UI.el("i", {
            class: "bs-dot",
            style: "background:" + ap.base
              + (ap.band ? ";box-shadow: inset 0 0 0 3px " + ap.band : ""),
            title: n + "番",
          })
        );
      });
      btn.appendChild(swatch);
      chips.appendChild(btn);
    });
    wrap.appendChild(chips);

    const cur = BALL_SETS[ballSet];
    if (cur && cur.note) {
      wrap.appendChild(UI.el("p", { class: "hint", text: cur.note }));
    }
    wrap.appendChild(
      UI.el("p", {
        class: "hint",
        text: "色は商品画像に寄せた近似です（メーカーは色の数値を公開していません）。",
      })
    );
  }

  /** 設定画面での側の呼び名。名前が入っていればそれを使う */
  function nameForSide(side) {
    const g = GAMES[selectedGame];
    const v = readName("inName" + side, "");
    if (v) return v;
    if (g.playersPerSide === 2) return side === "A" ? "チームA" : "チームB";
    return side === "A" ? "プレーヤーA" : "プレーヤーB";
  }

  /**
   * 登録済みプレーヤーを呼び出すボタン列。押すと名前欄に入る。
   *
   * JPA種目のときは、その人に登録されたスキルレベルも一緒に反映する。
   * 手で選び直せるよう、反映後もスキルレベルの選択欄は触れるままにする。
   */

  /**
   * 名前欄の現在値。描き直しの途中はDOMがまだ揃っていないため、
   * renderPlayerFields が控えたスナップショットがあればそちらを見る。
   */
  let nameSnapshot = null;
  const NAME_IDS = ["inNameA", "inNameA2", "inNameB", "inNameB2"];

  function currentName(id) {
    if (nameSnapshot) return (nameSnapshot[id] || "").trim();
    return readName(id, "");
  }

  /** いま名前欄に入っている人の一覧（自分の欄は除く）。同じ人の二重選択を防ぐ */
  function takenNames(exceptId) {
    const out = [];
    NAME_IDS.forEach(function (id) {
      if (id === exceptId) return;
      const v = currentName(id);
      if (v) out.push(v);
    });
    return out;
  }

  function playerPicker(targetId, side) {
    const players = STORE.listPlayers();
    if (!players.length) return null;

    const wrap = UI.el("div", { class: "picker-wrap" });
    wrap.appendChild(UI.el("div", { class: "picker-label", text: "登録した人から選ぶ" }));

    const taken = takenNames(targetId);
    const chosen = currentName(targetId);

    const chips = UI.el("div", { class: "chips picker" });
    players.forEach(function (p) {
      // 他の欄で選ばれている人は候補から外す（1人目に選んだ人が2人目に出ない）
      if (taken.indexOf(p.name) >= 0) return;
      const sk = p.skill || {};
      const slTag = jpaKind() === "eight" ? sk.eight : sk.nine;
      const isChosen = !!chosen && chosen === p.name;
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip small-chip picker-chip"
            + (isChosen ? " is-chosen side-" + String(side || "a").toLowerCase() : ""),
          "aria-pressed": String(isChosen),
          onclick: function () {
            const node = $(targetId);
            if (node) node.value = p.name;
            applyPlayerSkill(p, side);
            // ダブルスで1人目を選んだら、続けて2人目を選べるようにする
            const g2 = GAMES[selectedGame];
            if (g2.playersPerSide === 2 && targetId === "inName" + side) {
              secondOpen[side] = true;
            }
            // 選んだ人を塗り、他の欄の候補から外すために描き直す
            renderPlayerFields();
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

  /**
   * ダブルスで2人目の欄を出しているか（側ごと）。
   * 最初から2つ並べると「どっちに誰を入れるのか」が分かりにくいため、
   * 1人目が決まってから2人目を出す。
   */
  const secondOpen = { A: false, B: false };

  function renderPlayerFields() {
    const g = GAMES[selectedGame];
    const wrap = $("playerFields");
    // 描き直しで入力中の名前が消えないよう、いまの値を控えてから作り直す
    const keep = {};
    NAME_IDS.forEach(function (id) {
      const n = $(id);
      if (n) keep[id] = n.value || "";
    });
    nameSnapshot = keep;
    UI.clear(wrap);
    const per = g.playersPerSide;

    // 1人用の種目（ボウラード）は相手を入力させない
    const sides = g.solo ? [["A", "プレーヤー"]] : [["A", "プレーヤーA"], ["B", "プレーヤーB"]];

    sides.forEach(function (pair) {
      const side = pair[0];

      if (per === 1) {
        const field = UI.el("div", { class: "field" }, [
          UI.el("label", { text: pair[1] + " の名前" }),
          UI.el("input", { type: "text", id: "inName" + side, placeholder: pair[1] }),
        ]);
        const picker = playerPicker("inName" + side, side);
        if (picker) field.appendChild(picker);
        wrap.appendChild(field);
        return;
      }

      // ---- ダブルス ----
      const teamLabel = side === "A" ? "チームA" : "チームB";
      const field = UI.el("div", { class: "field team-field" });
      field.appendChild(UI.el("label", { text: teamLabel }));

      // 1人目
      const in1 = UI.el("input", {
        type: "text", id: "inName" + side, placeholder: "1人目の名前",
      });
      field.appendChild(UI.el("div", { class: "member-row" }, [
        UI.el("span", { class: "member-no", text: "1" }),
        in1,
      ]));
      const p1 = playerPicker("inName" + side, side);
      if (p1) field.appendChild(p1);

      // 2人目。1人目が入るまでは「追加」ボタンだけを出す
      const hasFirst = !!(in1.value || "").trim() || !!readName("inName" + side, "");
      const showSecond = secondOpen[side] || hasFirst
        || !!readName("inName" + side + "2", "");

      if (showSecond) {
        const in2 = UI.el("input", {
          type: "text", id: "inName" + side + "2", placeholder: "2人目の名前",
        });
        field.appendChild(UI.el("div", { class: "member-row" }, [
          UI.el("span", { class: "member-no", text: "2" }),
          in2,
        ]));
        const p2 = playerPicker("inName" + side + "2", side);
        if (p2) field.appendChild(p2);
      } else {
        field.appendChild(
          UI.el("button", {
            type: "button",
            class: "add-member",
            text: "＋ 2人目を選ぶ",
            onclick: function () {
              secondOpen[side] = true;
              renderPlayerFields();
            },
          })
        );
      }

      wrap.appendChild(field);

      // 1人目が入力されたら2人目の欄を出す。
      // 入力のたびに全部描き直すと文字が打てなくなるので、
      // 「空→何か入った」瞬間だけ描き直す
      in1.addEventListener("input", function () {
        const now = !!(in1.value || "").trim();
        if (now && !secondOpen[side]) {
          secondOpen[side] = true;
          const caret = in1.value;
          renderPlayerFields();
          const again = $("inName" + side);
          if (again) {
            again.value = caret;
            again.focus();
            // カーソルを末尾に戻す
            try { again.setSelectionRange(caret.length, caret.length); } catch (e) { /* 無視 */ }
          }
        }
      });
    });

    // 控えた値を書き戻す（新しく作った欄には値が入っていないため）
    Object.keys(keep).forEach(function (id) {
      const n = $(id);
      if (n && !n.value && keep[id]) n.value = keep[id];
    });
    nameSnapshot = null;
  }

  /**
   * 勝利条件の選択肢。
   *
   * よく使う 3〜7先はボタンで出し、それ以上はプルダウンに入れる。
   * ボタンを増やすと台の脇で探す時間が増えるため、
   * 実際に使う範囲だけを表に出す。
   */
  const QUICK_RACES = [3, 4, 5, 6, 7];

  /** プルダウンに入れる値。種目の単位（ラック/点）で刻みを変える */
  function moreGoalValues(unit) {
    if (unit === "点") {
      // 点数制は桁が大きいので粗く刻む。
      // 5点刻みの小さい値も入れる（カイルンの5点先取など）
      const out = [5];
      for (let v = 10; v <= 100; v += 10) out.push(v);
      for (let v = 120; v <= 200; v += 20) out.push(v);
      return out;
    }
    // ラック先取。ボタンに出していない値を並べる。
    // 1先・2先はハンデ戦で弱い側に付けることがあるため必ず入れる
    // （ボタンは3〜7先なので、ここに無いと選べなくなる）
    const out = [1, 2];
    for (let v = 8; v <= 21; v++) out.push(v);
    return out;
  }

  /**
   * 勝利条件を1つ選ぶ部品（ボタン＋プルダウン）。
   * @param unit    "ラック" か "点"
   * @param value   いまの値
   * @param onPick  選ばれたときに呼ぶ
   */
  function goalPicker(unit, value, onPick) {
    const holder = UI.el("div", { class: "goal-picker" });

    const chips = UI.el("div", { class: "chips" });
    QUICK_RACES.forEach(function (v) {
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip",
          "aria-pressed": String(value === v),
          text: v + "先",
          onclick: function () { onPick(v); },
        })
      );
    });
    holder.appendChild(chips);

    // 3〜7先以外はプルダウンで選ぶ
    const more = moreGoalValues(unit);
    const sel = UI.el("select", { class: "goal-more" });
    const isQuick = QUICK_RACES.indexOf(value) >= 0;
    sel.appendChild(
      UI.el("option", { value: "", text: isQuick ? "その他…" : "選択中: " + value + unit })
    );
    more.forEach(function (v) {
      const opt = UI.el("option", { value: String(v), text: v + unit + "先取" });
      if (v === value) opt.setAttribute("selected", "selected");
      sel.appendChild(opt);
    });
    // 一覧に無い値（手で入れた数など）も選べるようにしておく
    if (!isQuick && more.indexOf(value) < 0) {
      const opt = UI.el("option", { value: String(value), text: value + unit + "先取" });
      opt.setAttribute("selected", "selected");
      sel.appendChild(opt);
    }
    sel.addEventListener("change", function () {
      const v = parseInt(sel.value, 10);
      if (!isNaN(v)) onPick(v);
    });
    holder.appendChild(sel);

    return holder;
  }

  function renderGoalArea() {
    const g = GAMES[selectedGame];
    const wrap = $("goalArea");
    UI.clear(wrap);

    // JPAはスキルレベルから持ち点が決まるため、専用のUIにする
    if (g.goal === "jpaSL" || g.goal === "jpaSL8") {
      renderJpaGoalArea(g, wrap);
      renderBallHandicap();
      renderBallSet();
      return;
    }

    // ボールハンデを付けると点数制に変わるため、単位表示もそれに合わせる
    const bhOn = ballHandicap.A !== null || ballHandicap.B !== null;
    const unit = bhOn ? "点" : (g.goalType === "racks" ? "ラック" : "点");

    // ハンデの有無。ここが「なし」なら左右別の入力もボールハンデも出さない
    // ※ ローテーションは goalHidden で先取点の入力自体を出さない（後述）
    const modeToggle = UI.el("div", { class: "toggle-group" }, [
      UI.el("button", { type: "button", "data-v": "same", "aria-pressed": String(goalMode === "same"), text: "ハンデなし" }),
      UI.el("button", { type: "button", "data-v": "handicap", "aria-pressed": String(goalMode === "handicap"), text: "ハンデあり" }),
    ]);
    UI.bindToggle(modeToggle, function (v) {
      goalMode = v;
      if (v === "same") {
        goalValues.B = goalValues.A;
        // ハンデなしに戻したらボールハンデも外す（設定だけ残ると混乱するため）
        ballHandicap = { A: null, B: null };
      }
      renderGoalArea();
    });
    wrap.appendChild(UI.el("div", { class: "field" }, [UI.el("label", { text: "ハンデ" }), modeToggle]));

    // 決まった選択肢からだけ選ばせる種目（ローテーションの120/180/240/300）。
    // 自由入力にすると規程に無い数字が入るため、裏の取れた値だけを並べる
    if (g.goalChoices) {
      if (g.goalNote) wrap.appendChild(UI.el("p", { class: "hint", text: g.goalNote }));

      const label = goalMode === "handicap" ? null : "何点先取で勝ちか";
      const sides = goalMode === "handicap" ? ["A", "B"] : [null];

      sides.forEach(function (side) {
        const cur = side ? goalValues[side] : goalValues.A;
        const chips = UI.el("div", { class: "chips goal-choices" });
        g.goalChoices.forEach(function (v) {
          chips.appendChild(
            UI.el("button", {
              type: "button",
              class: "chip",
              "aria-pressed": String(cur === v),
              text: v + "点",
              onclick: function () {
                if (side) goalValues[side] = v;
                else goalValues = { A: v, B: v };
                renderGoalArea();
              },
            })
          );
        });
        wrap.appendChild(
          UI.el("div", { class: "field" }, [
            UI.el("label", {
              text: side ? nameForSide(side) + " の目標（点）" : label,
            }),
            chips,
          ])
        );
      });

      renderBallHandicap();
      renderBallSet();
      return;
    }

    // 種目によっては先取点の入力自体を出さない（games_data.js の goalHidden）
    if (g.goalHidden) {
      wrap.appendChild(
        UI.el("p", {
          class: "hint",
          text: g.goalHiddenNote || "この種目は決まった点数で行います。",
        })
      );
      renderBallHandicap();
      renderBallSet();
      return;
    }

    if (goalMode === "same") {
      // ハンデなし: 両者共通の先取数を1つ選ぶだけ
      wrap.appendChild(
        UI.el("div", { class: "field" }, [
          UI.el("label", { text: "何" + unit + "先取で勝ちか" }),
          goalPicker(unit, goalValues.A, function (v) {
            goalValues = { A: v, B: v };
            renderGoalArea();
          }),
        ])
      );
    } else {
      // ハンデあり: 左右別に選ぶ
      ["A", "B"].forEach(function (side) {
        wrap.appendChild(
          UI.el("div", { class: "field" }, [
            UI.el("label", { text: nameForSide(side) + " の目標（" + unit + "）" }),
            goalPicker(unit, goalValues[side], function (v) {
              goalValues[side] = v;
              renderGoalArea();
            }),
          ])
        );
      });
      wrap.appendChild(
        UI.el("p", { class: "hint", text: "実力差があるときは、強い側の数字を大きくします。" })
      );
    }

    // ハンデの有無に連動してボールハンデの欄も出し入れする
    renderBallHandicap();
    renderBallSet();
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
    // 1人用の種目でも、記録の形をそろえるため2側ぶん作る（B側は使わない）
    if (g.solo) return [one("A", "プレーヤー"), { name: "—", playerIds: [] }];
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
  /**
   * 「N番以上が得点」を engine が解釈する形（得点になる球の一覧）に展開する。
   * ハンデなしの側は null を返し、種目既定の数え方のままにする。
   */
  function buildBallHandicap(g) {
    const base = BASE_RULES[g.base];
    const out = { A: null, B: null };
    ["A", "B"].forEach(function (side) {
      const from = ballHandicap[side];
      if (from === null || from === undefined) return;
      out[side] = {
        from: from, // 表示用。「7番以上」と出すために持っておく
        scoringBalls: base.balls.filter(function (b) { return b >= from; }),
      };
    });
    return out;
  }

  function buildGoal(g) {
    const isJpa = g.goal === "jpaSL" || g.goal === "jpaSL8";
    const bh = buildBallHandicap(g);
    const hasBh = !!(bh.A || bh.B);

    // ボールハンデは「球1個ごとに1点」で数える必要があるため、
    // ラック先取の種目でも点数制に切り替える（engine.js の effectiveScoreKind が
    // goal.type === "score" を見てボール単位の加点に切り替える）。
    const baseType = g.goalType === "racks" || g.goalType === "games" ? "racks" : "score";

    return {
      type: hasBh ? "score" : baseType,
      targets: { A: goalValues.A, B: goalValues.B },
      source: isJpa ? g.goal : "free",
      // JPAはチームポイントの算出に敗者のスキルレベルが要るため必ず持たせる
      meta: isJpa ? { skillLevel: { A: skillLevels.A, B: skillLevels.B } } : {},
      ballHandicap: bh,
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
        ballSet: ballSet,
        breakType: UI.toggleValue($("breakTypeToggle")) || BASE_RULES[g.base].defaultBreakType,
        shotClock: buildShotClock(),
        chessClock: buildChessClock(),
        inputMode: g.mode,
      },
      firstSide: UI.toggleValue($("firstSideToggle")) || "A",
    });

    bumpGameCount(selectedGame);

    // この試合で使った人を記録する（選手一覧の「最近」の並び替えに使う）
    match.sides.forEach(function (sd) {
      (sd.playerIds || []).forEach(function (id) { STORE.touchPlayer(id); });
    });

    if (!STORE.saveMatch(match)) {
      UI.toast("保存できませんでした。ブラウザの空き容量を確認してください。", "danger");
      return;
    }
    MATCH.open(match);
  }

  return { init: init };
})();
