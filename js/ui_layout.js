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
    const sub = $("layoutSub");
    if (sub) {
      sub.textContent = editingName
        ? editingName + " を編集中"
        : (balls.length ? balls.length + "個" : "球を置いてください");
    }
  }

  function renderTable() {
    const wrap = $("tableBalls");
    if (!wrap) return;
    UI.clear(wrap);

    balls.forEach(function (b, i) {
      const node = UI.el("button", {
        type: "button",
        class: "tb-ball" + (b.n === 0 ? " cue" : "") + (b.n >= 9 ? " stripe" : ""),
        "data-idx": String(i),
        title: b.n === 0 ? "手玉" : b.n + "番",
        text: b.n === 0 ? "" : String(b.n),
      });
      node.style.left = (b.x * 100) + "%";
      node.style.top = (b.y * 100) + "%";
      if (b.n > 0) node.style.setProperty("--ball-color", ballColor(b.n));
      bindDrag(node, i);
      wrap.appendChild(node);
    });
  }

  /** 球の色。試合画面と同じ配色を使う（別物に見えないように） */
  function ballColor(n) {
    const set = (typeof BALL_SETS !== "undefined") ? BALL_SETS.standard : null;
    if (!set || !set.colors) return "#888888";
    const base = n > 8 ? n - 8 : n;
    return set.colors[base] || "#888888";
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
        const b = balls[idx];
        balls.splice(idx, 1);
        render();
        UI.toast((b.n === 0 ? "手玉" : b.n + "番") + " をどけました。");
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
        class: "tray-ball" + (n === 0 ? " cue" : "") + (n >= 9 ? " stripe" : "") + (used ? " used" : ""),
        title: n === 0 ? "手玉" : n + "番",
        text: n === 0 ? "手" : String(n),
        onclick: function () { addBall(n); },
      });
      // disabled は属性を付けた時点で効く（false を渡しても無効になる）ので
      // 使うときだけ設定する
      if (used) btn.disabled = true;
      if (n > 0) btn.style.setProperty("--ball-color", ballColor(n));
      tray.appendChild(btn);
    });
  }

  /** 球を台の真ん中あたりに置く。置いてから指で動かす */
  function addBall(n) {
    if (balls.some(function (b) { return b.n === n; })) return;
    // 同じ場所に重ならないよう、置くたびに少しずらす
    const k = balls.length;
    balls.push({
      n: n,
      x: 0.5 + ((k % 5) - 2) * 0.07,
      y: 0.5 + (Math.floor(k / 5) - 1) * 0.12,
    });
    render();
  }

  function clearAll() {
    if (!balls.length) return;
    balls = [];
    editingId = null;
    editingName = "";
    render();
    UI.toast("台をからにしました。");
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
