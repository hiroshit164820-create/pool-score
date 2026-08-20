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
  let sortMode = "name"; // name | recent | wins
  // スキルレベルの編集欄を開いている人のID（再描画しても開いたままにする）
  let openSkillFor = null;
  // 「名前を変更・削除」を開いている人のID
  let openEditFor = null;

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("addPlayerBtn").addEventListener("click", UI.guard(addPlayer));
    $("newPlayerName").addEventListener("keydown", function (e) {
      if (e.key === "Enter") addPlayer();
    });
    // 名前を入れるまでスキルレベル欄は出さない。
    // 空欄のまま選択肢が並んでいると、何を設定しているのか分からなくなるため
    $("newPlayerName").addEventListener("input", renderNewSkill);
    $("backFromPlayersBtn").addEventListener("click", function () { UI.showScreen("screenSetup"); });

    // 登録フォームの開閉。ふだんは畳んでおき、一覧を主役にする。
    // 自分と対戦相手で同じ欄を使い、どちらを登録中かだけを持つ
    $("toggleAddPlayerBtn").addEventListener("click", function () {
      toggleForm("other");
    });
    $("toggleSelfBtn").addEventListener("click", function () {
      toggleForm("self");
    });

    // 絞り込みと並び替え
    $("playerSearch").addEventListener("input", render);
    UI.bindToggle($("playerSortToggle"), function (v) {
      sortMode = v;
      render();
    });
    // 選手一覧の下部にあった「成績を見る」「新しい試合」は本人の指示で撤去した。
    // 同じ導線は下部タブとホーム画面にあり、二重に置くと一覧が短く見えるため。
    // （HTML側の .bottom-bar は別セッションが同ファイルを編集中のためJSで取り除く）
    const legacyBar = $("playersNewMatchBtn") && $("playersNewMatchBtn").closest(".bottom-bar");
    if (legacyBar && legacyBar.parentNode) legacyBar.parentNode.removeChild(legacyBar);

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

  /** いま登録しようとしているのが自分か対戦相手か */
  let addMode = "other";

  /**
   * 登録フォームを開け閉めする。
   * 同じ欄を使い回すので、押されたボタンと今の状態から開閉を決める。
   */
  function toggleForm(mode) {
    const body = $("addPlayerBody");
    // 閉じているか、別の種類を押したときは開く（種類だけ切り替える）
    const opening = body.hidden || addMode !== mode;
    addMode = mode;
    body.hidden = !opening;
    syncFormLabels(opening);
    if (opening) {
      renderNewSkill();
      const nameInput = $("newPlayerName");
      if (nameInput) nameInput.focus();
    }
  }

  /** 開いている欄がどちらの登録なのかを見て分かるようにする */
  function syncFormLabels(open) {
    const self = addMode === "self";
    $("toggleSelfBtn").setAttribute("aria-expanded", String(!!open && self));
    $("toggleAddPlayerBtn").setAttribute("aria-expanded", String(!!open && !self));
    const label = $("newPlayerLabel");
    if (label) label.textContent = self ? "自分の名前" : "対戦相手の名前";
    const input = $("newPlayerName");
    if (input) {
      input.placeholder = self ? "自分の名前を入力" : "相手の名前を入力";
    }
    const btn = $("addPlayerBtn");
    if (btn) btn.textContent = self ? "自分として登録" : "登録";
  }

  /** ホームから「自分を登録する」で呼ばれる */
  function openSelfRegister() {
    open();
    const body = $("addPlayerBody");
    if (body) body.hidden = true;
    toggleForm("self");
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
    const created = STORE.upsertPlayer(name, { nine: newSkill.nine, eight: newSkill.eight });
    // 自分として登録したときだけ、自分の指定を差し替える
    const asSelf = (addMode === "self");
    if (asSelf && created) STORE.setSelf(created.id);
    input.value = "";
    newSkill = { nine: null, eight: null };
    renderNewSkill();
    // 登録したら畳む。続けて登録したいときはもう一度開く
    $("addPlayerBody").hidden = true;
    syncFormLabels(false);
    render();
    UI.toast("「" + name + "」を" + (asSelf ? "自分として" : "") + "登録しました。");
    if (asSelf && typeof HOME !== "undefined") HOME.render();
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

  /**
   * 新規登録フォームのスキルレベル欄を描き直す。
   *
   * 名前が入力されるまでは出さない。
   * 誰のスキルレベルを設定しているのか分からない状態で
   * 選択肢だけが並んでいると迷うため。
   */
  function renderNewSkill() {
    const wrap = $("newPlayerSkill");
    if (!wrap) return;
    UI.clear(wrap);

    const name = (($("newPlayerName") || {}).value || "").trim();
    if (!name) {
      wrap.appendChild(
        UI.el("p", { class: "hint", text: "名前を入れると、JPAのスキルレベルも設定できます。" })
      );
      return;
    }

    wrap.appendChild(
      UI.el("p", {
        class: "hint sl-prompt",
        text: name + " のJPAスキルレベル（任意・あとから変えられます）",
      })
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

  /** 一覧の並び替え。指定された順に並べたコピーを返す */
  function sortPlayers(players, mode) {
    const withStats = players.map(function (p) {
      return { p: p, st: STORE.playerStats(p.id) };
    });

    if (mode === "recent") {
      // 最近使った順。使ったことがない人は後ろにまとめる
      withStats.sort(function (a, b) {
        const ta = a.p.lastUsedAt || "";
        const tb = b.p.lastUsedAt || "";
        if (ta && tb) return tb.localeCompare(ta);
        if (ta) return -1;
        if (tb) return 1;
        return a.p.name.localeCompare(b.p.name, "ja");
      });
    } else if (mode === "wins") {
      // 勝率順。記録のない人は後ろにまとめる
      withStats.sort(function (a, b) {
        if (!a.st.matches && !b.st.matches) return a.p.name.localeCompare(b.p.name, "ja");
        if (!a.st.matches) return 1;
        if (!b.st.matches) return -1;
        if (b.st.winRate !== a.st.winRate) return b.st.winRate - a.st.winRate;
        return b.st.matches - a.st.matches; // 勝率が同じなら試合数が多い方を上に
      });
    } else {
      withStats.sort(function (a, b) {
        return a.p.name.localeCompare(b.p.name, "ja");
      });
    }
    return withStats;
  }

  function render() {
    const list = $("playerList");
    UI.clear(list);
    const all = STORE.listPlayers();

    // 見出しの人数表示
    const countNode = $("playersCount");
    if (countNode) {
      countNode.textContent = all.length ? all.length + "人 登録済み" : "";
    }

    // 検索と並び替えは、人数が少ないうちは出さない（画面を狭めないため）
    const tools = $("playerTools");
    if (tools) tools.hidden = all.length < 4;

    if (!all.length) {
      list.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ誰も登録されていません。" }),
          UI.el("p", { text: "上の「選手を登録する」から名前を登録してください。" }),
          UI.el("button", {
            class: "primary",
            style: "margin-top:12px",
            text: "選手を登録する",
            onclick: function () { $("toggleAddPlayerBtn").click(); },
          }),
        ])
      );
      return;
    }

    // 絞り込み
    const q = (($("playerSearch") || {}).value || "").trim().toLowerCase();
    const filtered = q
      ? all.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0; })
      : all;

    if (!filtered.length) {
      list.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "「" + q + "」に一致する選手がいません。" }),
        ])
      );
      return;
    }

    sortPlayers(filtered, sortMode).forEach(function (row) {
      const p = row.p;
      const st = row.st;
      const mine = STORE.isSelf(p.id);
      const card = UI.el("div", {
        class: "match-card player-card" + (mine ? " is-self" : ""),
      });

      const nameRow = UI.el("div", { class: "mc-main" }, [
        UI.el("span", { style: "flex:1;min-width:0", text: p.name }),
        UI.el("span", {
          class: "mc-score",
          text: st.matches ? st.wins + "勝" + st.losses + "敗" : "記録なし",
        }),
      ]);
      // 自分には印を付ける。どれが成績に出ている人か一目で分かるようにする
      if (mine) {
        nameRow.insertBefore(
          UI.el("span", { class: "self-badge", text: "自分" }),
          nameRow.firstChild
        );
      }
      card.appendChild(nameRow);

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

      // 開いている人は再描画後も開いたままにする
      // （スキルレベルを押すと render() が走るため、閉じると連続で設定できない）
      const slEdit = UI.el("div", { class: "sl-edit" });
      if (openSkillFor !== p.id) slEdit.hidden = true;
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
      if (openSkillFor === p.id) renderSlEdit();
      card.appendChild(slEdit);

      // よく使う2つだけを常に出す。
      // 「名前を変更」「削除」はめったに使わないので畳んで、
      // 1人あたりの高さを抑える（一覧は縦に伸びやすいため）
      const foot = UI.el("div", { class: "pc-actions" });
      foot.appendChild(
        UI.el("button", {
          class: "small primary",
          text: "成績",
          onclick: function () { openStats(p); },
        })
      );
      foot.appendChild(
        UI.el("button", {
          class: "small ghost",
          "aria-pressed": String(openSkillFor === p.id),
          text: "スキルレベル",
          onclick: function () {
            openSkillFor = openSkillFor === p.id ? null : p.id;
            openEditFor = null;
            render();
          },
        })
      );
      foot.appendChild(
        UI.el("button", {
          class: "small ghost pc-more",
          "aria-pressed": String(openEditFor === p.id),
          "aria-label": "その他の操作",
          title: "名前の変更・削除",
          text: "⋯",
          onclick: function () {
            openEditFor = openEditFor === p.id ? null : p.id;
            openSkillFor = null;
            render();
          },
        })
      );
      card.appendChild(foot);

      // 「⋯」を押したときだけ出す操作
      if (openEditFor === p.id) {
        const more = UI.el("div", { class: "pc-more-body" });
        // 以前から登録してある人を自分にできるようにする。
        // 自分の指定を後から付け替える道もここに置く
        more.appendChild(
          UI.el("button", {
            class: "small ghost",
            text: mine ? "自分の指定を外す" : "この人を自分にする",
            onclick: function () {
              if (mine) {
                STORE.setSelf(null);
                UI.toast("自分の指定を外しました。");
              } else {
                STORE.setSelf(p.id);
                UI.toast("「" + p.name + "」を自分にしました。");
              }
              openEditFor = null;
              render();
              if (typeof HOME !== "undefined") HOME.render();
            },
          })
        );
        more.appendChild(
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
        more.appendChild(
          UI.el("button", {
            class: "small danger",
            text: "削除",
            onclick: function () {
              if (!window.confirm([
                "「" + p.name + "」を登録から外します。",
                "",
                "これまでの試合の記録は残りますが、この人の成績は見られなくなります。",
                "よろしいですか？",
              ].join(String.fromCharCode(10)))) return;
              STORE.deletePlayer(p.id);
              openEditFor = null;
              render();
              UI.toast("削除しました。");
            },
          })
        );
        card.appendChild(more);
      }

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

  return { open: open, openStats: openStats, render: render,
    openSelfRegister: openSelfRegister };
})();
