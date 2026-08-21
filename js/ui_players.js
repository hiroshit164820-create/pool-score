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
  // プロフィール編集欄を開いている人のID（再描画しても開いたままにする）
  // 中身は 名前・クラス・所属店舗・スキルレベル（本人の指示 2026-08-21）
  let openSkillFor = null;
  // 「自分の指定・削除」を開いている人のID
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
    // 選手一覧の「戻る」は本人の指示（2026-08-21・段階3）で撤去した。
    // 下部タブで移動できるため、上の帯は登録ボタンだけにしている

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
    // 選手一覧の下部にあった「成績を見る」「新しい試合」は本人の指示（2026-08-20）で
    // 撤去した。同じ導線が下部タブとホーム画面にあり、二重に置くと一覧が短く見えるため
    $("backFromStatsBtn").addEventListener("click", function () { open(); });
    // 成績を表計算（CSV）に書き出す
    const csvBtn = $("csvStatsBtn");
    if (csvBtn) {
      csvBtn.addEventListener("click", UI.guard(function () {
        CSVOUT.download(CSVOUT.playerRows(), "選手ごとの成績");
      }));
    }
  }

  function open() {
    bindOnce();
    renderNewSkill();
    render();
    UI.showScreen("screenPlayers");
  }

  // 新規登録フォームで選択中のスキルレベル
  let newSkill = { nine: null, eight: null };
  // 新規登録フォームで選択中のクラス（任意・未選択は null）
  let newClass = null;

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
    const created = STORE.upsertPlayer(
      name, { nine: newSkill.nine, eight: newSkill.eight }, { cls: newClass });
    // 自分として登録したときだけ、自分の指定を差し替える
    const asSelf = (addMode === "self");
    if (asSelf && created) STORE.setSelf(created.id);
    input.value = "";
    newSkill = { nine: null, eight: null };
    newClass = null;
    renderNewSkill();
    // 登録したら畳む。続けて登録したいときはもう一度開く
    $("addPlayerBody").hidden = true;
    syncFormLabels(false);
    render();
    UI.toast("「" + name + "」を" + (asSelf ? "自分として" : "") + "登録しました。");
    if (asSelf && typeof HOME !== "undefined") HOME.render();
  }

  /**
   * クラスの選択欄（本人の指示 2026-08-21）。
   * Be / C / B / A / SA / P の6種類。未選択のままでも登録できる（任意項目）。
   */
  function classChips(current, onPick) {
    const chips = UI.el("div", { class: "chips cls-chips" });
    chips.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip small-chip",
        "aria-pressed": String(!current),
        text: "未設定",
        onclick: function () { onPick(null); },
      })
    );
    (STORE.PLAYER_CLASSES || []).forEach(function (c) {
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip small-chip cls-chip cls-" + c,
          "aria-pressed": String(current === c),
          title: c + "（" + ((STORE.CLASS_LABELS || {})[c] || c) + "）",
          text: c,
          onclick: function () { onPick(c); },
        })
      );
    });
    return chips;
  }

  /**
   * 名前の横に出すクラスのバッジ。
   * クラスが未設定の人には何も出さない（null を返す）。
   */
  function classBadge(cls) {
    const c = cls || null;
    if (!c) return null;
    return UI.el("span", {
      class: "cls-badge cls-" + c,
      title: c + "（" + ((STORE.CLASS_LABELS || {})[c] || c) + "）",
      text: c,
    });
  }

  /** 名前からクラスのバッジを作る（履歴・成績で使う） */
  function classBadgeOfName(name) {
    if (!STORE.classOfName) return null;
    return classBadge(STORE.classOfName(name));
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

    // クラス（一般種目で使う。JPAの試合ではスキルレベルだけを出す）
    wrap.appendChild(
      UI.el("p", {
        class: "hint cls-prompt",
        text: name + " のクラス（任意・あとから変えられます）",
      })
    );
    wrap.appendChild(
      UI.el("div", { class: "field cls-field" }, [
        UI.el("label", { text: "クラス" }),
        classChips(newClass, function (v) {
          newClass = v;
          renderNewSkill();
        }),
      ])
    );
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

      // 名前の横にクラスのバッジを出す（本人の指示 2026-08-21）
      const nameBox = UI.el("span", { class: "pc-name", style: "flex:1;min-width:0" }, [
        UI.el("span", { class: "pc-name-text", text: p.name }),
      ]);
      const badge = classBadge(p.cls);
      if (badge) nameBox.appendChild(badge);
      // 自分の印は名前の右に、短い札で付ける（本人の指示 2026-08-21・段階3）。
      // 名前の欄の中に入れるのが要点。行の直下に置くと欄が1つ増え、
      // .mc-main の3列レイアウトがずれて勝敗が他の人と違う位置に出てしまう
      if (mine) {
        nameBox.appendChild(
          UI.el("span", { class: "self-badge", text: "★", title: "自分", "aria-label": "自分" })
        );
      }
      const nameRow = UI.el("div", { class: "mc-main" }, [
        nameBox,
        UI.el("span", {
          class: "mc-score",
          text: st.matches ? st.wins + "勝" + st.losses + "敗" : "記録なし",
        }),
      ]);
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

      // 所属店舗（設定してある人だけ出す）
      if (p.shop) {
        card.appendChild(UI.el("p", { class: "hint shop-line", text: "所属 " + p.shop }));
      }

      // 開いている人は再描画後も開いたままにする
      // （中の項目を押すと render() が走るため、閉じると連続で設定できない）
      const slEdit = UI.el("div", { class: "sl-edit" });
      if (openSkillFor !== p.id) slEdit.hidden = true;
      function renderSlEdit() {
        UI.clear(slEdit);
        const cur = STORE.findPlayerById(p.id) || p;

        // 名前（本人の指示 2026-08-21：プロフィール編集で名前も直せるようにする）
        const nameInput = UI.el("input", {
          type: "text",
          class: "pf-name",
          value: cur.name,
          maxlength: "20",
          "aria-label": "名前",
        });
        slEdit.appendChild(
          UI.el("div", { class: "field pf-field" }, [
            UI.el("label", { text: "名前" }),
            nameInput,
            UI.el("button", {
              class: "small",
              text: "名前を保存",
              onclick: function () {
                const nv = (nameInput.value || "").trim();
                if (!nv) { UI.toast("名前を入力してください。", "warn"); return; }
                if (nv === cur.name) { UI.toast("名前は変わっていません。"); return; }
                const other = STORE.findPlayerByName(nv);
                if (other && other.id !== p.id) {
                  UI.toast("「" + nv + "」はすでに登録されています。", "warn");
                  return;
                }
                STORE.setPlayerProfile(p.id, { name: nv });
                render();
                UI.toast("名前を変更しました。");
              },
            }),
          ])
        );

        // クラス（一般種目で使う）
        slEdit.appendChild(
          UI.el("div", { class: "field cls-field" }, [
            UI.el("label", { text: "クラス" }),
            classChips(cur.cls || null, function (v) {
              STORE.setPlayerProfile(p.id, { cls: v });
              render();
            }),
          ])
        );

        // 所属店舗
        const shopInput = UI.el("input", {
          type: "text",
          class: "pf-shop",
          value: cur.shop || "",
          maxlength: "40",
          placeholder: "例: ○○ビリヤード",
          "aria-label": "所属店舗",
        });
        slEdit.appendChild(
          UI.el("div", { class: "field pf-field" }, [
            UI.el("label", { text: "所属店舗" }),
            shopInput,
            UI.el("button", {
              class: "small",
              text: "所属を保存",
              onclick: function () {
                STORE.setPlayerProfile(p.id, { shop: (shopInput.value || "").trim() || null });
                render();
                UI.toast("所属店舗を保存しました。");
              },
            }),
          ])
        );

        // JPAスキルレベル
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
      // 「自分の指定」「削除」はめったに使わないので畳んで、
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
          text: "プロフィール編集",
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
          title: "自分の指定・削除",
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

  /**
   * 成績ページの冒頭に置く「自分の成績」「他選手の成績」の1行。
   * current は今見ている人（null なら一覧）。
   */
  function statsSwitchRow(current) {
    const me = STORE.getSelf();
    const onSelf = !!(me && current && current.id === me.id);
    const row = UI.el("div", { class: "stats-switch" });
    row.appendChild(
      UI.el("button", {
        class: "small" + (onSelf ? " primary" : " ghost"),
        "aria-pressed": String(onSelf),
        text: "自分の成績",
        onclick: function () {
          const self = STORE.getSelf();
          if (!self) {
            UI.toast("先に「自分」を登録してください。", "warn");
            PLAYERS.openSelfRegister();
            return;
          }
          openStats(self);
        },
      })
    );
    row.appendChild(
      UI.el("button", {
        class: "small" + (current ? " ghost" : " primary"),
        "aria-pressed": String(!current),
        text: "他選手の成績",
        onclick: function () { openStats(null); },
      })
    );
    return row;
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
      // 冒頭に「自分の成績」「他選手の成績」を1行で置く（本人の指示 2026-08-21・D）
      body.appendChild(statsSwitchRow(null));

      // 「種目ごとの成績」は本人の指示（2026-08-21・段階3）で削除した

      // 「他選手の成績」に自分は出さない（本人の指示 2026-08-21・段階3）。
      // 自分は左の「自分の成績」で見るため、ここに並べると二重になる
      const me0 = STORE.getSelf();
      const others = me0
        ? players.filter(function (p) { return p.id !== me0.id; })
        : players;

      if (!others.length) {
        body.appendChild(
          UI.el("div", { class: "empty" }, [
            UI.el("p", { text: "自分のほかに登録された選手がいません。" }),
          ])
        );
        UI.showScreen("screenStats");
        return;
      }

      // 一覧（勝率順）
      const rows = others
        .map(function (p) { return { p: p, st: STORE.playerStats(p.id) }; })
        .sort(function (a, b) {
          if (!a.st.matches) return 1;
          if (!b.st.matches) return -1;
          return b.st.winRate - a.st.winRate;
        });

      body.appendChild(UI.el("p", { class: "hint", text: "名前を押すと詳しく見られます。" }));
      rows.forEach(function (r) {
        const card = UI.el("div", {
          class: "match-card stats-card",
          style: "cursor:pointer",
          onclick: function () { openStats(r.p); },
        });
        // 名前の横にクラスのバッジ（本人の指示 2026-08-21）
        const nb = UI.el("span", { class: "pc-name", style: "flex:1;min-width:0" }, [
          UI.el("span", { class: "pc-name-text", text: r.p.name }),
        ]);
        const bg = classBadge(r.p.cls);
        if (bg) nb.appendChild(bg);
        card.appendChild(
          UI.el("div", { class: "mc-main" }, [
            nb,
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

    // 個人の詳細（本人の指示 2026-08-21・D で並びを決め直した）
    //   1. 総合成績（既定閉じ）
    //   2. 一般種目とJPAの内訳（既定閉じ）
    //   3. 対戦相手別（既定閉じ・直近5人＋開くと全数）
    //   4. パートナー別（既定閉じ・直近5人＋開くと全数）
    //   5. 種目別でさらに詳しく（色違い・記録の無い種目も出す）
    const st = STORE.playerStats(player.id);
    body.appendChild(statsSwitchRow(player));

    const head = UI.el("h2", { class: "stats-head", style: "margin:0 0 12px;font-size:20px" }, [
      UI.el("span", { class: "pc-name-text", text: player.name }),
    ]);
    const headBadge = classBadge(player.cls);
    if (headBadge) head.appendChild(headBadge);
    body.appendChild(head);

    if (!st.matches) {
      body.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ記録がありません。" }),
          UI.el("p", { text: "試合を作るときに、この名前を選んでください。" }),
        ])
      );
      // 記録が無くても「種目別でさらに詳しく」は出す（どの種目が未記録かを見せる）
      appendGameDetail(body, player);
      body.appendChild(backToListBtn());
      UI.showScreen("screenStats");
      return;
    }

    // ---- 1. 総合成績 ----
    // 獲得スコア・イニング数・1試合あたりのイニング数・JPA獲得ポイントは
    // 本人の指示（2026-08-21）で外した
    const main = [
      ["試合数", st.matches + "試合"],
      ["W-L", st.wins + " - " + st.losses],
      ["勝率", pct(st.winRate) + "（" + st.wins + "勝" + st.losses + "敗）"],
      ["ラック取得率", pct(st.rackWinRate)],
      ["マスワリ", st.masuwari + "回" + (st.masuwariRate !== null ? "（" + pct(st.masuwariRate) + "）" : "")],
      ["ブレイクエース", st.breakAce + "回"],
      ["セーフティ", st.safety + "回"],
      ["ファウル", st.fouls + "回"],
    ];
    body.appendChild(foldTable("成績（総合）", main));

    // ---- 2. 一般種目とJPAの内訳 ----
    const split = [];
    function splitRow(label, b) {
      if (!b || !b.matches) return;
      split.push([label,
        b.wins + "勝" + b.losses + "敗（" + b.matches + "試合・勝率 "
        + pct(b.winRate) + "）"]);
    }
    splitRow("一般種目", st.general);
    splitRow("JPA", st.jpa);
    if (split.length) body.appendChild(foldTable("一般種目とJPAの内訳", split));

    // ---- 3. 対戦相手別（直近5人＋開くと全数） ----
    const oppRows = recentFirst(st.opponents).map(function (e) {
      const o = e.v;
      return [e.k, o.matches + "試合 " + o.wins + "勝（" + pct(o.winRate) + "）"];
    });
    if (oppRows.length) body.appendChild(foldTable("対戦相手別", oppRows, 5));

    // ---- 4. パートナー別（勝敗数・勝率・マスワリ回数／率） ----
    const partRows = recentFirst(st.partners).map(function (e) {
      const pt = e.v;
      return [e.k,
        pt.wins + "勝" + pt.losses + "敗（勝率 " + pct(pt.winRate) + "）"
        + "／マスワリ " + cntRate(pt.masuwari, pt.breaks)];
    });
    if (partRows.length) body.appendChild(foldTable("パートナー別", partRows, 5));

    // ---- 5. 種目別でさらに詳しく ----
    appendGameDetail(body, player);

    // ショットクロックは上の5つに入っていないが、記録した数字を捨てないため下に残す
    if (st.shotClockShots) {
      body.appendChild(
        foldTable("ショットクロック", [
          ["平均タイム", sec(st.avgShotSec)],
          ["計測したショット", st.shotClockShots + "回"],
          ["時間切れ", st.shotClockViolations + "回"],
          ["延長の使用", st.shotClockExtensions + "回"],
        ])
      );
    }

    body.appendChild(backToListBtn());

    UI.showScreen("screenStats");
  }

  /** 「一覧に戻る」ボタン */
  function backToListBtn() {
    return UI.el("button", {
      class: "ghost",
      style: "width:100%;margin-top:12px",
      text: "一覧に戻る",
      onclick: function () { openStats(null); },
    });
  }

  /**
   * オブジェクト（相手名 → 成績）を、直近に当たった順の配列にする。
   * 日付を持っていない古い記録は後ろにまとめ、名前順にする。
   */
  function recentFirst(map) {
    return Object.keys(map || {}).map(function (k) {
      return { k: k, v: map[k] };
    }).sort(function (a, b) {
      const ta = a.v.last || "";
      const tb = b.v.last || "";
      if (ta && tb && ta !== tb) return tb.localeCompare(ta);
      if (ta && !tb) return -1;
      if (!ta && tb) return 1;
      return a.k.localeCompare(b.k, "ja");
    });
  }

  /**
   * 既定で閉じているカード（本人の指示 2026-08-21・D）。
   * limit を渡すと、開いたときはまず limit 件だけ出し、
   * 残りは中の「ほかN件を見る」を押したときに出す。
   */
  function foldTable(title, rows, limit) {
    const box = UI.el("details", { class: "match-card fold-card" });
    box.appendChild(UI.el("summary", { class: "stat-title", text: title }));
    const head = (limit && rows.length > limit) ? rows.slice(0, limit) : rows;
    head.forEach(function (r) {
      box.appendChild(statRow(r));
    });
    if (limit && rows.length > limit) {
      const more = UI.el("details", { class: "fold-more" });
      more.appendChild(
        UI.el("summary", { class: "stat-title", text: "ほか" + (rows.length - limit) + "人を見る" })
      );
      rows.slice(limit).forEach(function (r) { more.appendChild(statRow(r)); });
      box.appendChild(more);
    }
    return box;
  }

  function statRow(r) {
    return UI.el("div", { class: "stat-row" }, [
      UI.el("span", { class: "stat-key", text: r[0] }),
      UI.el("span", { class: "stat-val", text: String(r[1]) }),
    ]);
  }

  /* ---------- 種目別でさらに詳しく ---------- */

  /** 小数1桁。数えるものが無ければ「—」 */
  function avg(v, n) {
    if (!n) return "—";
    return String(Math.round((v / n) * 10) / 10);
  }

  /** 回数と率をひとまとめに書く（例: 3回（25.0%）） */
  function cntRate(n, base) {
    const t = n + "回";
    if (!base) return t;
    return t + "（" + pct(n / base) + "）";
  }

  /** 種目のまとまり。出す項目が種目ごとに違うので、ここで振り分ける */
  function detailRows(g) {
    const id = g.gameId;
    const rows = [];
    const wl = g.wins + "勝" + g.losses + "敗";
    const rate = g.matches ? pct(g.wins / g.matches) : "—";

    function safetyRows() {
      rows.push(["1ラックあたりの平均セーフティ数", avg(g.safety, g.racks)]);
      rows.push(["1試合あたりの平均セーフティ数", avg(g.safety, g.matches)]);
    }
    function inningRow() {
      // 分母は「イニングを数えた試合」のラック数だけ（本人の指示 2026-08-21）。
      // 数えない試合が混ざると平均が薄まるため。古い集計には無いので racks で補う
      const den = g.inningRacks != null ? g.inningRacks : g.racks;
      if (!den) return; // 数えた試合が1つも無ければ行ごと出さない
      rows.push(["1ラックあたりの平均イニング数", avg(g.innings, den)]);
    }
    // 対戦相手のクラス別（本人の指示 2026-08-21・D）。
    // 一般種目だけに出す（JPAはスキルレベルで見る）。
    // クラスは選手登録の「いまの値」なので、登録前の試合は数に入らない
    function classRows() {
      const order = (STORE.PLAYER_CLASSES || []);
      const keys = order.filter(function (c) { return g.byClass && g.byClass[c]; });
      if (!keys.length) {
        rows.push(["対戦クラス別の勝敗数・勝率",
          "記録がありません（相手にクラスを登録すると出ます）"]);
        return;
      }
      keys.forEach(function (c) {
        const b = g.byClass[c];
        rows.push(["対戦クラス " + c + " の勝敗数・勝率",
          b.wins + "勝" + b.losses + "敗（" + b.matches + "試合・"
          + (b.matches ? pct(b.wins / b.matches) : "—") + "）"]);
      });
    }
    function shotClockRows() {
      rows.push(["ショットクロック平均タイム",
        g.scShots ? sec(g.scSec / g.scShots) : "—"]);
      rows.push(["1試合あたりのエクステンション使用回数", avg(g.scExt, g.matches)]);
    }

    // ---- ボウラード（1人でやる種目） ----
    if (id === "bowlard") {
      [10, 30, 50].forEach(function (n) {
        const take = g.bowlardTotals.slice(0, n);
        rows.push(["平均スコア（過去" + n + "回）",
          take.length
            ? Math.round((take.reduce(function (a, b) { return a + b; }, 0) / take.length) * 10) / 10
              + "点（" + take.length + "回ぶん）"
            : "—"]);
      });
      rows.push(["最高スコア", g.bwBest === null ? "—" : g.bwBest + "点"]);
      rows.push(["累計ストライク数", g.bwStrike + "回"]);
      rows.push(["累計スペア数", g.bwSpare + "回"]);
      rows.push(["累計ミス数", g.bwMiss + "回"]);
      return rows;
    }

    // ---- ローテーション ----
    if (id === "rotation") {
      const goals = Object.keys(g.byGoal).sort(function (a, b) { return a - b; });
      if (goals.length) {
        goals.forEach(function (t) {
          const b = g.byGoal[t];
          rows.push([t + "点の勝敗数", b.wins + "勝" + b.losses + "敗"]);
        });
        goals.forEach(function (t) {
          const b = g.byGoal[t];
          rows.push([t + "点の勝率", b.matches ? pct(b.wins / b.matches) : "—"]);
        });
      } else {
        rows.push(["勝敗数", wl]);
        rows.push(["勝率", rate]);
      }
      // 率の分母は項目名の側に書く。値が長くなると項目名の欄が潰れて
      // 「A ハ イ ラ ン」と縦に割れるため
      rows.push(["Aハイラン数／率（自分がブレイクした" + g.brokeFirst + "試合中）",
        cntRate(g.aHighRun, g.brokeFirst)]);
      rows.push(["Bハイラン数／率（相手がブレイクした" + g.oppBrokeFirst + "試合中）",
        cntRate(g.bHighRun, g.oppBrokeFirst)]);
      classRows();
      safetyRows();
      inningRow();
      shotClockRows();
      return rows;
    }

    // ---- 14-1 ----
    if (id === "straight") {
      rows.push(["勝敗数", wl]);
      rows.push(["勝率", rate]);
      rows.push(["ハイラン", g.highRun + "点"]);
      classRows();
      shotClockRows();
      return rows;
    }

    // ---- JPA ----
    if (id.indexOf("jpa_") === 0) {
      const doubles = id.indexOf("doubles") >= 0;
      rows.push(["勝敗数", wl]);
      rows.push(["勝率", rate]);
      if (!doubles) {
        rows.push(["累計獲得ポイント数", g.jpaPoints + "P"]);
        rows.push(["1試合あたりの平均獲得ポイント数",
          g.jpaMatches ? avg(g.jpaPoints, g.jpaMatches) + "P" : "—"]);
        rows.push(["1試合あたりの平均獲得ポイント率",
          g.jpaFull ? pct(g.jpaPoints / g.jpaFull) : "—"]);
      }
      rows.push(["マスワリ数／率", cntRate(g.masuwari, g.breaks)]);
      rows.push(["ブレイクエース数／率", cntRate(g.breakAce, g.breaks)]);
      safetyRows();
      inningRow();
      if (!doubles) {
        rows.push(["あがりまでの最小イニング数",
          g.winInnMin === null ? "—" : g.winInnMin + "イニング"]);
        rows.push(["あがりまでの最大イニング数",
          g.winInnMax === null ? "—" : g.winInnMax + "イニング"]);
        rows.push(["対戦相手のスキルレベル平均",
          g.oppSlCount ? "SL " + avg(g.oppSlSum, g.oppSlCount) : "—"]);
        const sls = Object.keys(g.bySl).sort(function (a, b) { return a - b; });
        sls.forEach(function (n) {
          const b = g.bySl[n];
          rows.push(["相手SL" + n + " の勝敗数／勝率",
            b.wins + "勝" + b.losses + "敗（" + pct(b.wins / b.matches) + "）"]);
        });
      }
      return rows;
    }

    // ---- 一般種目（9ボール・10ボール・8ボール、ダブルス含む） ----
    rows.push(["勝敗数", wl]);
    rows.push(["勝率", rate]);
    rows.push(["マスワリ数／率", cntRate(g.masuwari, g.breaks)]);
    if (id.indexOf("9ball") === 0) {
      rows.push(["ブレイクエース", g.breakAce + "回"]);
    }
    classRows();
    safetyRows();
    inningRow();
    shotClockRows();
    return rows;
  }

  /** ハウスゲーム（5-9 / 5-10 / カイルン）の項目 */
  function houseRows(h) {
    const rows = [];
    rows.push(["回数", h.plays + "回"]);
    if (h.gameId === "kailun") {
      rows.push(["最大連続得点",
        h.maxRun === null ? "記録がありません（2026-08-21以降の試合から）" : h.maxRun + "点"]);
    } else {
      // ブレイクエースは 5-9 / 5-10 に入力の手立てが無く常に0になるため出さない
      // （本人の指示 2026-08-21：行ごと消す）
      rows.push(["マスワリ数／率", cntRate(h.masuwari, h.racks)]);
    }
    // 各種目の獲得得点履歴（新しい順・多いときは直近20回まで）
    const list = h.scores.slice(0, 20).map(function (x) {
      return (x.score > 0 ? "+" : "") + x.score;
    });
    rows.push(["獲得得点の履歴（新しい順）",
      list.length ? list.join("　") + (h.scores.length > 20 ? "　…" : "") : "—"]);
    return rows;
  }

  /**
   * 「種目別でさらに詳しく」のカード。
   *
   * 項目が多いので既定では閉じておく（本人の指示 2026-08-21）。
   * 2026-08-21・D で次のように変えた:
   *   ・種目ごとにカードを切り分ける（1枚に全種目を詰めない）
   *   ・まだ記録がない種目も出す（グレーに塗って、押しても中身が無いと分かる）
   *   ・並び順は種目選択と同じ（SETUP.gameOrder が唯一の出どころ）
   */
  function appendGameDetail(body, player) {
    if (!STORE.gameDetail) return;
    const d = STORE.gameDetail(player.id);

    const box = UI.el("details", { class: "match-card detail-card" });
    box.appendChild(UI.el("summary", { class: "stat-title", text: "種目別でさらに詳しく" }));

    const order = (typeof SETUP !== "undefined" && SETUP.gameOrder)
      ? SETUP.gameOrder() : [];
    // 並び順に載っていない種目（あとから足したもの）も落とさず後ろに付ける
    const known = {};
    order.forEach(function (id) { known[id] = true; });
    const extra = Object.keys(d.byGame).concat(Object.keys(d.byHouse))
      .filter(function (id) { return !known[id]; });

    order.concat(extra).forEach(function (id) {
      const g = d.byGame[id];
      const h = d.byHouse[id];
      const label = (g && g.label) || (h && h.label)
        || ((typeof GAMES !== "undefined" && GAMES[id]) ? GAMES[id].label : id);
      const has = !!(g || h);

      const card = UI.el("details", {
        class: "match-card game-card" + (has ? "" : " is-empty"),
      });
      card.appendChild(UI.el("summary", { class: "dc-game" }, [
        UI.el("span", { class: "dc-game-name", text: label }),
        UI.el("span", { class: "dc-game-note", text: has ? "" : "記録なし" }),
      ]));
      if (has) {
        card.appendChild(detailTable(g ? detailRows(g) : houseRows(h)));
        // ボウラードは1回ごとのスコア表を見返したい（本人の指示 2026-08-22）。
        // 数字の一覧だけでは「どのフレームで落としたか」が分からないため
        if (id === "bowlard") card.appendChild(bowlardHistory(player));
      } else {
        card.appendChild(
          UI.el("p", { class: "hint", text: "まだこの種目の記録がありません。" })
        );
      }
      box.appendChild(card);
    });

    body.appendChild(box);
  }

  /**
   * 過去のボウラードの一覧（本人の指示 2026-08-22）。
   *
   * 「成績を詳しく見るから過去のボウラードの履歴を表示できるようにしたい」
   * 日付とスコアを並べ、押すとその回のスコア表を開く。
   */
  function bowlardHistory(player) {
    const wrap = UI.el("div", { class: "bowl-history" });
    wrap.appendChild(UI.el("div", { class: "section-title", text: "1回ごとの記録" }));

    const mine = STORE.listMatches().filter(function (m) {
      if (m.gameId !== "bowlard" || !m.finished) return false;
      const ids = (m.playerIds && m.playerIds.A) || [];
      return ids.indexOf(player.id) >= 0;
    });

    if (!mine.length) {
      wrap.appendChild(UI.el("p", { class: "hint", text: "まだ記録がありません。" }));
      return wrap;
    }

    mine.forEach(function (m) {
      const total = (m.bowlard && m.bowlard.total != null)
        ? m.bowlard.total
        : ((m.scores && m.scores.A) != null ? m.scores.A : "—");
      const row = UI.el("button", {
        type: "button",
        class: "bowl-hist-row",
        onclick: UI.guard(function () {
          if (typeof SHEETVIEW !== "undefined") SHEETVIEW.open(m.id);
        }),
      }, [
        UI.el("span", { class: "bh-date", text: fmtDay(m.endedAt || m.createdAt) }),
        UI.el("span", { class: "bh-score", text: total + "点" }),
        UI.el("span", {
          class: "bh-marks",
          text: m.bowlard
            ? ("X" + m.bowlard.strike + "　／" + m.bowlard.spare + "　-" + m.bowlard.miss)
            : "",
        }),
        UI.el("span", { class: "bh-open", text: "スコア表" }),
      ]);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function fmtDay(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return (d.getMonth() + 1) + "/" + d.getDate() + " "
      + String(d.getHours()).padStart(2, "0") + ":"
      + String(d.getMinutes()).padStart(2, "0");
  }

  function detailTable(rows) {
    // 見た目は他の表（statTable）と同じ組みにそろえる
    const table = UI.el("div", { class: "dc-rows" });
    rows.forEach(function (r) {
      table.appendChild(
        UI.el("div", { class: "stat-row" }, [
          UI.el("span", { class: "stat-key", text: r[0] }),
          UI.el("span", { class: "stat-val", text: String(r[1]) }),
        ])
      );
    });
    return table;
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
    openSelfRegister: openSelfRegister,
    // 履歴・ホームからも同じ見た目のバッジを使えるようにする
    classBadge: classBadge, classBadgeOfName: classBadgeOfName };
})();
