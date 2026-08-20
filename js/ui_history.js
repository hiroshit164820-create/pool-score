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
    $("newMatchBtn").addEventListener("click", function () { UI.showScreen("screenSetup"); });
    $("backFromHistoryBtn").addEventListener("click", function () { UI.showScreen("screenSetup"); });
    $("exportBtn").addEventListener("click", UI.guard(exportJSON));
    $("importBtn").addEventListener("click", function () { $("importInput").click(); });
    $("importInput").addEventListener("change", onImportFile);

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

  /**
   * 絞り込みの選択肢を作り直す。
   * 記録に出てくる種目・名前だけを並べる（選んでも0件になる項目を出さない）。
   */
  function renderFilters(all) {
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
    renderFilters(all);
    const items = visibleItems();

    const filterOn = !!(filter.gameId || filter.opponent);
    if (all.length && !items.length) {
      list.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "この条件に合う試合はありません。" }),
          UI.el("p", { text: "「絞り込みを外す」で全部に戻せます。" }),
        ])
      );
      return;
    }

    if (!all.length) {
      list.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ試合の記録がありません。" }),
          UI.el("p", { text: "「新しい試合」から始めてください。" }),
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
        UI.el("span", { text: m.gameLabel }),
        UI.el("span", { text: fmtDate(m.createdAt) }),
      ]);
      card.appendChild(top);

      const scoreText = m.scores
        ? (m.racks && (m.racks.A || m.racks.B) && !m.scores.A && !m.scores.B
            ? m.racks.A + " - " + m.racks.B
            : m.scores.A + " - " + m.scores.B)
        : "—";

      // JPAは名前のうしろにスキルレベルを出す（本人の指示 2026-08-20）。
      // 同じ相手でもSLが違えば別の試合なので、SLが無いと記録が読めない
      const sl = m.skillLevel || {};
      function nameCell(side) {
        const cls = "mc-nm" + (m.winner === side ? " win" : "");
        const box = UI.el("span", { class: cls }, [
          UI.el("span", { text: m.names[side] }),
        ]);
        if (sl[side] != null) {
          box.appendChild(UI.el("span", { class: "mc-sl", text: "SL" + sl[side] }));
        }
        return box;
      }

      const main = UI.el("div", { class: "mc-main" }, [
        nameCell("A"),
        UI.el("span", { class: "mc-score", text: scoreText }),
        nameCell("B"),
      ]);
      // 進行中・決着の印はプレーヤー名と同じ行の右端に出す（本人の指示）
      if (!m.finished) {
        main.appendChild(UI.el("span", { class: "badge mc-badge", text: "進行中" }));
      } else if (m.winner) {
        main.appendChild(UI.el("span", { class: "badge mc-badge win-badge", text: "勝ち" }));
      }
      card.appendChild(main);

      // イニング数とセーフティ数。スコアだけでは分からない内容を1行足す
      if (m.finished && m.innings !== null && m.innings !== undefined) {
        const bits = ["イニング " + m.innings];
        const sf = m.safety || {};
        if ((sf.A || 0) + (sf.B || 0) > 0) {
          bits.push("セーフティ " + ((sf.A || 0) + (sf.B || 0)));
        }
        const ms = m.masuwari || {};
        if ((ms.A || 0) + (ms.B || 0) > 0) {
          bits.push("マスワリ " + ((ms.A || 0) + (ms.B || 0)));
        }
        const jp = (m.jpa && m.jpa.teamPoints) || null;
        if (jp) bits.push("JPA " + jp.A + "P - " + jp.B + "P");
        card.appendChild(UI.el("div", { class: "mc-stats", text: bits.join("　・　") }));
      }

      // 操作は1行に収める。勝敗の印は上の行へ移したので、ここはボタンだけ（本人の指示）
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

      // 書いてあるメモは開かなくても読めるようにする
      const noteText = (m.note || "").trim();
      if (noteText) {
        card.appendChild(UI.el("p", { class: "mc-note", text: noteText }));
      }

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
