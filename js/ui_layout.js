/**
 * ui_layout.js — 練習配置の保存と呼び出し
 *
 * 台の俯瞰図に球を並べて保存し、あとで同じ配置を作り直せるようにする。
 * ドリル練習で「前回と同じ形からやる」ための道具。
 *
 * 位置は台の大きさに対する割合（0〜1）で持つ。
 * 画面の大きさが変わっても同じ配置に見えるようにするため。
 *
 * 試合の記録とは無関係。ここで作った配置がスコアに影響することはない。
 */

const LAYOUT = (function () {
  const $ = UI.$;
  let bound = false;

  // いま台に乗っている球（{ n: 番号(0=手玉), x, y }）
  let balls = [];
  // 台に引いた直線（{ x1, y1, x2, y2 }）。球と同じく台に対する割合で持つ
  let lines = [];
  // なぞった通りの線（{ pts: [{x, y}, ...] }）。こちらも割合で持つ
  let strokes = [];
  // いまの操作。null（球を動かす）／"line"（直線）／"draw"（描画）
  // 線を引く間は球を掴めない（指がどちらに効くか分からなくなるため）
  let mode = null;
  // 指を離す前の線。確定していないので lines / strokes には入れない
  let preview = null;
  let previewPts = null;
  // 編集中の配置。保存済みを開いたときだけ id が入る
  let editingId = null;
  let editingName = "";

  function bindOnce() {
    if (bound) return;
    bound = true;
    buildChrome();
    $("layoutSaveBtn").addEventListener("click", UI.guard(save));
    $("layoutClearBtn").addEventListener("click", UI.guard(clearAll));
    $("layoutUndoBtn").addEventListener("click", UI.guard(undo));
    $("layoutRedoBtn").addEventListener("click", UI.guard(redo));
    $("layoutListBtn").addEventListener("click", UI.guard(openList));

    // 一覧はその場で重ねて開くカードにした（本人の指示 2026-08-22）。
    // 下に長く伸ばす作りだと、押しても画面の外に開いて気づけなかった
    const closeBtn = $("layoutListCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", UI.guard(closeList));
    const backdrop = $("layoutListModal");
    if (backdrop) {
      // 背景（カードの外）を押しても閉じる
      backdrop.addEventListener("click", function (e) {
        if (e.target === backdrop) closeList();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeList();
    });

    // 画面の向きや大きさが変わったら台を測り直す。
    // 入れておかないと、横向きにしたときに台が画面からはみ出す
    window.addEventListener("resize", fitTable);
    window.addEventListener("orientationchange", fitTable);
  }

  /**
   * 画面の骨組みを組み替える。
   *
   * ・「配置を保存」を上の帯へ動かし、そのぶん盤面を大きく取る
   * ・「一つ前に戻る」「全部どける」を台の左、「一つ次に進む」を台の右に縦に並べる
   * ・一言メモの入力欄を足す
   *
   * 本来は index.html を直接書き換える箇所だが、同じ時間に別のセッションが
   * index.html を編集していたため、書き込みの衝突でどちらかの変更が消えるのを
   * 避けてここで組み替えている。手が空いたら index.html 側へ移してよい。
   */
  function buildChrome() {
    const screen = document.getElementById("screenLayout");
    if (!screen || screen.querySelector(".lay-stage")) return;

    // 「配置を保存」を上の帯へ
    const topbar = screen.querySelector(".topbar");
    const saveBtn = $("layoutSaveBtn");
    if (topbar && saveBtn) {
      saveBtn.className = "small primary";
      saveBtn.textContent = "配置を保存";
      topbar.appendChild(saveBtn);
    }

    // 台の左右にボタンの列を作る
    const wrap = screen.querySelector(".table-wrap");
    if (!wrap || !wrap.parentNode) return;
    const stage = UI.el("div", { class: "lay-stage" });
    wrap.parentNode.insertBefore(stage, wrap);

    const left = UI.el("div", { class: "lay-side lay-left" });
    const right = UI.el("div", { class: "lay-side lay-right" });
    stage.appendChild(left);
    stage.appendChild(wrap);
    stage.appendChild(right);

    const undoBtn = $("layoutUndoBtn");
    const clearBtn = $("layoutClearBtn");
    if (undoBtn) {
      undoBtn.className = "ghost";
      undoBtn.textContent = "一つ前に戻る";
      left.appendChild(undoBtn);
    }
    if (clearBtn) {
      clearBtn.className = "ghost";
      clearBtn.textContent = "全部どける";
      left.appendChild(clearBtn);
    }
    right.appendChild(
      UI.el("button", {
        type: "button", id: "layoutRedoBtn", class: "ghost", text: "一つ次に進む",
      })
    );

    // ボタンを抜いたあとの元の並びは空になるので畳む
    const actions = screen.querySelector(".layout-actions");
    if (actions && !actions.querySelector("button")) actions.hidden = true;

    // 「直線を引く」と「描画する」の切り替え。球の一覧の上に横に並べる。
    // 台の左右の列は細く、ここに置くと文字が読めなくなるため
    const hint = $("layoutHint");
    if (hint && hint.parentNode && !$("layoutLineBtn")) {
      const tools = UI.el("div", { class: "lay-tools" }, [
        UI.el("button", {
          type: "button", id: "layoutLineBtn", class: "ghost",
          text: "直線を引く",
          "aria-pressed": "false",
          onclick: function () { setMode(mode === "line" ? null : "line"); },
        }),
        UI.el("button", {
          type: "button", id: "layoutDrawBtn", class: "ghost",
          text: "描画する",
          "aria-pressed": "false",
          onclick: function () { setMode(mode === "draw" ? null : "draw"); },
        }),
      ]);
      hint.parentNode.insertBefore(tools, hint);
    }

    // 一言メモ（球の一覧のすぐ下）
    const tray = $("ballTray");
    if (tray && tray.parentNode && !$("layoutMemo")) {
      tray.parentNode.insertBefore(
        UI.el("input", {
          id: "layoutMemo",
          class: "lay-memo",
          type: "text",
          maxlength: "80",
          placeholder: "一言メモ（例: 押しのコース練習）",
          autocomplete: "off",
        }),
        tray.nextSibling
      );
    }
  }

  function open() {
    bindOnce();
    // 先に画面を出す。隠れたままだと幅が0で、台の大きさを測れない
    UI.showScreen("screenLayout");
    render();
    // 出た直後は幅がまだ確定していないことがあるので、1フレーム待って測り直す
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(fitTable);
  }

  /* ---------- 台の描画 ---------- */

  function render() {
    renderTable();
    renderTray();
    renderList();
    syncUndo();
    const sub = $("layoutSub");
    if (sub) {
      const bits = [];
      if (balls.length) bits.push(balls.length + "個");
      if (lines.length) bits.push("直線 " + lines.length + "本");
      if (strokes.length) bits.push("描画 " + strokes.length + "本");
      sub.textContent = editingName
        ? editingName + " を編集中"
        : (bits.length ? bits.join("　") : "球を置いてください");
    }
  }

  /**
   * 盤面の履歴。「一つ前に戻る」「一つ次に進む」の両方に使う。
   *
   * 球は指より小さく、どけるつもりで動かす・動かすつもりでどけるが
   * 起きやすい。1手だけでは足りないので、直近30手ぶんを控える。
   */
  let past = [];
  let future = [];
  const HISTORY_MAX = 30;

  function snapshot() {
    return {
      balls: balls.map(function (b) { return { n: b.n, x: b.x, y: b.y }; }),
      lines: lines.map(function (l) {
        return { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
      }),
      strokes: strokes.map(function (t) {
        return { pts: t.pts.map(function (q) { return { x: q.x, y: q.y }; }) };
      }),
    };
  }

  /** 控えから盤面を戻す */
  function restore(snap) {
    balls = (snap && snap.balls) ? snap.balls : [];
    lines = (snap && snap.lines) ? snap.lines : [];
    strokes = (snap && snap.strokes) ? snap.strokes : [];
  }

  /** 球の直径（px）。css/v2.css の .tb-ball と揃える */
  const BALL_PX = 40;

  /** いまの盤面を控える。盤面を変える操作の直前に呼ぶ */
  function remember() {
    past.push(snapshot());
    if (past.length > HISTORY_MAX) past.shift();
    // 新しい操作をしたら「進む」先は無くなる（分岐を持たせない）
    future = [];
    syncUndo();
  }

  /** 「戻る」「進む」のボタンの出し分け */
  function syncUndo() {
    const back = $("layoutUndoBtn");
    if (back) back.disabled = !past.length;
    const fwd = $("layoutRedoBtn");
    if (fwd) fwd.disabled = !future.length;
  }

  function undo() {
    if (!past.length) {
      UI.toast("戻せる操作がありません。", "warn");
      return;
    }
    future.push(snapshot());
    restore(past.pop());
    render();
    UI.toast("一つ前に戻しました。");
  }

  function redo() {
    if (!future.length) {
      UI.toast("進める操作がありません。", "warn");
      return;
    }
    past.push(snapshot());
    restore(future.pop());
    render();
    UI.toast("一つ次に進みました。");
  }

  /**
   * ポケット6つと、ポケットの間のポイント（ダイヤ）18個を描く。
   *
   * どこを狙っているかは実物の台ではダイヤで測る。目印が無いと
   * 保存した配置を台の上で再現できないため、実物と同じ位置に置く。
   * 押せるものではないので pointer-events は CSS 側で切ってある。
   */
  function renderMarks() {
    const table = $("poolTable");
    if (!table || table.querySelector(".pt-marks")) return;
    const marks = UI.el("div", { class: "pt-marks" });

    // 目印の箱（.pt-marks）はレール（茶色の枠）まで含めた大きさにしてある。
    // ポイント（ダイヤ）は実物と同じくレールの上に乗せる（本人の指示 2026-08-21）。
    // 角は left/top、反対側は right/bottom を使って端に貼り付ける
    function place(node, side) {
      if (side.left !== undefined) node.style.left = side.left;
      if (side.right !== undefined) node.style.right = side.right;
      if (side.top !== undefined) node.style.top = side.top;
      if (side.bottom !== undefined) node.style.bottom = side.bottom;
      marks.appendChild(node);
    }

    // ポケット。角4つ
    place(UI.el("div", { class: "pt-pocket" }), { left: "0", top: "0" });
    place(UI.el("div", { class: "pt-pocket" }), { right: "0", top: "0" });
    place(UI.el("div", { class: "pt-pocket" }), { left: "0", bottom: "0" });
    place(UI.el("div", { class: "pt-pocket" }), { right: "0", bottom: "0" });
    // サイドポケット。長辺の真ん中
    place(UI.el("div", { class: "pt-pocket side" }), { left: "0", top: "50%" });
    place(UI.el("div", { class: "pt-pocket side" }), { right: "0", top: "50%" });

    // ポイント。短辺は3つずつ、長辺はサイドポケットを挟んで3つずつ（計18）。
    // レールの幅は css/v2.css の --rail（14px）。
    // ダイヤは45度回しているので見かけの幅は約11px。レールの真ん中に来る値を置く
    const RAIL = "1.5px";
    [25, 50, 75].forEach(function (x) {
      place(UI.el("div", { class: "pt-dot h" }), { left: x + "%", top: RAIL });
      place(UI.el("div", { class: "pt-dot h" }), { left: x + "%", bottom: RAIL });
    });
    [12.5, 25, 37.5, 62.5, 75, 87.5].forEach(function (y) {
      place(UI.el("div", { class: "pt-dot v" }), { top: y + "%", left: RAIL });
      place(UI.el("div", { class: "pt-dot v" }), { top: y + "%", right: RAIL });
    });

    // 球より下に敷く
    table.insertBefore(marks, table.firstChild);
  }

  /**
   * 台の大きさを実測して決める。
   *
   * CSSだけで「高さを決めて幅を導く」書き方（aspect-ratio + width:auto）にしていたが、
   * 実機で台が細長い棒に潰れた（本人の指摘 2026-08-21）。
   * 手元のChromium・Firefox・WebKitでは再現しなかったため、環境に依存しない
   * 「舞台の実寸から計算して入れる」方式に変える。
   *
   * ラシャ（内側）が縦：横＝2：1になるようにし、その外側にレールを足す。
   */
  const RAIL_PX = 14;

  function fitTable() {
    const table = $("poolTable");
    const stage = document.querySelector(".lay-stage");
    if (!table || !stage) return;

    // 左右のボタン列と、その間の余白を引いた残りが台に使える幅
    let used = 0;
    Array.prototype.forEach.call(stage.querySelectorAll(".lay-side"), function (n) {
      used += n.getBoundingClientRect().width;
    });
    const gaps = 12; // .lay-stage の gap 6px × 2か所
    // 画面がまだ出ていないと幅が0になる。そのときは前の大きさを残す
    // （0を元に計算すると台が最小まで縮んで、実機の「潰れ」と同じ見た目になる）
    if (stage.clientWidth < 80) return;
    const availW = Math.max(60, stage.clientWidth - used - gaps);
    // 縦は画面の62%まで。これ以上取ると下の球の一覧が画面から出る
    const availH = Math.max(140, Math.round(window.innerHeight * 0.62));

    const feltW = Math.max(40, Math.min(
      Math.floor(availW - RAIL_PX * 2),
      Math.floor((availH - RAIL_PX * 2) / 2)
    ));
    table.style.width = (feltW + RAIL_PX * 2) + "px";
    table.style.height = (feltW * 2 + RAIL_PX * 2) + "px";
  }

  function renderTable() {
    renderMarks();
    fitTable();
    renderLines();
    const wrap = $("tableBalls");
    if (!wrap) return;
    UI.clear(wrap);

    balls.forEach(function (b, i) {
      // 試合画面と同じ描き方にする（別のアプリの球に見えないように）
      const node = UI.el("button", {
        type: "button",
        class: "tb-ball" + (b.n === 0 ? " cue" : ""),
        "data-idx": String(i),
        "data-ball": String(b.n),
        title: b.n === 0 ? "手玉" : b.n + "番",
      });
      paintBall(node, b.n);
      node.style.left = (b.x * 100) + "%";
      node.style.top = (b.y * 100) + "%";
      bindDrag(node, i);
      wrap.appendChild(node);
    });
  }

  /* ---------- 直線（ボールの軌道） ---------- */

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, String(attrs[k]));
    });
    return node;
  }

  /**
   * SVGの座標系。割合（0〜1）を 0〜VB の数に直して描く。
   *
   * なぞった線（polyline）は「%」を受け付けないため、
   * 直線と同じ座標系に揃える必要がある。台は縦長なので
   * preserveAspectRatio="none" で伸ばし、線の太さが縦横で
   * 変わらないよう vector-effect="non-scaling-stroke" を付ける。
   */
  const VB = 1000;
  function u(v) { return Math.round(v * VB * 10) / 10; }

  /**
   * 引いた直線を描く。
   *
   * 球（z-index 2）より下、台の目印より上に敷く。
   * ラシャの色に負けないよう、濃い縁取りの上に明るい線を重ねる。
   * 線そのものは指に反応させず（pointer-events: none）、
   * どの線を押したかは JS 側で距離を測って決める。重なった線でも
   * 「一番近い1本」だけが消えるようにするため。
   */
  function renderLines() {
    const table = $("poolTable");
    if (!table) return;
    let svg = table.querySelector(".pt-lines");
    if (!svg) {
      svg = svgEl("svg", {
        class: "pt-lines",
        viewBox: "0 0 " + VB + " " + VB,
        preserveAspectRatio: "none",
      });
      table.insertBefore(svg, $("tableBalls") || null);
      bindDraw(table);
    }
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // 濃い縁取りの上に明るい線を重ねる。2本で1本に見せる
    function pair(name, attrs, isPreview) {
      ["ptl-edge", "ptl-main" + (isPreview ? " is-preview" : "")].forEach(function (cls) {
        const node = svgEl(name, attrs);
        node.setAttribute("class", cls);
        node.setAttribute("stroke-linecap", "round");
        node.setAttribute("stroke-linejoin", "round");
        node.setAttribute("fill", "none");
        node.setAttribute("vector-effect", "non-scaling-stroke");
        svg.appendChild(node);
      });
    }

    lines.concat(preview ? [preview] : []).forEach(function (l, i, arr) {
      pair("line", {
        x1: u(l.x1), y1: u(l.y1), x2: u(l.x2), y2: u(l.y2),
      }, !!preview && i === arr.length - 1);
    });

    strokes.concat(previewPts ? [{ pts: previewPts }] : []).forEach(function (t, i, arr) {
      if (!t.pts || t.pts.length < 2) return;
      pair("polyline", {
        points: t.pts.map(function (q) { return u(q.x) + "," + u(q.y); }).join(" "),
      }, !!previewPts && i === arr.length - 1);
    });
  }

  /** 指の位置を台に対する割合（0〜1）にする */
  function ratioOf(e, table) {
    const rect = table.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }

  /** 点と線分の距離（px）。押した線を選ぶのに使う */
  function distToLine(px, py, l, rect) {
    const x1 = l.x1 * rect.width, y1 = l.y1 * rect.height;
    const x2 = l.x2 * rect.width, y2 = l.y2 * rect.height;
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  /** 押した場所に一番近い線（直線・描画のどちらでも）を消す。指の幅ぶん（16px）まで拾う */
  function removeLineAt(pt, rect) {
    const px = pt.x * rect.width, py = pt.y * rect.height;
    let best = 16;
    let hit = null;
    lines.forEach(function (l, i) {
      const d = distToLine(px, py, l, rect);
      if (d < best) { best = d; hit = { kind: "line", i: i }; }
    });
    strokes.forEach(function (t, i) {
      for (let k = 1; k < t.pts.length; k++) {
        const seg = { x1: t.pts[k - 1].x, y1: t.pts[k - 1].y, x2: t.pts[k].x, y2: t.pts[k].y };
        const d = distToLine(px, py, seg, rect);
        if (d < best) { best = d; hit = { kind: "stroke", i: i }; }
      }
    });
    if (!hit) {
      UI.toast("台を指でなぞると線が引けます。", "warn");
      return;
    }
    remember();
    if (hit.kind === "line") lines.splice(hit.i, 1);
    else strokes.splice(hit.i, 1);
    render();
    UI.toast("線を消しました。「一つ前に戻る」で戻せます。");
  }

  /**
   * 台をなぞって直線を引けるようにする。
   *
   * 「線を引く」に入っている間だけ効く。ふだんは球を動かすほうを優先する。
   * ほとんど動かさずに離したときは、その場所の線を消す操作にする
   * （球と同じ作法にそろえる）。
   */
  function bindDraw(table) {
    let from = null;

    table.addEventListener("pointerdown", function (e) {
      if (!mode) return;
      e.preventDefault();
      from = ratioOf(e, table);
      if (mode === "line") preview = { x1: from.x, y1: from.y, x2: from.x, y2: from.y };
      else previewPts = [{ x: from.x, y: from.y }];
      try { table.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
    });

    table.addEventListener("pointermove", function (e) {
      if (!mode || !from) return;
      const p = ratioOf(e, table);
      if (mode === "line") {
        preview = { x1: from.x, y1: from.y, x2: p.x, y2: p.y };
      } else {
        // 指のぶれで点が増えすぎないよう、3px以上動いたときだけ足す
        const rect = table.getBoundingClientRect();
        const last = previewPts[previewPts.length - 1];
        const dx = (p.x - last.x) * rect.width;
        const dy = (p.y - last.y) * rect.height;
        if (Math.sqrt(dx * dx + dy * dy) < 3) return;
        previewPts.push({ x: p.x, y: p.y });
      }
      renderLines();
    });

    function end(e) {
      if (!from) return;
      const p = ratioOf(e, table);
      const rect = table.getBoundingClientRect();
      try { table.releasePointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      const start = from;
      const pts = previewPts;
      from = null;
      preview = null;
      previewPts = null;
      const dx = (p.x - start.x) * rect.width;
      const dy = (p.y - start.y) * rect.height;
      const moved = Math.sqrt(dx * dx + dy * dy);

      if (mode === "draw") {
        // なぞった長さで見る。ぐるっと回って元の場所に戻ることがあるため、
        // 始点と終点の距離だけでは「押しただけ」と区別できない
        const len = pathLenPx(pts, rect);
        if (!pts || pts.length < 2 || len < 10) {
          renderLines();
          removeLineAt(p, rect);
          return;
        }
        remember();
        strokes.push({ pts: pts });
        render();
        UI.toast("描きました。線を押すと消せます。");
        return;
      }

      if (moved < 10) {
        // ほとんど動いていない = 押しただけ。その場所の線を消す
        renderLines();
        removeLineAt(p, rect);
        return;
      }
      remember();
      lines.push({ x1: start.x, y1: start.y, x2: p.x, y2: p.y });
      render();
      UI.toast("線を引きました。線を押すと消せます。");
    }

    table.addEventListener("pointerup", end);
    table.addEventListener("pointercancel", function () {
      from = null;
      preview = null;
      previewPts = null;
      renderLines();
    });
  }

  /** なぞった線の長さ（px） */
  function pathLenPx(pts, rect) {
    if (!pts || pts.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = (pts[i].x - pts[i - 1].x) * rect.width;
      const dy = (pts[i].y - pts[i - 1].y) * rect.height;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }

  /**
   * 「直線を引く」「描画する」の入り切り。
   *
   * どちらか一方だけが入る（同時には使えない）。
   * もう一度押すと切れて、球を動かせる状態に戻る。
   */
  function setMode(next) {
    mode = next || null;

    [["layoutLineBtn", "line", "直線を引く", "直線をやめる"],
     ["layoutDrawBtn", "draw", "描画する", "描画をやめる"]].forEach(function (d) {
      const btn = $(d[0]);
      if (!btn) return;
      const on = mode === d[1];
      btn.textContent = on ? d[3] : d[2];
      btn.className = on ? "primary" : "ghost";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    // 線を引く間は球を掴めないようにする
    const wrap = $("tableBalls");
    if (wrap) wrap.style.pointerEvents = mode ? "none" : "";
    const table = $("poolTable");
    if (table) table.classList.toggle("drawing", !!mode);
    const hint = $("layoutHint");
    if (hint) {
      hint.textContent = mode === "line"
        ? "2点を指でなぞると直線が引けます。引いた線を押すと消せます。"
        : (mode === "draw"
          ? "指でなぞった通りに線を描けます。描いた線を押すと消せます。"
          : "下の番号を押すと台に足せます。");
    }
    preview = null;
    previewPts = null;
    renderLines();
  }

  /**
   * 球を試合画面と同じ見た目に塗る。
   *
   * 色・帯・番号枠の形はすべて ballAppearance に任せる。
   * ここで別に組み立てると、ボールセットを増やしたときに
   * 配置図だけ古い色のまま取り残されるため。
   */
  function paintBall(node, n) {
    UI.clear(node);
    if (n === 0) {
      // 手玉は番号を持たない。地の色だけ塗る
      node.style.background = "#f6f2e8";
      return;
    }
    const setId = currentBallSet();
    const ap = ballAppearance(setId, n);
    node.style.background = ap.band
      ? "linear-gradient(180deg," + ap.base + " 0 22%," + ap.band
        + " 22% 78%," + ap.base + " 78% 100%)"
      : ap.base;
    node.style.color = ap.ink;
    // 番号は試合画面と同じく白い丸（セットによっては三角・菱形）の中に置く
    node.appendChild(
      UI.el("span", { class: "bb-num shape-" + ap.shape, text: String(n) })
    );
  }

  /**
   * いま選ばれているボールセット。
   * 設定を読めないときは標準（パラジウム）に倒す。
   */
  function currentBallSet() {
    try {
      const st = STORE.getSettings() || {};
      if (st.ballSet && BALL_SETS[st.ballSet]) return st.ballSet;
    } catch (err) { /* 既定に倒す */ }
    return "standard";
  }

  /**
   * 球を指で動かせるようにする。
   *
   * タップだけなら「取りのける」、動かしたら「移動」にする。
   * 削除用のボタンを別に置くと、球が小さいぶん押し分けにくいため。
   */
  function bindDrag(node, idx) {
    let moved = false;
    let startX = 0;
    let startY = 0;

    node.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      node.setPointerCapture(e.pointerId);
      node.classList.add("dragging");
    });

    node.addEventListener("pointermove", function (e) {
      if (!node.hasPointerCapture || !node.hasPointerCapture(e.pointerId)) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      // 少し動いたら移動とみなす（指のぶれでタップが移動にならないように）
      if (!moved && dx < 6 && dy < 6) return;
      // 動かす前の位置を控える（移動も取り消せるように）。
      // moved が立つ前の1回だけなので、ドラッグ中に上書きされない
      if (!moved) remember();
      moved = true;

      const table = $("poolTable").getBoundingClientRect();
      const x = (e.clientX - table.left) / table.width;
      const y = (e.clientY - table.top) / table.height;
      balls[idx].x = Math.max(0.02, Math.min(0.98, x));
      balls[idx].y = Math.max(0.03, Math.min(0.97, y));
      node.style.left = (balls[idx].x * 100) + "%";
      node.style.top = (balls[idx].y * 100) + "%";
    });

    function end(e) {
      node.classList.remove("dragging");
      try { node.releasePointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      if (!moved) {
        // 動かさずに離した = 台からどける
        remember();
        const b = balls[idx];
        balls.splice(idx, 1);
        render();
        UI.toast((b.n === 0 ? "手玉" : b.n + "番") + " をどけました。「元に戻す」で戻せます。");
      } else {
        render();
      }
    }
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", function () {
      node.classList.remove("dragging");
      render();
    });
  }

  /* ---------- 置ける球の一覧 ---------- */

  function renderTray() {
    const tray = $("ballTray");
    if (!tray) return;
    UI.clear(tray);

    const onTable = {};
    balls.forEach(function (b) { onTable[b.n] = true; });

    // 手玉と1〜15番
    const nums = [0];
    for (let n = 1; n <= 15; n++) nums.push(n);

    nums.forEach(function (n) {
      const used = !!onTable[n];
      const btn = UI.el("button", {
        type: "button",
        class: "tray-ball" + (n === 0 ? " cue" : "") + (used ? " used" : ""),
        "data-ball": String(n),
        title: n === 0 ? "手玉" : n + "番",
        onclick: function () { addBall(n); },
      });
      if (n === 0) btn.textContent = "手";
      else paintBall(btn, n);
      // disabled は属性を付けた時点で効く（false を渡しても無効になる）ので
      // 使うときだけ設定する
      if (used) btn.disabled = true;
      tray.appendChild(btn);
    });
  }

  /** 球を台の真ん中あたりに置く。置いてから指で動かす */
  function addBall(n) {
    if (balls.some(function (b) { return b.n === n; })) return;
    remember();
    const pos = freeSpot(balls.length);
    balls.push({ n: n, x: pos.x, y: pos.y });
    render();
  }

  /**
   * 新しい球を置く場所。
   *
   * 台は幅150px程度しかないため、間隔を割合で決め打つと
   * 球（44px）同士が重なって掴み分けられなくなる。
   * 実寸から1個分の幅を出して、それを間隔にする。
   */
  function freeSpot(k) {
    const table = $("poolTable");
    const rect = table ? table.getBoundingClientRect() : null;
    // 実寸が取れないときだけ、割合の決め打ちに戻す
    if (!rect || !rect.width || !rect.height) {
      return { x: 0.5 + ((k % 3) - 1) * 0.24, y: 0.5 + (Math.floor(k / 3) - 1) * 0.13 };
    }
    // 球1個分＋隙間4px を間隔にする
    const stepX = (BALL_PX + 4) / rect.width;
    const stepY = (BALL_PX + 4) / rect.height;
    // 1行に何個入るか（最低2個は並べる）
    const perRow = Math.max(2, Math.floor(1 / stepX));
    const col = k % perRow;
    const row = Math.floor(k / perRow);
    // 中央に寄せて並べる
    const x = 0.5 + (col - (perRow - 1) / 2) * stepX;
    const y = 0.5 + (row - 1) * stepY;
    return {
      x: Math.max(0.08, Math.min(0.92, x)),
      y: Math.max(0.08, Math.min(0.92, y)),
    };
  }

  function clearAll() {
    if (!balls.length && !lines.length && !strokes.length) return;
    remember();
    balls = [];
    lines = [];
    strokes = [];
    editingId = null;
    editingName = "";
    render();
    UI.toast("台をからにしました。「元に戻す」で戻せます。");
  }

  /* ---------- 保存と呼び出し ---------- */

  /** 一言メモの中身。欄がまだ無いときは空文字 */
  function memoValue() {
    const box = $("layoutMemo");
    return box ? String(box.value || "").trim() : "";
  }

  function save() {
    if (!balls.length && !lines.length && !strokes.length) {
      UI.toast("先に球を置いてください。", "warn");
      return;
    }
    const name = window.prompt(
      "この配置の名前（あとで探すときに使います）",
      editingName || ("配置 " + (STORE.listLayouts().length + 1))
    );
    if (name === null) return;

    const saved = STORE.saveLayout({
      id: editingId,
      name: (name || "").trim() || "名前なし",
      balls: balls,
      lines: lines,
      strokes: strokes,
      note: memoValue(),
    });
    if (!saved) {
      UI.toast("保存できませんでした。", "warn");
      return;
    }
    editingId = saved.id;
    editingName = saved.name;
    render();
    UI.toast("「" + saved.name + "」を保存しました。");
  }

  /** 一覧のカードを開く。中身は開くたびに作り直す */
  function openList() {
    const modal = $("layoutListModal");
    if (!modal) return;
    renderList();
    modal.hidden = false;
  }

  function closeList() {
    const modal = $("layoutListModal");
    if (modal) modal.hidden = true;
  }

  function renderList() {
    const list = $("layoutList");
    if (!list) return;
    UI.clear(list);

    const items = STORE.listLayouts();
    if (!items.length) {
      list.appendChild(
        UI.el("p", { class: "hint", text: "保存した配置はまだありません。" })
      );
      return;
    }

    items.forEach(function (l) {
      const row = UI.el("div", { class: "layout-item" }, [
        UI.el("div", { class: "li-main" }, [
          UI.el("div", { class: "li-name", text: l.name }),
          UI.el("div", {
            class: "li-sub",
            text: l.balls.length + "個"
              + ((l.lines && l.lines.length) ? "　直線 " + l.lines.length + "本" : "")
              + ((l.strokes && l.strokes.length) ? "　描画 " + l.strokes.length + "本" : ""),
          }),
          l.note ? UI.el("div", { class: "li-note", text: l.note }) : null,
        ]),
        UI.el("button", {
          class: "small primary",
          text: "呼び出す",
          onclick: function () { load(l.id); },
        }),
        UI.el("button", {
          class: "small ghost",
          text: "削除",
          onclick: function () {
            if (!window.confirm(
              ["「" + l.name + "」を削除します。", "", "元に戻せません。よろしいですか？"]
                .join(String.fromCharCode(10))
            )) return;
            STORE.deleteLayout(l.id);
            renderList();
            UI.toast("削除しました。");
          },
        }),
      ]);
      list.appendChild(row);
    });
  }

  function load(id) {
    const l = STORE.loadLayout(id);
    if (!l) {
      UI.toast("その配置が見つかりません。", "warn");
      return;
    }
    balls = l.balls.map(function (b) { return { n: b.n, x: b.x, y: b.y }; });
    // 線を入れる前に保存した配置には lines / strokes が無い
    lines = (l.lines || []).map(function (t) {
      return { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2 };
    });
    strokes = (l.strokes || []).map(function (t) {
      return { pts: (t.pts || []).map(function (q) { return { x: q.x, y: q.y }; }) };
    });
    editingId = l.id;
    editingName = l.name;
    const memo = $("layoutMemo");
    if (memo) memo.value = l.note || "";
    closeList();
    render();
    UI.toast("「" + l.name + "」を呼び出しました。");
  }

  return { open: open, render: render };
})();
