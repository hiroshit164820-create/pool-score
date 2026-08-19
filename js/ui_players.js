/**
 * ui_players.js — プレーヤー登録と成績表示
 *
 * 成績は「登録したプレーヤーが参加した、確定済みの試合」だけを集計する。
 * 名前だけ入力していた過去の試合は含めない。
 */

const PLAYERS = (function () {
  const $ = UI.$;
  let bound = false;
  let statsTarget = null; // 表示中のプレーヤー

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("addPlayerBtn").addEventListener("click", UI.guard(addPlayer));
    $("newPlayerName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") addPlayer();
    });
    $("backFromPlayersBtn").addEventListener("click", function () { UI.showScreen("screenSetup"); });
    $("playersNewMatchBtn").addEventListener("click", function () { UI.showScreen("screenSetup"); });
    $("playersToStatsBtn").addEventListener("click", function () { openStats(null); });
    $("backFromStatsBtn").addEventListener("click", function () { open(); });
  }

  function open() {
    bindOnce();
    renderNewSkill();
    render();
    UI.showScreen("screenPlayers");
  }

  // 新規登録フォームで選択中のスキルレベル
  let newSkill = { nine: null, eight: null };

  function addPlayer() {
    const input = $("newPlayerName");
    const name = (input.value || "").trim();
    if (!name) {
      UI.toast("名前を入力してください。", "warn");
      return;
    }
    if (STORE.findPlayerByName(name)) {
      UI.toast("「" + name + "」はすでに登録されています。", "warn");
      return;
    }
    STORE.upsertPlayer(name, { nine: newSkill.nine, eight: newSkill.eight });
    input.value = "";
    newSkill = { nine: null, eight: null };
    renderNewSkill();
    render();
    UI.toast("「" + name + "」を登録しました。");
  }

  /** JPAスキルレベルの選択欄。未選択のままでも登録できる（任意項目） */
  function skillChips(kind, current, onPick) {
    const range = kind === "eight" ? [2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const chips = UI.el("div", { class: "chips sl-chips" });
    chips.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip small-chip",
        "aria-pressed": String(!current),
        text: "未設定",
        onclick: function () { onPick(null); },
      })
    );
    range.forEach(function (sl) {
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip small-chip",
          "aria-pressed": String(current === sl),
          text: String(sl),
          onclick: function () { onPick(sl); },
        })
      );
    });
    return chips;
  }

  /** 新規登録フォームのスキルレベル欄を描き直す */
  function renderNewSkill() {
    const wrap = $("newPlayerSkill");
    if (!wrap) return;
    UI.clear(wrap);
    wrap.appendChild(
      UI.el("p", { class: "hint", text: "JPAのスキルレベル（任意・あとから変えられます）" })
    );
    [["nine", "9ボール"], ["eight", "8ボール"]].forEach(function (pair) {
      wrap.appendChild(
        UI.el("div", { class: "field sl-field" }, [
          UI.el("label", { text: pair[1] }),
          skillChips(pair[0], newSkill[pair[0]], function (v) {
            newSkill[pair[0]] = v;
            renderNewSkill();
          }),
        ])
      );
    });
  }

  function render() {
    const list = $("playerList");
    UI.clear(list);
    const players = STORE.listPlayers();

    if (!players.length) {
      list.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ誰も登録されていません。" }),
          UI.el("p", { text: "上の欄から名前を登録してください。" }),
        ])
      );
      return;
    }

    players.forEach(function (p) {
      const st = STORE.playerStats(p.id);
      const card = UI.el("div", { class: "match-card" });

      card.appendChild(
        UI.el("div", { class: "mc-main" }, [
          UI.el("span", { style: "flex:1;min-width:0", text: p.name }),
          UI.el("span", {
            class: "mc-score",
            text: st.matches ? st.wins + "勝" + st.losses + "敗" : "記録なし",
          }),
        ])
      );

      if (st.matches) {
        card.appendChild(
          UI.el("p", {
            class: "hint",
            text: "勝率 " + pct(st.winRate) + "／" + st.matches + "試合",
          })
        );
      }

      // JPAスキルレベル（設定済みなら表示、押すと編集欄が開く）
      const sk = p.skill || {};
      const slText = [];
      if (sk.nine) slText.push("9ボール SL" + sk.nine);
      if (sk.eight) slText.push("8ボール SL" + sk.eight);
      card.appendChild(
        UI.el("p", {
          class: "hint sl-line",
          text: slText.length ? "JPA " + slText.join("／") : "JPAスキルレベル未設定",
        })
      );

      const slEdit = UI.el("div", { class: "sl-edit", hidden: "hidden" });
      function renderSlEdit() {
        UI.clear(slEdit);
        const cur = STORE.findPlayerById(p.id) || p;
        [["nine", "9ボール"], ["eight", "8ボール"]].forEach(function (pair) {
          slEdit.appendChild(
            UI.el("div", { class: "field sl-field" }, [
              UI.el("label", { text: pair[1] + " のスキルレベル" }),
              skillChips(pair[0], (cur.skill || {})[pair[0]] || null, function (v) {
                // v が null なら未設定に戻す
                const next = {};
                next[pair[0]] = v;
                STORE.setPlayerSkill(p.id, next);
                render();
              }),
            ])
          );
        });
      }
      card.appendChild(slEdit);

      const foot = UI.el("div", { style: "margin-top:8px;display:flex;gap:8px;flex-wrap:wrap" });
      foot.appendChild(
        UI.el("button", {
          class: "small primary",
          text: "成績を見る",
          onclick: function () { openStats(p); },
        })
      );
      foot.appendChild(
        UI.el("button", {
          class: "small ghost",
          text: "スキルレベル",
          onclick: function () {
            const opening = slEdit.hidden;
            if (opening) renderSlEdit();
            slEdit.hidden = !opening;
          },
        })
      );
      foot.appendChild(
        UI.el("button", {
          class: "small ghost",
          text: "名前を変更",
          onclick: function () {
            const nv = window.prompt("新しい名前を入力してください。", p.name);
            if (nv && nv.trim() && nv.trim() !== p.name) {
              STORE.renamePlayer(p.id, nv);
              render();
              UI.toast("名前を変更しました。");
            }
          },
        })
      );
      foot.appendChild(
        UI.el("button", {
          class: "small ghost",
          text: "削除",
          onclick: function () {
            if (!window.confirm([
              "「" + p.name + "」を登録から外します。",
              "",
              "これまでの試合の記録は残りますが、この人の成績は見られなくなります。",
              "よろしいですか？",
            ].join(String.fromCharCode(10)))) return;
            STORE.deletePlayer(p.id);
            render();
            UI.toast("削除しました。");
          },
        })
      );
      card.appendChild(foot);
      list.appendChild(card);
    });
  }

  function pct(v) {
    return v === null || v === undefined ? "—" : Math.round(v * 100) + "%";
  }

  function sec(v) {
    return v === null || v === undefined ? "—" : v.toFixed(1) + "秒";
  }

  /** 成績画面。player を渡すとその人、null なら全員の一覧 */
  function openStats(player) {
    bindOnce();
    statsTarget = player;
    const body = $("statsBody");
    UI.clear(body);

    const players = STORE.listPlayers();
    if (!players.length) {
      body.appendChild(
        UI.el("div", { class: "empty" }, [UI.el("p", { text: "先にプレーヤーを登録してください。" })])
      );
      UI.showScreen("screenStats");
      return;
    }

    if (!player) {
      // 全員の一覧（勝率順）
      const rows = players
        .map(function (p) { return { p: p, st: STORE.playerStats(p.id) }; })
        .sort(function (a, b) {
          if (!a.st.matches) return 1;
          if (!b.st.matches) return -1;
          return b.st.winRate - a.st.winRate;
        });

      body.appendChild(UI.el("p", { class: "hint", text: "登録したプレーヤーの成績です。名前を押すと詳しく見られます。" }));
      rows.forEach(function (r) {
        const card = UI.el("div", {
          class: "match-card",
          style: "cursor:pointer",
          onclick: function () { openStats(r.p); },
        });
        card.appendChild(
          UI.el("div", { class: "mc-main" }, [
            UI.el("span", { style: "flex:1;min-width:0", text: r.p.name }),
            UI.el("span", { class: "mc-score", text: r.st.matches ? pct(r.st.winRate) : "—" }),
          ])
        );
        card.appendChild(
          UI.el("p", {
            class: "hint",
            text: r.st.matches
              ? r.st.matches + "試合 " + r.st.wins + "勝" + r.st.losses + "敗"
              : "まだ記録がありません",
          })
        );
        body.appendChild(card);
      });
      UI.showScreen("screenStats");
      return;
    }

    // 個人の詳細
    const st = STORE.playerStats(player.id);
    body.appendChild(UI.el("h2", { style: "margin:0 0 12px;font-size:20px", text: player.name }));

    if (!st.matches) {
      body.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ記録がありません。" }),
          UI.el("p", { text: "試合を作るときに、この名前を選んでください。" }),
        ])
      );
      UI.showScreen("screenStats");
      return;
    }

    // 主要な数字
    const main = [
      ["試合数", st.matches + "試合"],
      ["勝率", pct(st.winRate) + "（" + st.wins + "勝" + st.losses + "敗）"],
      ["ラック取得率", pct(st.rackWinRate)],
      ["マスワリ", st.masuwari + "回" + (st.masuwariRate !== null ? "（" + pct(st.masuwariRate) + "）" : "")],
      ["ブレイクエース", st.breakAce + "回"],
      ["セーフティ", st.safety + "回"],
      ["ファウル", st.fouls + "回"],
    ];
    body.appendChild(statTable("成績", main));

    // ショットクロックの平均タイム
    if (st.shotClockShots) {
      body.appendChild(
        statTable("ショットクロック", [
          ["平均タイム", sec(st.avgShotSec)],
          ["計測したショット", st.shotClockShots + "回"],
          ["時間切れ", st.shotClockViolations + "回"],
          ["延長の使用", st.shotClockExtensions + "回"],
        ])
      );
    } else {
      body.appendChild(
        UI.el("p", {
          class: "hint",
          text: "ショットクロックの平均タイムは、ショットクロックを使った試合でのみ記録されます。",
        })
      );
    }

    // 種目別
    const byGame = Object.keys(st.byGame).map(function (k) {
      const g = st.byGame[k];
      return [g.label, g.matches + "試合 " + g.wins + "勝（" + Math.round((g.wins / g.matches) * 100) + "%）"];
    });
    if (byGame.length) body.appendChild(statTable("種目別", byGame));

    // 対戦相手別
    const byOpp = Object.keys(st.opponents).map(function (k) {
      const o = st.opponents[k];
      return [k, o.matches + "試合 " + o.wins + "勝（" + Math.round((o.wins / o.matches) * 100) + "%）"];
    });
    if (byOpp.length) body.appendChild(statTable("対戦相手別", byOpp));

    body.appendChild(
      UI.el("button", {
        class: "ghost",
        style: "width:100%;margin-top:12px",
        text: "一覧に戻る",
        onclick: function () { openStats(null); },
      })
    );

    UI.showScreen("screenStats");
  }

  function statTable(title, rows) {
    const wrap = UI.el("div", { class: "match-card" });
    wrap.appendChild(UI.el("div", { class: "stat-title", text: title }));
    rows.forEach(function (r) {
      wrap.appendChild(
        UI.el("div", { class: "stat-row" }, [
          UI.el("span", { class: "stat-key", text: r[0] }),
          UI.el("span", { class: "stat-val", text: r[1] }),
        ])
      );
    });
    return wrap;
  }

  return { open: open, openStats: openStats, render: render };
})();
