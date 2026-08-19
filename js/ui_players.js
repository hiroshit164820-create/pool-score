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
    render();
    UI.showScreen("screenPlayers");
  }

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
    STORE.upsertPlayer(name);
    input.value = "";
    render();
    UI.toast("「" + name + "」を登録しました。");
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
