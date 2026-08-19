/**
 * ui_sheet.js — 公式スコアシートに沿った表示
 *
 * JPA:      公式スコアシートの「1〜38の連番マスを消していく」形をそのまま出す。
 *           出典: JPA公式「9ボールスコアシートの書き方」
 *           http://www.poolplayers.jp/rule/9ball-scorekeeping.pdf
 *           JPA 9-Ball (50%) Scoresheet も同じ構造（2026-08-20に本文確認）
 *
 * ボウラード: ボウリングのスコア表そのまま。10フレーム、ストライク/スペアのボーナス付き。
 *
 * どちらも「記録の見せ方」だけを担当する。得点の計算は engine.js にある。
 */

const SHEET = (function () {
  const $ = UI.$;

  /**
   * その試合でスコアシートを出すか。
   * 種目定義の sheet 指定を見る（ここに種目名の分岐は書かない）。
   */
  function kindFor(match) {
    const g = GAMES[match.gameId];
    if (!g) return null;
    if (g.scoring === "bowlard") return "bowlard";
    if (g.goal === "jpaSL" || g.goal === "jpaSL8") return "jpa";
    return null;
  }

  function render(match, st) {
    const area = $("sheetArea");
    if (!area) return;
    const kind = kindFor(match);
    if (!kind) {
      area.hidden = true;
      return;
    }
    area.hidden = false;
    UI.clear(area);

    if (kind === "bowlard") renderBowlard(area, match, st);
    else renderJpa(area, match, st);
  }

  /* ============================================================
   * JPA スコアシート
   * ============================================================ */

  /**
   * 各側の「入った順の得点列」を作る。
   *
   * 公式シートは1点ずつマスを消していく方式なので、
   * 何点目がどのラックだったかが分かるよう、
   * ラックの最後の点に×印を付ける（公式の記載どおり）。
   */
  function jpaSeries(match) {
    const r = resolveGame(match.gameId);
    const scoreOf = r.scoring.scoreOf || function () { return 1; };
    const out = { A: [], B: [] };
    let rackNo = 1;

    (match.events || []).forEach(function (e) {
      if (e.voided) return;
      if (e.t === "RACK_START") {
        // 前のラックの最後の点に印を付ける
        ["A", "B"].forEach(function (side) {
          const arr = out[side];
          if (arr.length) arr[arr.length - 1].rackEnd = true;
        });
        rackNo = (e.d && e.d.rackNo) || rackNo + 1;
        return;
      }
      if (e.t !== "POCKET" || !e.side) return;
      const balls = (e.d && e.d.balls) || [];
      balls.forEach(function (b) {
        const pts = scoreOf(b);
        for (let i = 0; i < pts; i++) {
          out[e.side].push({ ball: b, rackNo: rackNo, rackEnd: false });
        }
      });
    });
    return out;
  }

  function renderJpa(area, match, st) {
    const g = GAMES[match.gameId];
    const series = jpaSeries(match);
    const sl = (match.goal.meta && match.goal.meta.skillLevel) || {};
    const isDoubles = g.playersPerSide === 2;

    area.appendChild(
      UI.el("div", { class: "sheet-title", text: "JPAスコアシート" })
    );

    ["A", "B"].forEach(function (side) {
      const target = match.goal.targets[side];
      const got = series[side].length;
      const box = UI.el("div", { class: "sheet-side side-" + side.toLowerCase() });

      // 名前・SL・持ち点
      const head = UI.el("div", { class: "sheet-head" }, [
        UI.el("span", { class: "sh-name", text: sideName(match, side) }),
        UI.el("span", { class: "sh-sl", text: "SL" + (sl[side] || "-") }),
        UI.el("span", { class: "sh-target", text: got + " / " + target }),
      ]);
      box.appendChild(head);

      // ダブルスは2人のSLの合計であることを明記する
      if (isDoubles) {
        box.appendChild(
          UI.el("p", { class: "hint sh-note", text: "ペアのスキルレベル（2人の合計）" })
        );
      }

      // 得点マス。公式シートと同じく1点=1マスで消していく
      const grid = UI.el("div", { class: "sheet-grid" });
      for (let n = 1; n <= target; n++) {
        const hit = series[side][n - 1];
        const cell = UI.el("span", {
          class: "sheet-cell"
            + (hit ? " filled" : "")
            + (hit && hit.rackEnd ? " rack-end" : "")
            + (n === target ? " goal" : ""),
          title: hit ? "ラック" + hit.rackNo + "／" + hit.ball + "番" : "",
          text: String(n),
        });
        grid.appendChild(cell);
      }
      box.appendChild(grid);
      area.appendChild(box);
    });

    // イニングとチームポイント
    const foot = UI.el("div", { class: "sheet-foot" });
    foot.appendChild(
      UI.el("span", { class: "sf-item", text: "イニング " + (st.innings + 1) })
    );
    // 死球・タイムアウトは公式シートの記入項目なので、あれば出す
    const dead = (st.stats && st.stats.A ? st.stats.A.deadBalls : 0)
      + (st.stats && st.stats.B ? st.stats.B.deadBalls : 0);
    if (dead) foot.appendChild(UI.el("span", { class: "sf-item", text: "死球 " + dead }));
    area.appendChild(foot);

    area.appendChild(
      UI.el("p", {
        class: "hint sheet-src",
        text: "×印はラックの区切りです。JPA公式スコアシートの記入方式に合わせています。",
      })
    );
  }

  /* ============================================================
   * ボウラード スコア表
   * ============================================================ */

  /** 記録された投球（各投で入れた球数）を取り出す */
  function bowlardThrows(match) {
    const out = [];
    (match.events || []).forEach(function (e) {
      if (e.voided) return;
      if (e.t !== "POCKET") return;
      const balls = (e.d && e.d.balls) || [];
      // ボウラードは「その投で入れた球数」を balls の個数で持つ
      out.push(balls.length);
    });
    return out;
  }

  function renderBowlard(area, match, st) {
    const r = resolveGame(match.gameId);
    const cfg = { frames: r.scoring.frames, pinsPerFrame: r.scoring.pinsPerFrame };
    const throws = bowlardThrows(match);
    const sc = buildBowlardScore(throws, cfg);

    area.appendChild(UI.el("div", { class: "sheet-title", text: "ボウラード スコア表" }));

    const table = UI.el("div", { class: "bowl-table" });
    sc.frames.forEach(function (f) {
      const cell = UI.el("div", { class: "bowl-frame" + (f.score === null ? " pending" : "") });
      cell.appendChild(UI.el("span", { class: "bf-no", text: String(f.no) }));

      // 投球の表示。ストライクは X、スペアは /
      const marks = UI.el("span", { class: "bf-marks" });
      const isLast = f.no === cfg.frames;
      if (f.kind === "strike" && !isLast) {
        marks.appendChild(UI.el("span", { class: "bf-m", text: "" }));
        marks.appendChild(UI.el("span", { class: "bf-m", text: "X" }));
      } else {
        f.throws.forEach(function (t, i) {
          let label = String(t);
          if (t === cfg.pinsPerFrame) label = "X";
          else if (i > 0 && f.throws[i - 1] + t === cfg.pinsPerFrame) label = "/";
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
    area.appendChild(table);

    area.appendChild(
      UI.el("div", { class: "bowl-total" }, [
        UI.el("span", { text: "合計" }),
        UI.el("b", { text: String(sc.total) }),
        UI.el("span", { class: "hint", text: sc.complete ? "（確定）" : "（途中）" }),
      ])
    );
  }

  function sideName(match, side) {
    return side === "A" ? match.sides[0].name : match.sides[1].name;
  }

  return { render: render, kindFor: kindFor, bowlardThrows: bowlardThrows };
})();
