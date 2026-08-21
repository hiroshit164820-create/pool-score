/**
 * ui_sheetview.js — 終わった試合のスコア表を、あとから見る（本人の指示 2026-08-22）
 *
 * 本人の指示:
 *   「ボウラードの履歴はスコア表そのまま。10フレーム、各投球で何本倒したかを
 *     履歴から見れるようにしたい。成績を詳しく見るから過去のボウラードの履歴を
 *     表示できるようにしたい。JPAのスコアシートを保存して履歴から見れるように。
 *     JPAのスコアシートは試合終了後の結果だけ確認できればいい。」
 *
 * なぜ別のファイルにするか:
 *   `ui_sheet.js` は**試合中**のスコア表を担当していて、1球ごとの記録
 *   （match.events）を毎回読んで組み立てている。こちらは終わった試合を
 *   読むだけなので、`STORE.sheetOf()` が返す保存済みのデータだけを見る。
 *   将来「古い試合の1球ごとの記録を間引く」ことになっても、この画面は生き残る。
 *
 * 見た目は試合中のスコア表と同じ約束にそろえる:
 *   ボウラード … ストライクは X、スペアは ／、0本は −
 *   JPA        … 1点＝1マス。ラックの変わり目に区切りとラック番号
 */
const SHEETVIEW = (function () {
  "use strict";

  const $ = UI.$;
  let bound = false;

  function bindOnce() {
    if (bound) return;
    bound = true;
    const close = $("sheetViewCloseBtn");
    if (close) close.addEventListener("click", UI.guard(close_));
    const back = $("sheetViewModal");
    if (back) {
      back.addEventListener("click", function (e) {
        if (e.target === back) close_();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close_();
    });
  }

  function close_() {
    const m = $("sheetViewModal");
    if (m) m.hidden = true;
  }

  /** その試合にスコア表があるか（履歴にボタンを出すかの判断に使う） */
  function has(matchId) {
    if (typeof STORE === "undefined" || !STORE.sheetOf) return false;
    const s = STORE.sheetOf(matchId);
    return !!(s && s.kind);
  }

  function open(matchId) {
    bindOnce();
    const s = STORE.sheetOf(matchId);
    const body = $("sheetViewBody");
    if (!body) return;
    UI.clear(body);

    const title = $("sheetViewTitle");
    const sub = $("sheetViewSub");

    if (!s || !s.kind) {
      if (title) title.textContent = "スコア表";
      if (sub) sub.textContent = "";
      body.appendChild(
        UI.el("p", { class: "hint", text: reasonText(s) })
      );
      showModal();
      return;
    }

    if (title) title.textContent = s.kind === "bowlard" ? "ボウラード スコア表" : "JPAスコアシート";
    if (sub) sub.textContent = headLine(s);

    if (s.kind === "bowlard") renderBowlard(body, s);
    else renderJpa(body, s);

    showModal();
  }

  function showModal() {
    const m = $("sheetViewModal");
    if (m) m.hidden = false;
  }

  function reasonText(s) {
    const r = s && s.reason;
    if (r === "noSheet") return "この種目にはスコア表がありません。";
    if (r === "notFound") return "この試合の記録が見つかりません。";
    // 記録が古くてスコア表のデータが無い／壊れている
    return "この試合はスコア表を作れませんでした（記録が残っていません）。";
  }

  function headLine(s) {
    const when = fmtDate(s.endedAt);
    if (s.kind === "bowlard") {
      return (s.name || "") + (when ? "　" + when : "");
    }
    const n = s.names || {};
    return (n.A || "A") + " 対 " + (n.B || "B") + (when ? "　" + when : "");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 "
      + String(d.getHours()).padStart(2, "0") + ":"
      + String(d.getMinutes()).padStart(2, "0");
  }

  /* ---------- ボウラード ---------- */

  function renderBowlard(body, s) {
    const pins = (s.cfg && s.cfg.pinsPerFrame) || 10;
    const nFrames = (s.cfg && s.cfg.frames) || 10;

    const table = UI.el("div", { class: "bowl-table" });
    (s.frames || []).forEach(function (f) {
      const cell = UI.el("div", { class: "bowl-frame" + (f.score === null ? " pending" : "") });
      cell.appendChild(UI.el("span", { class: "bf-no", text: String(f.no) }));

      const marks = UI.el("span", { class: "bf-marks" });
      const isLast = f.no === nFrames;
      // 最終フレーム以外のストライクは、右端に X を置く（記入用紙と同じ）
      if (f.kind === "strike" && !isLast) {
        marks.appendChild(UI.el("span", { class: "bf-m", text: "" }));
        marks.appendChild(UI.el("span", { class: "bf-m", text: "X" }));
      } else {
        (f.throws || []).forEach(function (t, i) {
          let label = String(t);
          if (t === pins) label = "X";
          else if (i > 0 && f.throws[i - 1] + t === pins) label = "/";
          else if (t === 0) label = "-";
          marks.appendChild(UI.el("span", { class: "bf-m", text: label }));
        });
      }
      cell.appendChild(marks);
      cell.appendChild(
        UI.el("span", { class: "bf-score", text: f.score === null ? "" : String(f.score) })
      );
      table.appendChild(cell);
    });
    body.appendChild(table);

    body.appendChild(
      UI.el("div", { class: "bowl-total" }, [
        UI.el("span", { text: "合計" }),
        UI.el("b", { text: String(s.total) }),
        UI.el("span", { class: "hint", text: s.complete ? "（確定）" : "（途中）" }),
      ])
    );

    const t = s.tally;
    if (t) {
      body.appendChild(
        UI.el("p", {
          class: "hint",
          text: "ストライク " + t.strike + "　スペア " + t.spare + "　ミス " + t.miss,
        })
      );
    }
  }

  /* ---------- JPA ---------- */

  function renderJpa(body, s) {
    ["A", "B"].forEach(function (side) {
      const series = (s.series && s.series[side]) || [];
      const target = (s.targets && s.targets[side]) || series.length;
      const box = UI.el("div", { class: "sheet-side side-" + side.toLowerCase() });

      const sl = s.skillLevel || {};
      box.appendChild(
        UI.el("div", { class: "sheet-head" }, [
          UI.el("span", { class: "sh-name", text: (s.names && s.names[side]) || side }),
          UI.el("span", { class: "sh-sl", text: "SL" + (sl[side] || "-") }),
          UI.el("span", { class: "sh-target", text: series.length + " / " + target }),
        ])
      );
      if (s.doubles) {
        box.appendChild(
          UI.el("p", { class: "hint sh-note", text: "ペアのスキルレベル（2人の合計）" })
        );
      }

      // 1点＝1マス。公式の用紙と同じく、埋まったマスを消していく形にする
      const grid = UI.el("div", { class: "sheet-grid" });
      let prevRack = null;
      for (let n = 1; n <= target; n++) {
        const hit = series[n - 1];
        const newRack = !!hit && hit.rackNo !== prevRack;
        const cell = UI.el("span", {
          class: "sheet-cell"
            + (hit ? " filled" : "")
            + (hit && hit.rackEnd ? " rack-end" : "")
            + (newRack ? " rack-open" : "")
            + (n === target ? " goal" : ""),
          title: hit ? "ラック" + hit.rackNo + "／" + hit.ball + "番" : "",
          text: String(n),
        });
        if (newRack) cell.setAttribute("data-rack", "R" + hit.rackNo);
        if (hit) prevRack = hit.rackNo;
        grid.appendChild(cell);
      }
      box.appendChild(grid);
      body.appendChild(box);
    });

    const foot = UI.el("div", { class: "sheet-foot" });
    if (s.innings !== null && s.innings !== undefined) {
      foot.appendChild(UI.el("span", { class: "sf-item", text: "イニング " + s.innings }));
    }
    if (s.deadBalls) {
      foot.appendChild(UI.el("span", { class: "sf-item", text: "死球 " + s.deadBalls }));
    }
    const tp = s.teamPoints;
    if (tp) {
      foot.appendChild(
        UI.el("span", { class: "sf-item", text: "チームポイント " + tp.A + " - " + tp.B })
      );
    }
    if (s.winner) {
      const nm = (s.names && s.names[s.winner]) || s.winner;
      foot.appendChild(UI.el("span", { class: "sf-item", text: nm + " の勝ち" }));
    }
    if (foot.childNodes.length) body.appendChild(foot);
  }

  return { open: open, has: has, close: close_ };
})();
