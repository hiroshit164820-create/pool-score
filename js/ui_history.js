/**
 * ui_history.js — 履歴一覧・書き出し・読み込み
 *
 * Phase 1.0 では一覧と、記録が消えないためのJSON書き出し／読み込みまで。
 * 本格的なスタッツ画面は Phase 1.7。
 */

const HISTORY = (function () {
  const $ = UI.$;
  let bound = false;

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("newMatchBtn").addEventListener("click", function () { UI.showScreen("screenSetup"); });
    $("backFromHistoryBtn").addEventListener("click", function () { UI.showScreen("screenSetup"); });
    $("exportBtn").addEventListener("click", UI.guard(exportJSON));
    $("importBtn").addEventListener("click", function () { $("importInput").click(); });
    $("importInput").addEventListener("change", onImportFile);
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
    const items = STORE.listMatches();

    if (!items.length) {
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
        UI.el("p", { class: "hint", text: "記録した試合: " + done.length + "件（保存容量 約" + STORE.usageKB() + "KB）" })
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

      const main = UI.el("div", { class: "mc-main" }, [
        UI.el("span", { class: m.winner === "A" ? "win" : "", text: m.names.A }),
        UI.el("span", { class: "mc-score", text: scoreText }),
        UI.el("span", { class: m.winner === "B" ? "win" : "", text: m.names.B }),
      ]);
      card.appendChild(main);

      const foot = UI.el("div", { style: "margin-top:8px;display:flex;gap:8px;align-items:center" });
      if (!m.finished) {
        foot.appendChild(UI.el("span", { class: "badge", text: "進行中" }));
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
      } else if (m.winner) {
        foot.appendChild(UI.el("span", { class: "badge", text: (m.winner === "A" ? m.names.A : m.names.B) + " の勝ち" }));
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
