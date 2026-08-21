/**
 * ui_import.js — 届いた試合を取り込む画面（本人の指示 2026-08-21）
 *
 * 相手から送られたリンクを開くと、この画面が出る。
 *
 * 本人の心配（「万が一名前が違った場合はどうなる？」）に対して:
 *   送られてきた名前をそのまま信じず、**取り込む前に対応付けを1回だけ確認する**。
 *   ・名前が一致する人がいれば、それを選んだ状態にしておく
 *   ・一致しなければ空にして「登録済みから選ぶ／新しく登録する／成績に入れない」
 *   ・何も選ばなければ「成績に入れない（記録だけ残す）」に倒す
 *     → 間違った人の勝率が動くことはない
 *   ・一度対応付けたら覚えるので、次からは自動で埋まる
 */
const IMPORTUI = (function () {
  "use strict";

  const $ = UI.$;

  let payload = null;
  // どちらの側を、この端末の誰として数えるか。null なら成績に入れない
  let mapping = { A: null, B: null };
  let bound = false;
  // 「#」の変化を見張っているか（同じ画面のままリンクを踏んだ場合の対応）
  let watching = false;

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("importCloseBtn").addEventListener("click", function () {
      SHARE.clearHash();
      payload = null;
      UI.showScreen("screenSetup");
    });
  }

  /**
   * アプリを開いたままリンクを踏んだときも取り込めるようにする。
   *
   * 同じページの「#」だけが変わる移動では、ブラウザは読み込み直さない。
   * 起動時の1回だけを見ていると、その場合に何も起きなかった
   * （実測で確認 2026-08-22）。
   */
  function watchHash() {
    if (watching) return;
    watching = true;
    window.addEventListener("hashchange", function () { checkHash(); });
  }

  /** 起動時と、「#」が変わったときに呼ぶ。記録が入っていれば取り込み画面を開く */
  function checkHash() {
    watchHash();
    const body = SHARE.readHash();
    if (!body) return false;
    SHARE.decode(body).then(function (obj) {
      open(obj);
    }).catch(function (e) {
      SHARE.clearHash();
      UI.toast("この記録は読めませんでした（" + (e && e.message) + "）", "warn");
    });
    return true;
  }

  function open(obj) {
    bindOnce();
    payload = obj;
    mapping = {
      A: SHARE.guessPlayer(sideName("A")),
      B: SHARE.guessPlayer(sideName("B")),
    };
    render();
    UI.showScreen("screenImport");
  }

  function sideOf(id) {
    return (payload.sides || []).find(function (s) { return s.sideId === id; }) || {};
  }

  function sideName(id) {
    return sideOf(id).name || (id === "A" ? "プレーヤーA" : "プレーヤーB");
  }

  function gameLabel() {
    const g = (typeof GAMES !== "undefined" && GAMES[payload.gameId]) || null;
    return g ? g.label : payload.gameId;
  }

  function scoreText() {
    const r = payload.result;
    if (!r) return "まだ終わっていない記録です";
    if (r.racks && (r.racks.A || r.racks.B) && !(r.scores && (r.scores.A || r.scores.B))) {
      return r.racks.A + " - " + r.racks.B + "（ラック）";
    }
    if (r.scores) return r.scores.A + " - " + r.scores.B + "（点）";
    return "—";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 "
      + String(d.getHours()).padStart(2, "0") + ":"
      + String(d.getMinutes()).padStart(2, "0");
  }

  /* ---------- 画面 ---------- */

  function render() {
    const body = $("importBody");
    UI.clear(body);
    if (!payload) return;

    const dup = SHARE.alreadyHave(payload.id);
    const sub = $("importSub");
    if (sub) sub.textContent = dup ? "この試合はもう持っています" : "記録が送られてきました";

    // ---- 届いた中身 ----
    const card = UI.el("div", { class: "match-card import-card" }, [
      UI.el("div", { class: "mc-game", text: gameLabel() }),
      UI.el("div", { class: "mc-main" }, [
        UI.el("span", { class: "mc-nm" }, [UI.el("span", { text: sideName("A") })]),
        UI.el("span", { class: "mc-score", text: scoreText() }),
        UI.el("span", { class: "mc-nm" }, [UI.el("span", { text: sideName("B") })]),
      ]),
      UI.el("p", { class: "hint", text: fmtDate(payload.createdAt) }),
    ]);
    if (payload.result && payload.result.winner) {
      card.appendChild(
        UI.el("p", { class: "hint", text: sideName(payload.result.winner) + " の勝ちです。" })
      );
    }
    if (payload.slim) {
      card.appendChild(
        UI.el("p", {
          class: "hint",
          text: "記録が長かったため、1球ごとの記録は入っていません（結果だけ）。",
        })
      );
    }
    body.appendChild(card);

    // ---- もう持っているとき ----
    if (dup) {
      body.appendChild(
        UI.el("div", { class: "card-note warn-note" }, [
          UI.el("p", { text: "同じ試合がすでに記録にあります。取り込むと二重になります。" }),
        ])
      );
    }

    // ---- 誰として数えるか ----
    body.appendChild(UI.el("div", { class: "section-title", text: "この人は誰ですか" }));
    body.appendChild(
      UI.el("p", {
        class: "hint",
        text: "選ばなかった側は成績に入れず、記録だけを残します。"
          + "名前が違っていても、ここで選べば正しく数えられます。",
      })
    );
    ["A", "B"].forEach(function (id) { body.appendChild(mapRow(id)); });

    // ---- 取り込む ----
    const btn = UI.el("button", {
      class: "primary",
      style: "width:100%;margin-top:14px",
      text: dup ? "それでも取り込む" : "この試合を取り込む",
      onclick: UI.guard(doImport),
    });
    body.appendChild(btn);

    body.appendChild(
      UI.el("button", {
        class: "ghost",
        style: "width:100%;margin-top:8px",
        text: "取り込まない",
        onclick: function () { $("importCloseBtn").click(); },
      })
    );
  }

  /** 片方ぶんの対応付けの行 */
  function mapRow(id) {
    const wrap = UI.el("div", { class: "field import-map" });
    const chosen = mapping[id];
    const me = STORE.getSelf();

    wrap.appendChild(
      UI.el("label", {
        class: "side-" + id.toLowerCase(),
        text: "送られてきた名前： " + sideName(id),
      })
    );

    const chips = UI.el("div", { class: "chips" });
    // 自分をいちばん先に出す（いちばん多く選ぶため）
    const players = STORE.listPlayers().slice().sort(function (a, b) {
      if (me && a.id === me.id) return -1;
      if (me && b.id === me.id) return 1;
      return a.name.localeCompare(b.name, "ja");
    });
    players.forEach(function (p) {
      // 反対側で選ばれている人は出さない（同じ人を両側にできないため）
      const other = id === "A" ? "B" : "A";
      if (mapping[other] === p.id) return;
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip" + (chosen === p.id ? " is-on" : ""),
          "aria-pressed": String(chosen === p.id),
          text: p.name + (me && p.id === me.id ? "（自分）" : ""),
          onclick: function () {
            mapping[id] = chosen === p.id ? null : p.id;
            render();
          },
        })
      );
    });
    wrap.appendChild(chips);

    const row = UI.el("div", { class: "chips" });
    row.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip" + (chosen === null ? " is-on" : ""),
        "aria-pressed": String(chosen === null),
        text: "成績に入れない",
        onclick: function () { mapping[id] = null; render(); },
      })
    );
    row.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip",
        text: "「" + sideName(id) + "」を新しく登録する",
        onclick: UI.guard(function () {
          const p = STORE.upsertPlayer(sideName(id));
          if (!p) { UI.toast("登録できませんでした。", "warn"); return; }
          mapping[id] = p.id;
          UI.toast("「" + sideName(id) + "」を登録しました。");
          render();
        }),
      })
    );
    wrap.appendChild(row);

    // いまの選び方を文章で出す（読み違いを防ぐ）
    const now = chosen ? (STORE.findPlayerById(chosen) || {}).name : null;
    wrap.appendChild(
      UI.el("p", {
        class: "hint",
        text: now ? "→ " + now + " として数えます"
          : "→ 成績には入れません（記録だけ残します）",
      })
    );
    return wrap;
  }

  function doImport() {
    if (!payload) return;
    const saved = SHARE.importMatch(payload, mapping);
    if (!saved) {
      UI.toast("保存できませんでした。空き容量を確認してください。", "danger");
      return;
    }
    SHARE.clearHash();
    const names = ["A", "B"].map(function (id) {
      const pid = mapping[id];
      return pid ? (STORE.findPlayerById(pid) || {}).name : sideName(id);
    });
    payload = null;
    UI.toast("取り込みました（" + names.join(" 対 ") + "）。");
    if (typeof HISTORY !== "undefined") HISTORY.open();
    else UI.showScreen("screenSetup");
  }

  return { checkHash: checkHash, open: open };
})();
