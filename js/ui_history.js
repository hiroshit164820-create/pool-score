/**
 * ui_history.js — 履歴一覧・書き出し・読み込み
 *
 * Phase 1.0 では一覧と、記録が消えないためのJSON書き出し／読み込みまで。
 * 本格的なスタッツ画面は Phase 1.7。
 */

const HISTORY = (function () {
  const $ = UI.$;
  let bound = false;

  // 絞り込みの状態。画面を閉じても覚えておく（探している最中に消えると使いにくい）
  let filter = { gameId: "", opponent: "" };

  function bindOnce() {
    if (bound) return;
    bound = true;
    // 上下のボタン（新しい試合・プレーヤー・読み込み・書き出し・戻る）は
    // 本人の指示（2026-08-21）で削除した。移動は下のタブでする。
    // 書き出し／読み込みの処理そのものは残してあるので、必要になれば
    // ボタンを戻すだけで使える

    // 表計算（CSV）への書き出し。いま絞り込んでいるぶんだけを出す
    $("csvHistoryBtn").addEventListener("click", UI.guard(function () {
      CSVOUT.download(CSVOUT.historyRows(visibleItems()), "試合履歴");
    }));

    $("histGameFilter").addEventListener("change", function (e) {
      filter.gameId = e.target.value;
      render();
    });
    $("histOppFilter").addEventListener("change", function (e) {
      filter.opponent = e.target.value;
      render();
    });
    $("histFilterClear").addEventListener("click", function () {
      filter = { gameId: "", opponent: "" };
      render();
    });
  }

  /** いま画面に出ている（＝絞り込みを通った）試合 */
  function visibleItems() {
    return STORE.listMatches().filter(function (m) {
      if (filter.gameId && m.gameId !== filter.gameId) return false;
      if (filter.opponent
        && m.names.A !== filter.opponent && m.names.B !== filter.opponent) return false;
      return true;
    });
  }

  /** いま画面に出ているハウスゲーム（5-9 / 5-10 / カイルン）の記録 */
  function visibleMoneyItems() {
    const money = STORE.listMoneyResults ? STORE.listMoneyResults() : [];
    return money.filter(function (m) {
      if (filter.gameId && m.gameId !== filter.gameId) return false;
      // 対戦相手で絞っているときは、その人が出ている試合だけ
      if (filter.opponent
        && !(m.players || []).some(function (p) { return p.name === filter.opponent; })) {
        return false;
      }
      return true;
    });
  }

  /**
   * 絞り込みの選択肢を作り直す。
   * 記録に出てくる種目・名前だけを並べる（選んでも0件になる項目を出さない）。
   */
  function renderFilters(all, money) {
    const gameSel = $("histGameFilter");
    const oppSel = $("histOppFilter");
    if (!gameSel || !oppSel) return;

    const games = [];
    const seenGame = {};
    const names = [];
    const seenName = {};
    all.forEach(function (m) {
      if (!seenGame[m.gameId]) {
        seenGame[m.gameId] = true;
        games.push({ id: m.gameId, label: m.gameLabel });
      }
      ["A", "B"].forEach(function (s) {
        const nm = m.names[s];
        if (nm && !seenName[nm]) {
          seenName[nm] = true;
          names.push(nm);
        }
      });
    });
    // ハウスゲーム（5-9 / 5-10 / カイルン）は対戦記録とは別の入れ物に保存している。
    // 種目の絞り込みに出てこなかったので、ここからも集める（本人の指示 2026-08-21）
    (money || []).forEach(function (m) {
      if (m.gameId && !seenGame[m.gameId]) {
        seenGame[m.gameId] = true;
        games.push({ id: m.gameId, label: m.gameLabel || m.gameId });
      }
      (m.players || []).forEach(function (p) {
        if (p.name && !seenName[p.name]) {
          seenName[p.name] = true;
          names.push(p.name);
        }
      });
    });
    names.sort();

    function fill(sel, items, cur, allLabel) {
      UI.clear(sel);
      sel.appendChild(UI.el("option", { value: "", text: allLabel }));
      items.forEach(function (it) {
        sel.appendChild(
          UI.el("option", { value: it.value, text: it.label })
        );
      });
      sel.value = cur;
      // 選んでいた項目が記録から消えた場合は「すべて」に戻す
      if (sel.value !== cur) {
        sel.value = "";
      }
    }
    fill(gameSel, games.map(function (g) { return { value: g.id, label: g.label }; }),
      filter.gameId, "すべての種目");
    fill(oppSel, names.map(function (n) { return { value: n, label: n }; }),
      filter.opponent, "すべての相手");
    filter.gameId = gameSel.value;
    filter.opponent = oppSel.value;
  }

  function open() {
    bindOnce();
    render();
    UI.showScreen("screenHistory");
  }

  /**
   * メモの編集。
   *
   * 台の脇で使うため、専用画面へ移動せずその場で書けるようにする。
   * 空にすればメモを消せる。
   */
  function editNote(entry) {
    const cur = (entry.note || "");
    const who = entry.names.A + " 対 " + entry.names.B;
    const next = window.prompt(
      [entry.gameLabel + "／" + who, "", "この試合のメモ（空にすると消えます）"].join(String.fromCharCode(10)),
      cur
    );
    if (next === null) return; // 取り消し
    if (!STORE.setMatchNote(entry.id, next)) {
      UI.toast("メモを保存できませんでした。", "warn");
      return;
    }
    render();
    UI.toast(next.trim() ? "メモを保存しました。" : "メモを消しました。");
  }

  /** 時刻だけ（開始・終了に使う） */
  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      const p = function (n) { return String(n).padStart(2, "0"); };
      return p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) {
      return "";
    }
  }

  /** 開始から終了までの長さ。読みやすい単位にする */
  function fmtSpan(fromIso, toIso) {
    try {
      const ms = new Date(toIso) - new Date(fromIso);
      if (!(ms > 0)) return "";
      const min = Math.round(ms / 60000);
      if (min < 1) return "1分未満";
      if (min < 60) return min + "分";
      return Math.floor(min / 60) + "時間" + (min % 60) + "分";
    } catch (e) {
      return "";
    }
  }

  /**
   * 開始と終了の時刻の行（本人の指示 2026-08-21）。
   * 終わっていない試合は開始だけ出す。
   */
  function timeLine(m) {
    const parts = ["開始 " + fmtTime(m.createdAt)];
    if (m.endedAt) {
      parts.push("終了 " + fmtTime(m.endedAt));
      const span = fmtSpan(m.createdAt, m.endedAt);
      if (span) parts.push(span);
    }
    return UI.el("div", { class: "mc-time", text: parts.join("　/　") });
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      const p = function (n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "/" + p(d.getMonth() + 1) + "/" + p(d.getDate()) + " " +
        p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) {
      return iso;
    }
  }

  function render() {
    const list = $("historyList");
    UI.clear(list);
    const all = STORE.listMatches();
    const allMoney = STORE.listMoneyResults ? STORE.listMoneyResults() : [];
    renderFilters(all, allMoney);
    const items = visibleItems();
    const moneyItems = visibleMoneyItems();

    const filterOn = !!(filter.gameId || filter.opponent);

    // 記録がひとつも無い
    if (!all.length && !allMoney.length) {
      list.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ試合の記録がありません。" }),
          UI.el("p", { text: "「新しい試合」から始めてください。" }),
        ])
      );
      return;
    }

    // 記録はあるが、いまの絞り込みに合うものが無い。
    // ハウスゲームだけが残る場合があるので、両方が空のときだけ出す
    if (!items.length && !moneyItems.length) {
      list.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "この条件に合う試合はありません。" }),
          UI.el("p", { text: "「絞り込みを外す」で全部に戻せます。" }),
        ])
      );
      return;
    }

    // 簡易サマリ（確定した試合のみ対象）
    const done = items.filter(function (m) { return m.finished; });
    if (done.length) {
      list.appendChild(
        UI.el("p", {
          class: "hint",
          text: (filterOn ? "絞り込み中: " : "記録した試合: ") + done.length + "件"
            + (filterOn ? "（全" + all.length + "件中）" : "（保存容量 約" + STORE.usageKB() + "KB）"),
        })
      );
    }

    items.forEach(function (m) {
      const card = UI.el("div", { class: "match-card" });

      const top = UI.el("div", { class: "mc-top" }, [
        UI.el("span", { class: "mc-game", text: m.gameLabel }),
        UI.el("span", { text: fmtDate(m.createdAt) }),
      ]);
      card.appendChild(top);
      card.appendChild(timeLine(m));

      // ボウラードは1人でやる種目で、対戦形式ではない。
      // 獲得スコア・ストライク・スペア・ミス・経過時間を出す（本人の指示 2026-08-21）
      if (m.bowlard) {
        const sc0 = m.scores || {};
        // ボウラードの得点はスコア表から計算する値なので、集計側（result.bowlard）を見る
        const total = m.bowlard.total != null ? m.bowlard.total : sc0.A;
        const bits = ["獲得スコア " + (total === undefined || total === null ? "—" : total),
                      "ストライク " + m.bowlard.strike,
                      "スペア " + m.bowlard.spare,
                      "ミス " + m.bowlard.miss];
        const span = m.endedAt ? fmtSpan(m.createdAt, m.endedAt) : "";
        if (span) bits.push("経過 " + span);
        card.appendChild(UI.el("div", { class: "mc-solo" }, [
          UI.el("span", { class: "mc-nm", text: m.names.A }),
          UI.el("span", { class: "mc-solo-stats", text: bits.join("　/　") }),
        ]));
        if (!m.finished) {
          card.appendChild(UI.el("span", { class: "badge mc-badge", text: "進行中" }));
        }
        appendFoot(card, m);
        list.appendChild(card);
        return;
      }

      const scoreText = m.scores
        ? (m.racks && (m.racks.A || m.racks.B) && !m.scores.A && !m.scores.B
            ? m.racks.A + " - " + m.racks.B
            : m.scores.A + " - " + m.scores.B)
        : "—";

      // JPAは名前のうしろにスキルレベルを出す（本人の指示 2026-08-20）。
      // 同じ相手でもSLが違えば別の試合なので、SLが無いと記録が読めない。
      // JPA以外（一般種目）は、代わりにクラスのバッジを出す
      // （本人の指示 2026-08-21：クラスは一般種目で使い、JPAはSLの表示のみ）
      const sl = m.skillLevel || {};
      function nameCell(side) {
        const cls = "mc-nm" + (m.winner === side ? " win" : "");
        const box = UI.el("span", { class: cls }, [
          UI.el("span", { text: m.names[side] }),
        ]);
        if (sl[side] != null) {
          box.appendChild(UI.el("span", { class: "mc-sl", text: "SL" + sl[side] }));
        } else if (typeof PLAYERS !== "undefined" && PLAYERS.classBadgeOfName) {
          const badge = PLAYERS.classBadgeOfName(m.names[side]);
          if (badge) box.appendChild(badge);
        }
        return box;
      }

      // 勝敗の W-L はスコアの左右に置く（本人の指示 2026-08-21）。
      // 例: プレーヤーA　W 5-1 L　プレーヤーB
      const center = UI.el("span", { class: "mc-score" });
      if (m.finished && m.winner) {
        center.appendChild(UI.el("span", {
          class: "mc-wl " + (m.winner === "A" ? "is-w" : "is-l"),
          text: m.winner === "A" ? "W" : "L",
        }));
      }
      center.appendChild(UI.el("span", { class: "mc-num", text: scoreText }));
      if (m.finished && m.winner) {
        center.appendChild(UI.el("span", {
          class: "mc-wl " + (m.winner === "B" ? "is-w" : "is-l"),
          text: m.winner === "B" ? "W" : "L",
        }));
      }

      const main = UI.el("div", { class: "mc-main" }, [
        nameCell("A"), center, nameCell("B"),
      ]);
      card.appendChild(main);

      if (!m.finished) {
        card.appendChild(UI.el("span", { class: "badge mc-badge", text: "進行中" }));
      }

      if (m.finished) {
        // JPAポイント。「P」は付けず、上のスコアと列をそろえる（本人の指示 2026-08-21）
        const jp = (m.jpa && m.jpa.teamPoints) || null;
        if (jp) {
          // 上のスコアと数字の位置をそろえるため、W/L と同じ幅の空きを左右に置く
          card.appendChild(UI.el("div", { class: "mc-main mc-jpa" }, [
            UI.el("span", { class: "mc-jpa-label", text: "JPAポイント" }),
            UI.el("span", { class: "mc-score" }, [
              UI.el("span", { class: "mc-wl is-blank" }),
              UI.el("span", { class: "mc-num", text: jp.A + " - " + jp.B }),
              UI.el("span", { class: "mc-wl is-blank" }),
            ]),
            UI.el("span", {}),
          ]));
        }

        // マスワリ・セーフティは、出した人の名前の下に置く（本人の指示 2026-08-21）
        const ms = m.masuwari || {};
        const sf = m.safety || {};
        function sideStats(side) {
          const bits = [];
          if (ms[side]) bits.push("マスワリ " + ms[side]);
          if (sf[side]) bits.push("セーフティ " + sf[side]);
          return UI.el("span", { class: "mc-side-stats", text: bits.join("　") });
        }
        if (ms.A || ms.B || sf.A || sf.B) {
          card.appendChild(UI.el("div", { class: "mc-main mc-under" }, [
            sideStats("A"),
            UI.el("span", { class: "mc-score" }),
            sideStats("B"),
          ]));
        }

        if (m.innings !== null && m.innings !== undefined) {
          card.appendChild(UI.el("div", { class: "mc-stats", text: "イニング " + m.innings }));
        }
      }

      appendFoot(card, m);

      // 書いてあるメモは開かなくても読めるようにする
      const noteText0 = (m.note || "").trim();
      if (noteText0) {
        card.appendChild(UI.el("p", { class: "mc-note", text: noteText0 }));
      }

      list.appendChild(card);
    });

    renderMoneyResults(list, moneyItems);
  }

  /**
   * カードの下のボタン（続きを記録・メモ・削除）。
   * ボウラードのカードでも同じものを使うので関数にしてある。
   */
  function appendFoot(card, m) {
      const foot = UI.el("div", { class: "mc-foot" });
      if (!m.finished) {
        foot.appendChild(
          UI.el("button", {
            class: "small primary",
            text: "続きを記録",
            onclick: function () {
              const full = STORE.loadMatch(m.id);
              if (full) MATCH.open(full);
            },
          })
        );
      }
      // メモ。書いてあれば内容を、無ければ「メモを追加」を出す
      foot.appendChild(
        UI.el("button", {
          class: "small ghost",
          text: (m.note || "").trim() ? "メモを編集" : "メモを追加",
          onclick: function () { editNote(m); },
        })
      );
      // 削除は取り消せないため、ここだけ確認を挟む
      foot.appendChild(
        UI.el("button", {
          class: "small ghost",
          text: "削除",
          onclick: function () {
            const who = m.names.A + " 対 " + m.names.B;
            if (!window.confirm([
              "この試合の記録を削除します。",
              "",
              m.gameLabel + "／" + who,
              "",
              "削除すると元に戻せません。よろしいですか？"
            ].join(String.fromCharCode(10)))) return;
            STORE.deleteMatch(m.id);
            render();
            UI.toast("削除しました。");
          },
        })
      );
      card.appendChild(foot);
  }

  /**
   * ハウスゲーム（5-9 / 5-10 / カイルン）の結果。
   *
   * 3人以上で遊ぶゲームでA/B2サイドの試合記録に収まらないため、
   * 別の場所（STORE.listMoneyResults）に最終結果だけを保存している。
   * 絞り込みは render() 側で済ませたものを受け取る。
   */
  function renderMoneyResults(list, items) {
    if (!items || !items.length) return;

    list.appendChild(UI.el("div", { class: "section-title", text: "ハウスゲームの記録" }));

    items.forEach(function (m) {
      const card = UI.el("div", { class: "match-card" });
      card.appendChild(
        UI.el("div", { class: "mc-top" }, [
          UI.el("span", { text: m.gameLabel }),
          UI.el("span", { text: fmtDate(m.createdAt) }),
        ])
      );

      // 得点の高い順に並べて保存してある。1位が勝ち（W）
      const rows = UI.el("div", { class: "money-result" });
      (m.players || []).forEach(function (p, i) {
        // ハウスゲームは一般種目なので、名前の横にクラスのバッジを出す
        const clsBadge = (typeof PLAYERS !== "undefined" && PLAYERS.classBadgeOfName)
          ? PLAYERS.classBadgeOfName(p.name) : null;
        rows.appendChild(
          UI.el("div", { class: "mr-row" + (i === 0 ? " is-top" : "") }, [
            UI.el("span", { class: "mc-wl " + (i === 0 ? "is-w" : "is-l"), text: i === 0 ? "W" : "L" }),
            UI.el("span", { class: "mr-name", text: p.name }),
            clsBadge,
            p.handicapBalls && p.handicapBalls.length
              ? UI.el("span", { class: "mc-sl", text: "ハンデ " + p.handicapBalls.join("・") })
              : null,
            UI.el("span", { class: "mr-score", text: (p.score > 0 ? "+" : "") + p.score }),
          ])
        );
      });
      card.appendChild(rows);
      // カイルンはラックで数えないので、0のときは出さない
      if (m.racks) {
        card.appendChild(
          UI.el("div", { class: "mc-stats", text: m.racks + "ラック" })
        );
      }

      const foot = UI.el("div", { class: "mc-foot" });
      foot.appendChild(
        UI.el("button", {
          class: "small ghost",
          text: "削除",
          onclick: function () {
            const who = (m.players || []).map(function (p) { return p.name; }).join("・");
            if (!window.confirm([
              "この記録を削除します。",
              "",
              m.gameLabel + "／" + who,
              "",
              "削除すると元に戻せません。よろしいですか？",
            ].join(String.fromCharCode(10)))) return;
            STORE.deleteMoneyResult(m.id);
            render();
            UI.toast("削除しました。");
          },
        })
      );
      card.appendChild(foot);
      list.appendChild(card);
    });
  }

  /* ---------- 書き出し / 読み込み ---------- */

  function exportJSON() {
    const data = STORE.exportAll();
    if (!data.matches.length) {
      UI.toast("書き出す記録がありません。", "warn");
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, "0"); };
    const name = "ビリヤードスコア_" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + ".json";

    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    UI.toast("記録を書き出しました。");
  }

  function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(String(reader.result));
        const res = STORE.importAll(data);
        render();
        UI.toast(res.added + "件を読み込みました。");
      } catch (err) {
        UI.toast("読み込めませんでした。" + (err && err.message ? err.message : ""), "danger");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  }

  return { open: open, render: render };
})();
