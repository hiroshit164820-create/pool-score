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
    $("layoutSaveBtn").addEventListener("click", UI.guard(save));
    $("layoutClearBtn").addEventListener("click", UI.guard(clearAll));
    $("layoutUndoBtn").addEventListener("click", UI.guard(undo));
    $("layoutListBtn").addEventListener("click", UI.guard(toggleList));
  }

  function open() {
    bindOnce();
    render();
    UI.showScreen("screenLayout");
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
   * ひとつ前の盤面。取り消し用に1手分だけ控える。
   *
   * 球は指より小さく、どけるつもりで動かす・動かすつもりでどけるが
   * 起きやすい。取り消しが無いと置き直しになるため用意した。
   */
  let prevBalls = null;

  /** 球の直径（px）。style.css の .tb-ball と揃える */
  const BALL_PX = 44;

  /** いまの盤面を控える。盤面を変える操作の直前に呼ぶ */
  function remember() {
    prevBalls = balls.map(function (b) { return { n: b.n, x: b.x, y: b.y }; });
    syncUndo();
  }

  /** 取り消しボタンの出し分け */
  function syncUndo() {
    const btn = $("layoutUndoBtn");
    if (btn) btn.disabled = !prevBalls;
  }

  function undo() {
    if (!prevBalls) {
      UI.toast("戻せる操作がありません。", "warn");
      return;
    }
    balls = prevBalls;
    prevBalls = null;
    render();
    UI.toast("元に戻しました。");
  }

  function renderTable() {
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
    const list = $("layoutList");
    if (list) list.hidden = true;
    render();
    UI.toast("「" + l.name + "」を呼び出しました。");
  }

  return { open: open, render: render };
})();
