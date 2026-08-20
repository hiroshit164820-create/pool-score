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
    $("layoutListBtn").addEventListener("click", UI.guard(toggleList));

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
      sub.textContent = editingName
        ? editingName + " を編集中"
        : (balls.length ? balls.length + "個" : "球を置いてください");
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
    return balls.map(function (b) { return { n: b.n, x: b.x, y: b.y }; });
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
    balls = past.pop();
    render();
    UI.toast("一つ前に戻しました。");
  }

  function redo() {
    if (!future.length) {
      UI.toast("進める操作がありません。", "warn");
      return;
    }
    past.push(snapshot());
    balls = future.pop();
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
    if (!balls.length) return;
    remember();
    balls = [];
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
    if (!balls.length) {
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

  function toggleList() {
    const list = $("layoutList");
    if (!list) return;
    list.hidden = !list.hidden;
    if (!list.hidden) renderList();
  }

  function renderList() {
    const list = $("layoutList");
    if (!list || list.hidden) return;
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
          UI.el("div", { class: "li-sub", text: l.balls.length + "個" }),
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
    editingId = l.id;
    editingName = l.name;
    const memo = $("layoutMemo");
    if (memo) memo.value = l.note || "";
    const list = $("layoutList");
    if (list) list.hidden = true;
    render();
    UI.toast("「" + l.name + "」を呼び出しました。");
  }

  return { open: open, render: render };
})();
