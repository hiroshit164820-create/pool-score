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
  // 通知を「重ねずに場所を空けて」出す画面。
  // 試合中はスコアや名前を隠されると困るので、この2画面は押しのけ方式にする
  const TOAST_INFLOW_SCREENS = ["screenMatch", "screenMoneyMatch", "screenKailunMatch"];

  /** 通知を出しておく時間（ミリ秒）。2.6秒は長いという指摘で短くした（2026-08-20） */
  const TOAST_MS = 1300;

  function toast(message, kind) {
    const wrap = $("toastWrap");
    clear(wrap);

    // 試合画面ではスコアの上に重ねない。帯のすぐ下に差し込んで、
    // その高さぶんスコア側を縮める（本人の指摘 2026-08-20）
    const screen = document.querySelector("section.screen.active");
    const inFlow = !!(screen && TOAST_INFLOW_SCREENS.indexOf(screen.id) >= 0);
    wrap.classList.toggle("inflow", inFlow);
    if (inFlow) {
      const bar = screen.querySelector(".topbar");
      if (bar && bar.parentNode) bar.parentNode.insertBefore(wrap, bar.nextSibling);
    } else if (wrap.parentNode !== document.body) {
      // 試合画面から離れたら、画面に固定して出す元の置き場所へ戻す
      document.body.appendChild(wrap);
    }

    const t = el("div", { class: "toast" + (kind ? " " + kind : ""), text: message });
    wrap.appendChild(t);

    // 固定で出す画面は、いま出ている画面の帯の「下」に置く。
    // 帯に重ねると「中断」「戻る」などのボタンが隠れて押せなくなる（本人の指摘 2026-08-20）。
    // 帯の高さは画面によって違うので、固定値ではなく実測した位置に置く
    if (!inFlow) positionToast(wrap);

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      clear(wrap);
    }, TOAST_MS);
  }

  /**
   * 通知の出る位置を、いま表示している画面の帯の下に合わせる。
   *
   * 下部に出す案は取らない。下部には「交代」「取り消し」「訂正」「試合終了」が
   * 並んでおり、そちらを塞ぐことになるため。
   */
  function positionToast(wrap) {
    if (!wrap) return;
    const screen = document.querySelector("section.screen.active");
    const bar = screen ? screen.querySelector(".topbar") : null;
    const bottom = bar ? bar.getBoundingClientRect().bottom : 0;
    wrap.style.top = Math.max(8, Math.round(bottom) + 8) + "px";
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
   * 下部タブの出し入れと、選択中の印。
   *
   * 試合中は出さない。記録中に画面を離れる操作を親指の届く場所に置くと、
   * 誤って抜けてしまうため（試合画面には専用の「中断」がある）。
   */
  function updateBackButton(id) {
    const bar = document.getElementById("tabBar");
    if (!bar) return;
    bar.hidden = id === "screenMatch";
    if (bar.hidden) return;

    // いまの画面のタブを押された状態にする
    const btns = bar.querySelectorAll(".tab-btn");
    Array.prototype.forEach.call(btns, function (b) {
      const t = b.getAttribute("data-tab");
      b.setAttribute("aria-pressed", String(t === id));
    });
    // 戻り先が無いときは「戻る」を押せなくする（押しても何も起きないと不安になる）
    const back = document.getElementById("tabBack");
    if (back) back.disabled = !screenStack.length;
  }

  /** 1つ前の画面に戻る */
  function goBack() {
    const prev = screenStack.pop();
    showScreen(prev || "screenSetup", { back: true });
  }

  function bindBackButton() {
    const bar = document.getElementById("tabBar");
    if (!bar) return;
    bar.addEventListener("click", function (e) {
      const btn = e.target.closest ? e.target.closest(".tab-btn") : null;
      if (!btn || btn.disabled) return;
      const tab = btn.getAttribute("data-tab");
      if (tab === "back") { goBack(); return; }
      if (!tab) return;
      // 画面ごとに開き方が違う（一覧の再描画が要るものがある）
      if (tab === "screenPlayers" && typeof PLAYERS !== "undefined") { PLAYERS.open(); return; }
      if (tab === "screenHistory" && typeof HISTORY !== "undefined") { HISTORY.open(); return; }
      if (tab === "screenStats" && typeof PLAYERS !== "undefined" && PLAYERS.openStats) {
        PLAYERS.openStats(null);
        return;
      }
      if (tab === "screenHome" && typeof HOME !== "undefined") { HOME.open(); return; }
      if (tab === "screenLayout" && typeof LAYOUT !== "undefined") { LAYOUT.open(); return; }
      showScreen(tab);
    });
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
    updateTabBar: updateBackButton,
    currentScreen: currentScreen,
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
    {
      // 公式競技規程が無く、店ごとに決め方が違うゲーム。
      // 「一般」に混ぜると公式種目と同じ扱いに見えてしまうので分けている
      key: "house",
      label: "ハウスゲーム（店ごとのルール）",
      items: [
        { id: "kailun", doubles: null },
        { id: "59", doubles: null },
        { id: "510", doubles: null },
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
  // 種目のカテゴリはすべて閉じた状態で始める（本人の指示 2026-08-20）。
  // 一覧が縦に長いと、下の勝利条件やプレーヤー欄まで届かないため
  let openGroup = null;

  let selectedGame = "9ball";
  let goalMode = "same"; // same | handicap
  let goalValues = { A: 5, B: 5 };
  // 何セット先取で試合の勝ちにするか。既定は1（＝今までどおり1本勝負）
  let setsToWin = 1;
  // JPA用。スキルレベルから持ち点を自動算出する。
  // シングルスは skillLevels、ダブルスは memberSkills（2人ぶん）を使う。
  // skillLevels にはダブルスでも合計を入れておく（記録とチームポイントの算出に使う）
  let skillLevels = { A: 5, B: 5 };
  // JPA 9ボールダブルスは、2人のSLを縦横で見る表から先取点が決まる
  // （本人提供のスコア表 2026-08-21。data/handicap_data.js の JPA_DOUBLES_9BALL）
  let memberSkills = { A: [5, 5], B: [5, 5] };
  // 盤面の色分けに使うボールセット。
  // 選ぶ項目は画面から削除した（本人の指示 2026-08-20）。
  // 色そのものは残るので、既定（標準セット）を使い、試合記録にも書き残す
  let ballSet = (STORE.getSettings() || {}).ballSet || "standard";

  /**
   * 8ボールの「1ボールハンデ」を表す印。
   *
   * 8ボールはラック単位で数える種目で、engine は個々のグループ球を追っていない。
   * そのため得点計算には効かせず、記録と表示だけに使う。
   * 数字の下限（7番以上など）と同じ変数に入れるので、番号と衝突しない文字列にする。
   */
  const GROUP_MINUS_1 = "groupMinus1";

  // ボールハンデ。「N番以上を入れたら1点」の N を持つ（null＝ハンデなし）
  // 出典: CUES「相手は9番、自分は7番以上を入れたら1ポイント」（04_種目ルール仕様.md）
  let ballHandicap = { A: null, B: null };
  // カイルンのハウス設定。公式規程が無く店ごとに違う2点を選ばせる
  // （rules_data.js の unverified に対応）
  let houseRule = {
    penaltyMode: null,               // selfMinus | othersPlus
    stepResetOnMiss: true,           // ミスでステップを1に戻すか
    allowMultiScorePerInning: true,  // 1イニング内に続けて得点できるか
  };
  // ダブルスの個人ごとのハンデ（表示用）。
  // 得点計算はチーム単位のまま（どの球が落ちたかは人が見て入力するため）。
  // { A: [1人目, 2人目], B: [...] } の形で、値は「◯番以上」の数字か null
  let memberHandicap = { A: [null, null], B: [null, null] };

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
    // selectGame は選んだ種目のカテゴリを開くが、起動直後だけは全部閉じておく
    openGroup = null;
    renderGames();

    // 設定を触るたびに「この内容で始めます」のまとめを描き直す。
    // 個々の描画関数から呼ぶと呼び忘れが出るため、画面ごと監視する
    const screen = $("screenSetup");
    if (screen) {
      ["input", "change", "click"].forEach(function (ev) {
        screen.addEventListener(ev, scheduleSummary);
      });
    }
    renderStartSummary();
  }

  /** まとめの描き直しは1フレームに1回にまとめる（連打で何度も組み立てないため） */
  let summaryQueued = false;
  function scheduleSummary() {
    if (summaryQueued) return;
    summaryQueued = true;
    window.requestAnimationFrame(function () {
      summaryQueued = false;
      renderStartSummary();
    });
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

        // 注意書きは選んだ種目のすぐ下に出す。
        // カテゴリの外（一覧の末尾）に置くと「JPAの説明」に見えてしまう
      });
      wrap.appendChild(body);
    });

  }

  function selectGame(id) {
    // 5-9 / 5-10 は人数もスコアの持ち方も違うため、専用画面へ回す。
    // ここで止めないと、A/B前提の勝利条件やハンデの欄が続けて描かれる
    const money = GAMES[id] && GAMES[id].moneyGame;
    if (money && typeof MONEYUI !== "undefined") {
      MONEYUI.open(money);
      return;
    }
    // カイルンも3人以上で遊べるようにしたので専用画面へ回す（本人の指示 2026-08-21）
    if (id === "kailun" && typeof KAILUNUI !== "undefined") {
      KAILUNUI.open();
      return;
    }
    selectedGame = id;
    const gSel = GAMES[id];
    doublesOn = !!(gSel && gSel.playersPerSide === 2);
    openGroup = groupOf(id);
    renderGames();
    const g = GAMES[id];
    const base = BASE_RULES[g.base];

    // 種目の注意書きは本人の指示（2026-08-20）で画面から削除した。
    // data/ 側の note や規程の根拠は 04_種目ルール仕様.md に残してある。

    // ブレイク方式の既定値。種目側の指定（JPAのウィナーズ固定）を優先する
    UI.setToggle($("breakTypeToggle"), g.defaultBreakType || base.defaultBreakType);

    // 1人でやる種目（ボウラード）は相手がいないのでブレイクの取り決めが無い。
    // 見出しごと消す（本人の指示 2026-08-20）
    const breakTitle = $("breakTitle");
    const firstField = $("firstSideField");
    if (breakTitle) breakTitle.hidden = !!g.solo;
    if (firstField) firstField.hidden = !!g.solo;

    // ローテーションやJPAのようにブレイク方式が決まっている種目では
    // 選択肢を出さない（選べるように見せて engine が無視するのは不誠実なため）
    const btField = $("breakTypeToggle").closest(".field");
    if (g.solo || g.breakTypeFixed || base.breakTypeFixed) {
      if (btField) btField.hidden = true;
      $("breakTypeNote").textContent = "";
    } else {
      if (btField) btField.hidden = false;
      $("breakTypeNote").textContent =
        (g.defaultBreakType || base.defaultBreakType) === "winner"
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
    renderHouseRules();
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

    // 8ボールは「N番以上で1点」という数え方をしない。
    // 自分のグループ球を1個減らす形のハンデを出す（本人の指示 2026-08-20）
    const isGroupGame = !!base.groupAssign;

    // 出せる種目かどうか。ラック単位で数える種目のみ。
    // さらに「ハンデあり」を選んでいるときだけ出す
    // （ハンデなしの人に球ごとの設定を見せても迷わせるだけのため）
    const usableGame = SCORING[g.scoring].kind === "rackCount" && !!base.keyBall;
    const usable = usableGame && goalMode === "handicap";
    section.hidden = !usable;
    if (!usable) {
      if (!usableGame) {
        ballHandicap = { A: null, B: null };
        memberHandicap = { A: [null, null], B: [null, null] };
      }
      return;
    }

    wrap.appendChild(
      UI.el("p", {
        class: "hint",
        // スマホで1行に収まる長さにする（本人の指示 2026-08-21）
        text: isGroupGame
          ? "弱い側は自分の球を1個残して8番を狙えます。"
          : "弱い側は番号の若い球でも得点になります。",
      })
    );

    // 選べる下限。7番から、キーボールの1つ手前まで（本人の指示 2026-08-20）。
    // 9ボールは7・8番、10ボールは7・8・9番。以前は「キーボールの手前2つ」だったため
    // 10ボールで7番が選べなかった
    const key = base.keyBall;
    const options = [];
    if (!isGroupGame) {
      for (let n = 7; n <= key - 1; n++) options.push(n);
    }

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

      // 8ボールの1ボールハンデ。落とす球が1個少なくて済む
      if (isGroupGame) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            "aria-pressed": String(ballHandicap[side] === GROUP_MINUS_1),
            text: "1ボールハンデ",
            onclick: function () {
              ballHandicap[side] = GROUP_MINUS_1;
              renderGoalArea();
            },
          })
        );
      }

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
        UI.el("div", { class: "field side-" + side.toLowerCase() },
              [UI.el("label", { text: label + " のハンデ" }), chips])
      );

      // ダブルスは「誰がどのハンデ球を持っているか」を人ごとに決められるようにする。
      // 得点計算はチーム単位のまま（どの球が落ちたかは人が見て入力するため、
      // アプリが「いまどちらが撞いているか」を知らなくても成り立つ）
      if (g.playersPerSide === 2) {
        const names = [
          readName("inName" + side, ""),
          readName("inName" + side + "2", ""),
        ];
        names.forEach(function (nm, i) {
          if (!nm) return;
          const mchips = UI.el("div", { class: "chips bh-chips" });
          mchips.appendChild(
            UI.el("button", {
              type: "button",
              class: "chip small-chip",
              "aria-pressed": String(memberHandicap[side][i] === null),
              text: "なし",
              onclick: function () {
                memberHandicap[side][i] = null;
                renderGoalArea();
              },
            })
          );
          options.forEach(function (n) {
            mchips.appendChild(
              UI.el("button", {
                type: "button",
                class: "chip small-chip",
                "aria-pressed": String(memberHandicap[side][i] === n),
                text: n + "番以上",
                onclick: function () {
                  memberHandicap[side][i] = n;
                  renderGoalArea();
                },
              })
            );
          });
          wrap.appendChild(
            UI.el("div", { class: "field member-bh side-" + side.toLowerCase() }, [
              UI.el("label", { text: "　" + nm + " が持つ球" }),
              mchips,
            ])
          );
        });
      }
    });

    // いまの設定を文章で確認できるようにする
    if (isGroupGame) {
      // 1行に収める。名前が長いと折り返すので「は」を省いて短くする
      const gsum = ["A", "B"].map(function (side) {
        return nameForSide(side) + " " +
          (ballHandicap[side] === GROUP_MINUS_1 ? "6個" : "7個");
      });
      wrap.appendChild(
        UI.el("p", { class: "hint bh-summary", text: "持つ球 " + gsum.join(" ／ ") })
      );
      wrap.appendChild(
        UI.el("p", {
          class: "hint",
          text: "どの球を残すかは2人で決めてください。",
        })
      );
      return;
    }

    // 1行に収める。「は」「で1点」を省き、見出しの語で意味を補う
    const summary = ["A", "B"].map(function (side) {
      const n = ballHandicap[side];
      return nameForSide(side) + " " + (n === null ? key + "番" : n + "番〜");
    });
    wrap.appendChild(
      UI.el("p", { class: "hint bh-summary", text: "1点になる球 " + summary.join(" ／ ") })
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

  /**
   * 選手の並べ方（本人の指示 2026-08-20）。
   *
   * ボタンで出すのは「自分」と「最近使った5人」だけ。
   * 登録が増えるとボタンが何十個も並んで探せなくなるため、
   * 残りはプルダウンにあいうえお順で入れる。
   *
   * @returns {{quick: Array, rest: Array}}
   */
  function splitPlayers(all) {
    const selfId = STORE.getSelfId ? STORE.getSelfId() : null;
    const quick = [];
    const seen = {};

    // 自分はいちばん先頭。いちばん多く使うため
    const me = all.find(function (p) { return selfId && p.id === selfId; });
    if (me) { quick.push(me); seen[me.id] = true; }

    // 最近使った順に5人まで
    all.slice()
      .filter(function (p) { return !seen[p.id] && p.lastUsedAt; })
      .sort(function (a, b) { return (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""); })
      .slice(0, 5)
      .forEach(function (p) { quick.push(p); seen[p.id] = true; });

    // まだ5人に足りなければ、登録の新しい順で埋める。
    // 登録したばかりで一度も試合していない人が1人もボタンに出ないと、
    // 登録した直後に名前を選べなくなるため（配列の末尾が最新の登録）
    for (let i = all.length - 1; i >= 0 && quick.length < 6; i--) {
      const p = all[i];
      if (seen[p.id]) continue;
      quick.push(p);
      seen[p.id] = true;
    }

    // 残りはあいうえお順（ブラウザの日本語照合に任せる）
    const rest = all
      .filter(function (p) { return !seen[p.id]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "ja"); });

    return { quick: quick, rest: rest };
  }

  function playerPicker(targetId, side) {
    const all = STORE.listPlayers();
    if (!all.length) return null;

    const wrap = UI.el("div", { class: "picker-wrap" });
    wrap.appendChild(UI.el("div", { class: "picker-label", text: "登録した人から選ぶ" }));

    const taken = takenNames(targetId);
    const chosen = currentName(targetId);
    const split = splitPlayers(all);
    const players = split.quick;

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
    if (chips.children.length) wrap.appendChild(chips);

    // ボタンに出していない人はプルダウンから選ぶ（あいうえお順）
    const rest = split.rest.filter(function (p) { return taken.indexOf(p.name) < 0; });
    if (rest.length) {
      const sel = UI.el("select", { class: "picker-select" });
      sel.appendChild(UI.el("option", { value: "", text: "ほかの人から選ぶ（" + rest.length + "人）" }));
      rest.forEach(function (p) {
        sel.appendChild(UI.el("option", { value: p.id, text: p.name }));
      });
      sel.addEventListener("change", function () {
        const p = rest.find(function (x) { return x.id === sel.value; });
        if (!p) return;
        const node = $(targetId);
        if (node) node.value = p.name;
        applyPlayerSkill(p, side);
        const g2 = GAMES[selectedGame];
        if (g2.playersPerSide === 2 && targetId === "inName" + side) {
          secondOpen[side] = true;
        }
        renderPlayerFields();
      });
      wrap.appendChild(sel);
    }
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
      // ダブルスは1人ずつ入れる（表が2人のSLを縦横で見る形のため）。
      // 入っている人のぶんだけ反映し、片方だけでも構わない
      const n1 = readName("inName" + side, "");
      const n2 = readName("inName" + side + "2", "");
      const p1 = STORE.findPlayerByName(n1);
      const p2 = STORE.findPlayerByName(n2);
      const v1 = p1 && p1.skill ? p1.skill[kind] : null;
      const v2 = p2 && p2.skill ? p2.skill[kind] : null;
      if (v1) memberSkills[side][0] = v1;
      if (v2) memberSkills[side][1] = v2;
      if (!v1 && !v2) return;
      skillLevels[side] = memberSkills[side][0] + memberSkills[side][1];
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
        // A側は青、B側は赤の枠線にする（本人の指示 2026-08-21・段階4）。
        // どちらの欄を触っているのかを、試合画面と同じ色で分かるようにする
        const field = UI.el("div", { class: "field side-" + side.toLowerCase() }, [
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
      const field = UI.el("div", { class: "field team-field side-" + side.toLowerCase() });
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

  /**
   * ボタンに出す勝利条件の値。
   *
   * ラック先取の種目は 3〜7先。
   * 点数で決める種目（14-1・カイルン）に「3先」は存在しないので出さない
   * （本人の指示 2026-08-20）。代わりに、その種目で実際に使う点数を出す。
   */
  function quickGoalValues(unit) {
    if (unit !== "点") return QUICK_RACES;
    const g = GAMES[selectedGame];
    const ps = (g && g.goalPresets) || [];
    return ps.map(function (x) { return x.v; });
  }

  /** ボタンに書く文字。ラックは「5先」、点数は「50点先取」 */
  function quickGoalLabel(unit, v) {
    return unit === "点" ? v + "点先取" : v + "先";
  }

  /** プルダウンに入れる値。種目の単位（ラック/点）で刻みを変える */
  function moreGoalValues(unit) {
    if (unit === "点") {
      // 30点以下は使わないので出さない（本人の指示 2026-08-21）。
      // 少ない点数で区切る種目（カイルンの5点先取など）は
      // 種目ごとのボタン（quickGoalValues）から選ぶ
      const out = [];
      for (let v = 40; v <= 100; v += 10) out.push(v);
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

    const quick = quickGoalValues(unit);
    if (quick.length) {
      const chips = UI.el("div", { class: "chips" });
      quick.forEach(function (v) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            "aria-pressed": String(value === v),
            text: quickGoalLabel(unit, v),
            onclick: function () { onPick(v); },
          })
        );
      });
      holder.appendChild(chips);
    }

    // ボタンに出していない値はプルダウンで選ぶ
    const more = moreGoalValues(unit);
    const sel = UI.el("select", { class: "goal-more" });
    const isQuick = quick.indexOf(value) >= 0;
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

  /**
   * セット数（何セット先取で試合の勝ちにするか）。
   *
   * 勝利条件（ラック数・点数）のすぐ下に置く（本人の指示 2026-08-21）。
   * 1〜5をボタン5つで1行に並べる。既定は1セット。
   * JPAは公式の対戦表で1本勝負と決まっているので出さない。
   */
  function setsAllowed(g) {
    if (!g || g.solo) return false;
    if (g.goal === "jpaSL" || g.goal === "jpaSL8") return false;
    return true;
  }

  function renderSetsField(wrap, g) {
    if (!setsAllowed(g)) return;
    const chips = UI.el("div", { class: "chips sets-chips" });
    [1, 2, 3, 4, 5].forEach(function (v) {
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip",
          "aria-pressed": String(setsToWin === v),
          text: v + "セット",
          onclick: function () { setsToWin = v; renderGoalArea(); },
        })
      );
    });
    wrap.appendChild(
      UI.el("div", { class: "field" }, [
        UI.el("label", { text: "何セット先取で勝ちか" }),
        chips,
      ])
    );
  }

  /**
   * 公式競技規程が無いゲームの、店ごとの決め方を選ばせる。
   *
   * カイルンは NBA 規程に章が無いハウスゲームで、
   * 「ミスでステップが戻るか」「1イニングに何点取れるか」「減点の付け方」が
   * 店ごとに違う。既定を勝手に決めず、その場で選べるようにする。
   */
  function renderHouseRules() {
    const section = $("houseRuleSection");
    const wrap = $("houseRuleArea");
    if (!section || !wrap) return;
    UI.clear(wrap);

    const g = GAMES[selectedGame];
    const base = BASE_RULES[g.base];
    const usable = !!(base && base.unverified && base.unverified.length);
    section.hidden = !usable;
    if (!usable) return;

    wrap.appendChild(
      UI.el("p", {
        class: "hint",
        text: "公式の規程が無いので、決め方を選びます。",
      })
    );

    const defs = [
      {
        key: "stepResetOnMiss",
        label: "ミスしたとき",
        opts: [
          { v: true, text: "最初から（1段階目に戻す）" },
          { v: false, text: "続きから（段階を保つ）" },
        ],
      },
      {
        key: "allowMultiScorePerInning",
        label: "1回の手番で",
        opts: [
          { v: true, text: "何点でも取れる" },
          { v: false, text: "1点まで" },
        ],
      },
    ];

    defs.forEach(function (d) {
      const chips = UI.el("div", { class: "chips" });
      d.opts.forEach(function (o) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            "aria-pressed": String(houseRule[d.key] === o.v),
            text: o.text,
            onclick: function () {
              houseRule[d.key] = o.v;
              renderHouseRules();
            },
          })
        );
      });
      wrap.appendChild(
        UI.el("div", { class: "field" }, [UI.el("label", { text: d.label }), chips])
      );
    });

    // 減点の付け方（このゲームだけにある仕組み）
    if (base.hasPenalty) {
      const cur = houseRule.penaltyMode || base.defaultPenaltyMode;
      const chips = UI.el("div", { class: "chips" });
      [
        { v: "selfMinus", text: "自分が1点減る" },
        { v: "othersPlus", text: "相手が1点増える" },
      ].forEach(function (o) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            "aria-pressed": String(cur === o.v),
            text: o.text,
            onclick: function () {
              houseRule.penaltyMode = o.v;
              renderHouseRules();
            },
          })
        );
      });
      wrap.appendChild(
        UI.el("div", { class: "field" }, [UI.el("label", { text: "反則のとき" }), chips])
      );
    }
  }

  function renderGoalArea() {
    const g = GAMES[selectedGame];
    const wrap = $("goalArea");
    UI.clear(wrap);

    // 1人でやる種目（ボウラード）は相手がいないので勝利条件が無い。
    // 見出しごと消す（本人の指示 2026-08-20）
    const goalTitle = $("goalTitle");
    if (g.solo) {
      if (goalTitle) goalTitle.hidden = true;
      wrap.hidden = true;
      renderSetsField(wrap, g);
      renderBallHandicap();
      return;
    }
    if (goalTitle) goalTitle.hidden = false;
    wrap.hidden = false;

    // JPAはスキルレベルから持ち点が決まるため、専用のUIにする
    if (g.goal === "jpaSL" || g.goal === "jpaSL8") {
      renderJpaGoalArea(g, wrap);
      renderSetsField(wrap, g);
      renderBallHandicap();
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
          UI.el("div", { class: "field" + (side ? " side-" + side.toLowerCase() : "") }, [
            UI.el("label", {
              text: side ? nameForSide(side) + " の目標（点）" : label,
            }),
            chips,
          ])
        );
      });

      renderSetsField(wrap, g);
      renderBallHandicap();
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
      renderSetsField(wrap, g);
      renderBallHandicap();
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
          UI.el("div", { class: "field side-" + side.toLowerCase() }, [
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

    renderSetsField(wrap, g);
    // ハンデの有無に連動してボールハンデの欄も出し入れする
    renderBallHandicap();
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

    /** SLを選ぶボタンの列を1つ作る。side は枠線の色（A=青／B=赤）に使う */
    function slRow(labelText, current, onPick, side) {
      const chips = UI.el("div", { class: "chips sl-chips" });
      range.forEach(function (sl) {
        chips.appendChild(
          UI.el("button", {
            type: "button",
            class: "chip",
            text: "SL" + sl,
            "aria-pressed": String(current === sl),
            onclick: function () { onPick(sl); renderJpaGoalArea(g, wrap); },
          })
        );
      });
      wrap.appendChild(
        UI.el("div", { class: "field" + (side ? " side-" + side.toLowerCase() : "") },
              [UI.el("label", { text: labelText }), chips])
      );
    }

    ["A", "B"].forEach(function (side) {
      const team = side === "A" ? "チームA" : "チームB";
      if (isDoubles) {
        // ダブルスは2人ぶん。合計ではなく1人ずつ選ぶ（本人提供の表が2次元のため）
        [0, 1].forEach(function (i) {
          const nm = readName("inName" + side + (i === 0 ? "" : "2"), "");
          slRow(team + "　" + (nm || (i + 1) + "人目") + " のSL",
                memberSkills[side][i],
                function (sl) {
                  memberSkills[side][i] = sl;
                  skillLevels[side] = memberSkills[side][0] + memberSkills[side][1];
                },
                side);
        });
      } else {
        slRow((side === "A" ? "プレーヤーA" : "プレーヤーB") + " のスキルレベル",
              skillLevels[side],
              function (sl) { skillLevels[side] = sl; },
              side);
      }
    });

    // 算出結果を表示する
    let targets = null;
    let err = null;
    try {
      if (is8) {
        targets = jpaGoal8Ball(skillLevels.A, skillLevels.B);
      } else if (isDoubles) {
        targets = jpaGoal9BallDoubles(memberSkills.A, memberSkills.B);
      } else {
        targets = jpaGoal9Ball(skillLevels.A, skillLevels.B);
      }
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
            // 1行に収めるため区切りは半角にする（本人の指示 2026-08-21）。
            // ダブルスは「2人のSL」を並べて出す
            text: isDoubles
              ? ("SL" + memberSkills.A.join("+") + " → " + targets.A + unit
                 + " ／ SL" + memberSkills.B.join("+") + " → " + targets.B + unit)
              : ("SL" + skillLevels.A + " → " + targets.A + unit + " ／ SL" +
                 skillLevels.B + " → " + targets.B + unit),
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
          text: "2人のSLを縦横で見る公式表から決まります。合計15までです。",
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
        // 名前を入れずに始めた側は「ゲスト」として扱い、選手一覧には登録しない
        // （本人の指示 2026-08-20）。「プレーヤーA」という名前の選手が
        // 一覧に溜まってしまっていた
        if (!n1) return { name: fallback, playerIds: [], guest: true };
        // JPAシングルスは、この試合で使ったスキルレベルをその人に覚えさせる。
        // 次回この人を選んだときに自動で入る
        const skill = kind ? (function () { const o = {}; o[kind] = skillLevels[side]; return o; })() : null;
        const p = STORE.upsertPlayer(n1, skill);
        return { name: n1, playerIds: p ? [p.id] : [] };
      }
      const n2 = readName("inName" + side + "2", "");
      const names = [n1, n2].filter(Boolean);
      // 2人とも名前が無ければチームごとゲスト扱い
      if (!names.length) {
        return {
          name: fallback,
          teamLabel: side === "A" ? "チームA" : "チームB",
          members: [],
          playerIds: [],
          guest: true,
        };
      }
      const label = names.join("・");
      const ids = names
        .map(function (n) {
          const p = STORE.upsertPlayer(n);
          return p ? p.id : null;
        })
        .filter(Boolean);
      // ダブルスは「チームA（2人の名前）」と出したいので、
      // チーム名とメンバーを分けて持つ（表示側で組み立てる）
      return {
        name: label,
        teamLabel: side === "A" ? "チームA" : "チームB",
        members: names,
        playerIds: ids,
      };
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
      if (from === GROUP_MINUS_1) {
        // 8ボールの1ボールハンデ。得点の数え方は変えない（表示と記録だけ）
        out[side] = { groupMinus: 1 };
        return;
      }
      out[side] = {
        from: from, // 表示用。「7番以上」と出すために持っておく
        scoringBalls: base.balls.filter(function (b) { return b >= from; }),
      };
    });
    return out;
  }

  /**
   * ダブルスの個人ごとのハンデを、試合の記録用にまとめる。
   *
   * 表示のためだけの情報なので、得点計算には渡さない。
   * { A: [{name, from}, ...], B: [...] } の形にする。
   */
  function buildMemberHandicap(g) {
    if (g.playersPerSide !== 2) return null;
    const out = { A: [], B: [] };
    ["A", "B"].forEach(function (side) {
      [readName("inName" + side, ""), readName("inName" + side + "2", "")]
        .forEach(function (nm, i) {
          if (!nm) return;
          out[side].push({ name: nm, from: memberHandicap[side][i] });
        });
    });
    if (!out.A.length && !out.B.length) return null;
    return out;
  }

  function buildGoal(g) {
    const isJpa = g.goal === "jpaSL" || g.goal === "jpaSL8";
    const bh = buildBallHandicap(g);
    // 点数制に切り替えるのは「得点になる球を絞った」ときだけ。
    // 8ボールの1ボールハンデは数え方を変えないので、ラック先取のままにする
    const hasBh = ["A", "B"].some(function (s) {
      return !!(bh[s] && bh[s].scoringBalls && bh[s].scoringBalls.length);
    });

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
      // ダブルスの個人ごとのハンデ（表示用。得点計算には使わない）
      memberHandicap: buildMemberHandicap(g),
      // 何セット先取か。1なら今までどおり1本勝負
      sets: setsAllowed(g) ? setsToWin : 1,
      raceType: "raceTo",
    };
  }

  /**
   * 「この内容で始めます」のまとめ。1行につき1項目で出す（本人の指示 2026-08-20）。
   *
   * 始めたあとに直せない項目（勝利条件・ハンデ・ブレイク方式）があるため、
   * 押す直前に一覧で確かめられるようにする。
   *
   * ここでは STORE を一切触らない。buildSides() は選手を登録してしまうので呼ばない
   * （まとめを描くたびに選手が増えてしまう）。
   */
  function renderStartSummary() {
    const wrap = $("startSummary");
    if (!wrap) return;
    UI.clear(wrap);

    const g = GAMES[selectedGame];
    if (!g) return;
    const base = BASE_RULES[g.base];
    const rows = [];
    function add(label, value) {
      if (value === null || value === undefined || value === "") return;
      wrap.appendChild(
        UI.el("div", { class: "ss-row" }, [
          UI.el("span", { class: "ss-key", text: label + "：" }),
          UI.el("span", { class: "ss-val", text: String(value) }),
        ])
      );
      rows.push(label);
    }

    add("競技種目", g.label);

    // プレーヤー
    function sideName(side) {
      const n1 = readName("inName" + side, "");
      if (g.playersPerSide === 2) {
        const n2 = readName("inName" + side + "2", "");
        const names = [n1, n2].filter(Boolean);
        return names.length ? names.join("・") : "ゲスト";
      }
      return n1 || "ゲスト";
    }
    if (g.solo) add("プレーヤー", sideName("A"));
    else add("プレーヤー", sideName("A") + " 対 " + sideName("B"));

    // 勝利条件。1人用の種目には無い
    if (!g.solo) {
      const isJpa = g.goal === "jpaSL" || g.goal === "jpaSL8";
      if (isJpa) {
        const unit = g.goal === "jpaSL8" ? "ゲーム先取" : "点先取";
        if (g.playersPerSide === 2) {
          add("スキルレベル", "SL" + memberSkills.A.join("+")
            + " 対 SL" + memberSkills.B.join("+"));
        } else {
          add("スキルレベル", "SL" + skillLevels.A + " 対 SL" + skillLevels.B);
        }
        add("勝利条件", sideName("A") + " " + goalValues.A + unit
          + " ／ " + sideName("B") + " " + goalValues.B + unit);
      } else if (g.goalHidden) {
        add("勝利条件", g.goalHiddenNote || "この種目は決まった点数で行います。");
      } else {
        const scored = ["A", "B"].some(function (s) {
          return ballHandicap[s] !== null && ballHandicap[s] !== GROUP_MINUS_1;
        });
        const unit = scored ? "点" : (g.goalType === "racks" ? "ラック" : "点");
        if (goalMode === "same" && goalValues.A === goalValues.B) {
          add("勝利条件", goalValues.A + unit + "先取");
        } else {
          add("勝利条件", sideName("A") + " " + goalValues.A + unit
            + " ／ " + sideName("B") + " " + goalValues.B + unit);
        }
      }

      if (setsAllowed(g) && setsToWin > 1) add("セット数", setsToWin + "セット先取");

      // ハンデ
      const hParts = ["A", "B"].map(function (side) {
        const v = ballHandicap[side];
        if (v === null || v === undefined) return null;
        return sideName(side) + "は"
          + (v === GROUP_MINUS_1 ? "1ボールハンデ（グループ球を1個減らす）" : v + "番以上で1点");
      }).filter(Boolean);
      add("ハンデ", hParts.length ? hParts.join(" ／ ") : "なし");

      // ダブルスの個人ごとのハンデ
      if (g.playersPerSide === 2) {
        const mParts = [];
        ["A", "B"].forEach(function (side) {
          [readName("inName" + side, ""), readName("inName" + side + "2", "")]
            .forEach(function (nm, i) {
              if (!nm || memberHandicap[side][i] === null) return;
              mParts.push(nm + "は" + memberHandicap[side][i] + "番以上");
            });
        });
        if (mParts.length) add("個人のハンデ", mParts.join(" ／ "));
      }
    }

    // ブレイク。方式が決まっている種目では選ばせていないので出さない
    if (!g.solo && !(g.breakTypeFixed || base.breakTypeFixed)) {
      const bt = UI.toggleValue($("breakTypeToggle"));
      add("ブレイク方式", bt === "alternate" ? "オルタネート（交互）" : "ウィナーズ（勝った側）");
    }
    if (!g.solo) {
      const first = UI.toggleValue($("firstSideToggle")) || "A";
      add("先にブレイクする人", sideName(first));
    }

    // 時計
    const ct = clockType();
    if (ct === "shot") {
      add("時計", "ショットクロック " + num("scSeconds", 45) + "秒");
    } else if (ct === "chess") {
      add("時計", "チェスクロック " + num("ccMinutes", 30) + "分");
    } else {
      add("時計", "使わない");
    }

    // ハウス設定（公式規程が無い種目）
    if (base.hasPenalty) {
      add("反則の扱い", houseRule.penaltyMode === "othersPlus"
        ? "他の人に+1点" : "自分が-1点");
      add("ミスでステップ", houseRule.stepResetOnMiss ? "1に戻す" : "戻さない");
      add("1イニング内の連続得点", houseRule.allowMultiScorePerInning ? "できる" : "できない");
    }

    if (!rows.length) {
      wrap.appendChild(UI.el("p", { class: "hint", text: "種目を選んでください。" }));
    }
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
        breakType: g.breakTypeFixed
          ? (g.defaultBreakType || BASE_RULES[g.base].defaultBreakType)
          : (UI.toggleValue($("breakTypeToggle")) || g.defaultBreakType || BASE_RULES[g.base].defaultBreakType),
        shotClock: buildShotClock(),
        chessClock: buildChessClock(),
        inputMode: g.mode,
        // ハウス設定（公式規程が無い種目でのみ使う）
        penaltyMode: houseRule.penaltyMode || BASE_RULES[g.base].defaultPenaltyMode,
        stepResetOnMiss: houseRule.stepResetOnMiss,
        allowMultiScorePerInning: houseRule.allowMultiScorePerInning,
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

  /**
   * 種目選択と同じ並び順のID一覧（成績画面などから使う）。
   * ここを唯一の出どころにして、画面ごとに並びがずれないようにする。
   * ダブルスは親種目のすぐ後ろに入れる。
   */
  function gameOrder() {
    return AVAILABLE.slice();
  }

  return { init: init, gameOrder: gameOrder };
})();
