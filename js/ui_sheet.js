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
   * JPAのスコアシートを開いているか。
   *
   * 既定は閉じる（本人の指示 2026-08-20）。1点=1マスの表が縦に長く、
   * 開いたままだとスコアと操作ボタンが画面外に押し出されるため。
   * 開閉の状態は同じ試合の間だけ覚える。
   */
  let jpaOpen = false;

  // 直近に描いた試合。閉じるボタン・背景タップ・Escから描き直すために持つ
  let lastMatch = null;
  let lastState = null;
  // 元の置き場所（画面の中）。閉じたときにここへ戻す
  let sheetHome = null;
  let sheetNext = null;
  let bound = false;

  /**
   * JPAのスコアシートを重ねて開くための箱を作る（本人の指示 2026-08-22）。
   *   「スコアシートボタンは押したらぱっと画面に大きく開くようにして。
   *     現状は縦に狭すぎて見づらい」
   *
   * 画面の中に差し込むと、横向きでは高さが 83px しか取れず読めなかった。
   * 作りは ui_sheetview.js の「終わった試合のスコア表」と同じ
   * （.modal-backdrop + .modal）。index.html は他の作業と重なるので触らず、
   * ここで1回だけ組み立てて body に置く。
   */
  function ensureModal() {
    let back = document.getElementById("sheetModal");
    if (back) return back;
    const card = UI.el("div", { class: "modal sheet-modal-card" });
    back = UI.el("div", {
      class: "modal-backdrop sheet-modal",
      id: "sheetModal",
      hidden: "hidden",
    }, [card]);
    document.body.appendChild(back);
    if (!bound) {
      bound = true;
      back.addEventListener("click", function (e) {
        if (e.target === back) close();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !back.hidden) close();
      });
    }
    return back;
  }

  /** 開いた状態にする（#sheetArea をそのまま重ねの中へ移す） */
  function openOverlay(area) {
    const back = ensureModal();
    const card = back.querySelector(".modal");
    if (sheetHome === null) {
      sheetHome = area.parentNode;
      sheetNext = area.nextSibling;
    }
    if (area.parentNode !== card) card.appendChild(area);
    back.hidden = false;
  }

  /** 閉じた状態にする（元の置き場所へ戻して重ねを消す） */
  function closeOverlay(area) {
    const back = document.getElementById("sheetModal");
    if (back) back.hidden = true;
    if (sheetHome && area.parentNode !== sheetHome) {
      sheetHome.insertBefore(area, sheetNext);
    }
  }

  /**
   * 閉じる。試合画面のボタン（文言・押した状態）も合わせて描き直す。
   * render() からは呼ばない（MATCH.render が SHEET.render を呼ぶため）
   */
  function close() {
    if (!jpaOpen) return;
    jpaOpen = false;
    if (lastMatch) render(lastMatch, lastState);
    if (typeof MATCH !== "undefined" && MATCH.render) MATCH.render();
  }

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
    lastMatch = match;
    lastState = st;
    const screen = $("screenMatch");
    const kind = kindFor(match);
    if (!kind) {
      closeOverlay(area);
      area.hidden = true;
      // シート無しの通常配置に戻す
      if (screen) screen.classList.remove("has-sheet");
      return;
    }
    // JPAのシートは画面に重ねて開く（本人の指示 2026-08-22）ので、
    // 試合画面の高さは取らない。場所を詰めるのはボウラードだけ
    const takesRoom = kind === "bowlard";
    area.hidden = !(takesRoom || (kind === "jpa" && jpaOpen));
    if (screen) {
      screen.classList.toggle("has-sheet", takesRoom);
      // 重ねて開くようになったので、画面の高さを奪う指定は使わない
      screen.classList.remove("jpa-sheet-open");
    }
    if (kind === "jpa" && jpaOpen) openOverlay(area);
    else closeOverlay(area);
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

    // 開閉は下の帯の「スコアシート」ボタンから行う（本人の指示 2026-08-21）。
    // 画面の中に見出しを置くと、横向きでは高さが足りず開いても中身が見えなかった
    if (!jpaOpen) {
      area.hidden = true;
      return;
    }
    const got = { A: series.A.length, B: series.B.length };
    area.appendChild(
      UI.el("div", { class: "sheet-bar" }, [
        UI.el("span", { class: "sheet-title", text: "JPAスコアシート" }),
        UI.el("span", {
          class: "st-sum",
          text: got.A + " / " + match.goal.targets.A + "　・　"
            + got.B + " / " + match.goal.targets.B,
        }),
        UI.el("button", {
          type: "button",
          class: "small ghost st-close",
          text: "閉じる",
          onclick: function () { close(); },
        }),
      ])
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
      let prevRack = null;
      for (let n = 1; n <= target; n++) {
        const hit = series[side][n - 1];
        // ラックが変わるマスに区切り線とラック番号を出す
        // （色だけでは切り替わりが分からない、という本人の指摘 2026-08-21）
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
  // ボウラードは「その投で入れた球数」を balls の個数で持つ。
  // 計算は engine.js（bowlardThrowsOf）に1か所だけ置いてある
  function bowlardThrows(match) {
    return bowlardThrowsOf(match);
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

  /** 下の帯のボタンから開閉する（本人の指示 2026-08-21） */
  function toggle(match, st) {
    jpaOpen = !jpaOpen;
    render(match, st);
    return jpaOpen;
  }

  /** いま開いているか */
  function isOpen() { return jpaOpen; }

  return { render: render, kindFor: kindFor, bowlardThrows: bowlardThrows,
    toggle: toggle, isOpen: isOpen, close: close };
})();
