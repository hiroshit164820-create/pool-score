/**
 * ui_import.js — 届いた試合を取り込む画面（本人の指示 2026-08-21）
 *
 * 相手から送られたリンクを開くと、この画面が出る。
 *
 * 本人の心配（「万が一名前が違った場合はどうなる？」）に対して:
 *   送られてきた名前をそのまま信じず、**取り込む前に対応付けを1回だけ確認する**。
 *   ・名前が一致する人がいれば、それを選んだ状態にしておく
 *   ・一致しなければ空にして「登録済みから選ぶ／新しく登録する／成績に入れない」
 *   ・何も選ばなければ「成績に入れない（記録だけ残す）」に倒す
 *     → 間違った人の勝率が動くことはない
 *   ・一度対応付けたら覚えるので、次からは自動で埋まる
 *
 * 2026-08-22 追記（本人の実機での指摘）:
 *   「LINEで開いたブラウザ上でしか反映されず、ホーム画面に追加した
 *     アイコンから開いたアプリの方に取り込まれない」
 *
 *   ホーム画面のアプリとLINEの中のブラウザは、見た目が同じでも
 *   記録の保存場所が別々。リンクを踏んだ側にしか入らない。
 *   そこで2つ足した:
 *     ・アプリの中に**リンクを貼り付けて取り込む**窓（openPaste）
 *     ・リンクを踏んだ側に**このリンクを写す**ボタン
 *       （写してアプリに貼れば、ホーム画面のアプリにも入る）
 */
const IMPORTUI = (function () {
  "use strict";

  const $ = UI.$;

  let payload = null;
  // どちらの側を、この端末の誰として数えるか。null なら成績に入れない
  let mapping = { A: null, B: null };
  let bound = false;
  // "recv" … リンクを踏んで開いた／"paste" … アプリの中で貼り付けて取り込む
  let mode = "recv";
  // 貼り付け窓に出す注意書き
  let pasteMsg = "";
  // 「#」の変化を見張っているか（同じ画面のままリンクを踏んだ場合の対応）
  let watching = false;

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("importCloseBtn").addEventListener("click", function () {
      SHARE.clearHash();
      const fromPaste = mode === "paste";
      payload = null;
      pasteMsg = "";
      // 履歴から「受け取る」で来たときは履歴に戻す
      if (fromPaste && typeof HISTORY !== "undefined") HISTORY.open();
      else UI.showScreen("screenSetup");
    });
  }

  /**
   * アプリを開いたままリンクを踏んだときも取り込めるようにする。
   *
   * 同じページの「#」だけが変わる移動では、ブラウザは読み込み直さない。
   * 起動時の1回だけを見ていると、その場合に何も起きなかった
   * （実測で確認 2026-08-22）。
   */
  function watchHash() {
    if (watching) return;
    watching = true;
    window.addEventListener("hashchange", function () { checkHash(); });
  }

  /** 起動時と、「#」が変わったときに呼ぶ。記録が入っていれば取り込み画面を開く */
  function checkHash() {
    watchHash();
    const body = SHARE.readHash();
    if (!body) return false;
    SHARE.decode(body).then(function (obj) {
      open(obj);
    }).catch(function (e) {
      SHARE.clearHash();
      UI.toast("この記録は読めませんでした（" + (e && e.message) + "）", "warn");
    });
    return true;
  }

  function open(obj, viaPaste) {
    bindOnce();
    mode = viaPaste ? "paste" : "recv";
    payload = obj;
    mapping = {
      A: SHARE.guessPlayer(sideName("A")),
      B: SHARE.guessPlayer(sideName("B")),
    };
    render();
    UI.showScreen("screenImport");
  }

  function sideOf(id) {
    return (payload.sides || []).find(function (s) { return s.sideId === id; }) || {};
  }

  function sideName(id) {
    return sideOf(id).name || (id === "A" ? "プレーヤーA" : "プレーヤーB");
  }

  function gameLabel() {
    const g = (typeof GAMES !== "undefined" && GAMES[payload.gameId]) || null;
    return g ? g.label : payload.gameId;
  }

  function scoreText() {
    const r = payload.result;
    if (!r) return "まだ終わっていない記録です";
    if (r.racks && (r.racks.A || r.racks.B) && !(r.scores && (r.scores.A || r.scores.B))) {
      return r.racks.A + " - " + r.racks.B + "（ラック）";
    }
    if (r.scores) return r.scores.A + " - " + r.scores.B + "（点）";
    return "—";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 "
      + String(d.getHours()).padStart(2, "0") + ":"
      + String(d.getMinutes()).padStart(2, "0");
  }

  /* ---------- 画面 ---------- */

  /** 見出しと副題を書き換える */
  function setHead(title, sub) {
    const t = $("importTitle");
    if (t) t.textContent = title;
    const s2 = $("importSub");
    if (s2) s2.textContent = sub;
  }

  function render() {
    const body = $("importBody");
    UI.clear(body);
    if (!payload) { renderPaste(body); return; }

    const dup = SHARE.alreadyHave(payload.id);
    setHead("届いた試合", dup ? "この試合はもう持っています" : "記録が送られてきました");

    // ---- 届いた中身 ----
    const card = UI.el("div", { class: "match-card import-card" }, [
      UI.el("div", { class: "mc-game", text: gameLabel() }),
      UI.el("div", { class: "mc-main" }, [
        UI.el("span", { class: "mc-nm" }, [UI.el("span", { text: sideName("A") })]),
        UI.el("span", { class: "mc-score", text: scoreText() }),
        UI.el("span", { class: "mc-nm" }, [UI.el("span", { text: sideName("B") })]),
      ]),
      UI.el("p", { class: "hint", text: fmtDate(payload.createdAt) }),
    ]);
    if (payload.result && payload.result.winner) {
      card.appendChild(
        UI.el("p", { class: "hint", text: sideName(payload.result.winner) + " の勝ちです。" })
      );
    }
    if (payload.slim) {
      card.appendChild(
        UI.el("p", {
          class: "hint",
          text: "記録が長かったため、1球ごとの記録は入っていません（結果だけ）。",
        })
      );
    }
    body.appendChild(card);

    // ---- もう持っているとき ----
    if (dup) {
      body.appendChild(
        UI.el("div", { class: "card-note warn-note" }, [
          UI.el("p", { text: "同じ試合がすでに記録にあります。取り込むと二重になります。" }),
        ])
      );
    }

    // ---- 誰として数えるか ----
    body.appendChild(UI.el("div", { class: "section-title", text: "この人は誰ですか" }));
    body.appendChild(
      UI.el("p", {
        class: "hint",
        text: "選ばなかった側は成績に入れず、記録だけを残します。"
          + "名前が違っていても、ここで選べば正しく数えられます。",
      })
    );
    ["A", "B"].forEach(function (id) { body.appendChild(mapRow(id)); });

    // ---- 取り込む ----
    const btn = UI.el("button", {
      class: "primary",
      style: "width:100%;margin-top:14px",
      text: dup ? "それでも取り込む" : "この試合を取り込む",
      onclick: UI.guard(doImport),
    });
    body.appendChild(btn);

    body.appendChild(
      UI.el("button", {
        class: "ghost",
        style: "width:100%;margin-top:8px",
        text: "取り込まない",
        onclick: function () { $("importCloseBtn").click(); },
      })
    );

    // ---- ホーム画面のアプリに入れたいとき（本人の指摘 2026-08-22） ----
    // LINEの中のブラウザで取り込んでも、ホーム画面のアプリには入らない。
    // 別物として保存されるため。リンクを写してアプリで貼り直してもらう
    if (mode === "recv" && !isStandalone()) {
      body.appendChild(
        UI.el("div", { class: "card-note" }, [
          UI.el("p", {
            text: "ホーム画面のアイコンから開くアプリには、ここで取り込んでも入りません"
              + "（別々に保存されるため）。アプリの方に入れたいときは、"
              + "下のボタンでリンクを写して、アプリのホーム →「試合結果を取り込む」で"
              + "貼り付けてください（履歴の「試合結果を受け取る」でも同じです）。",
          }),
          UI.el("button", {
            class: "small",
            style: "margin-top:8px",
            text: "このリンクを写す",
            onclick: UI.guard(copyCurrentLink),
          }),
        ])
      );
    }
  }

  /** ホーム画面から開いたアプリとして動いているか */
  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
        || navigator.standalone === true;
    } catch (e) {
      return false;
    }
  }

  /** いま開いているリンクをクリップボードに写す */
  function copyCurrentLink() {
    const url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        UI.toast("リンクを写しました。アプリのホーム →「試合結果を取り込む」で貼り付けてください。");
      }).catch(function () {
        window.prompt("このリンクを写してください", url);
      });
      return;
    }
    window.prompt("このリンクを写してください", url);
  }

  /* ---------- リンクを貼り付けて取り込む（本人の指示 2026-08-22） ---------- */

  /** アプリの中から開く。貼り付け窓を出す */
  function openPaste() {
    bindOnce();
    mode = "paste";
    payload = null;
    pasteMsg = "";
    render();
    UI.showScreen("screenImport");
  }

  function renderPaste(body) {
    setHead("記録を受け取る", "送られてきたリンクを貼り付けてください");

    // QRで受け取る（本人の指示 2026-08-22）。
    // 同じ店で対面しているなら、相手の画面を写すのがいちばん早い
    body.appendChild(
      UI.el("button", {
        class: "primary scan-open",
        text: "QRを読み取る",
        onclick: UI.guard(openScan),
      })
    );
    body.appendChild(
      UI.el("p", {
        class: "hint",
        text: "相手の履歴で「相手に送る」→「QRを表示する」を出してもらい、"
          + "その画面を写します。",
      })
    );

    body.appendChild(UI.el("div", { class: "section-title", text: "リンクを貼り付ける" }));
    body.appendChild(
      UI.el("p", {
        class: "hint",
        text: "LINEなどに届いたリンクを長押しして写し、下の枠に貼り付けて"
          + "「取り込む」を押してください。リンクの前後に文章が付いていても構いません。",
      })
    );

    const box = UI.el("textarea", {
      id: "importPasteBox",
      class: "paste-box",
      rows: "4",
      placeholder: "ここにリンクを貼り付けます",
      spellcheck: "false",
    });
    body.appendChild(box);

    // 端末によっては押すだけで写したものを入れられる
    const row = UI.el("div", { class: "chips" });
    row.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip",
        text: "写したものを入れる",
        onclick: UI.guard(function () { pasteFromClipboard(box); }),
      })
    );
    row.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip",
        text: "消す",
        onclick: function () { box.value = ""; setPasteMsg(""); },
      })
    );
    body.appendChild(row);

    body.appendChild(
      UI.el("p", { id: "importPasteMsg", class: "hint import-msg", text: pasteMsg })
    );

    body.appendChild(
      UI.el("button", {
        class: "primary",
        style: "width:100%;margin-top:14px",
        text: "取り込む",
        onclick: UI.guard(function () { readPasted(box.value); }),
      })
    );
    body.appendChild(
      UI.el("button", {
        class: "ghost",
        style: "width:100%;margin-top:8px",
        text: "やめる",
        onclick: function () { $("importCloseBtn").click(); },
      })
    );
  }

  function setPasteMsg(text) {
    pasteMsg = text || "";
    const n = $("importPasteMsg");
    if (n) n.textContent = pasteMsg;
  }

  function pasteFromClipboard(box) {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      setPasteMsg("この端末では自動で入れられません。枠を長押しして貼り付けてください。");
      return;
    }
    navigator.clipboard.readText().then(function (t) {
      if (!t) {
        setPasteMsg("写したものが空でした。リンクを長押しして写してください。");
        return;
      }
      box.value = t;
      setPasteMsg("");
    }).catch(function () {
      setPasteMsg("この端末では自動で入れられません。枠を長押しして貼り付けてください。");
    });
  }

  /** 貼り付けられた文字列を読んで、取り込みの確認へ進む */
  function readPasted(text) {
    const bodyStr = SHARE.readAny(text);
    if (!bodyStr) {
      setPasteMsg("リンクが見つかりません。"
        + "「https://」から始まる部分をまるごと写して貼り付けてください。");
      return;
    }
    SHARE.decode(bodyStr).then(function (obj) {
      open(obj, true);
    }).catch(function (e) {
      setPasteMsg("この記録は読めませんでした（" + (e && e.message) + "）。"
        + "もう一度、リンクをまるごと写して貼り付けてください。");
    });
  }

  /** 片方ぶんの対応付けの行 */
  function mapRow(id) {
    const wrap = UI.el("div", { class: "field import-map" });
    const chosen = mapping[id];
    const me = STORE.getSelf();

    wrap.appendChild(
      UI.el("label", {
        class: "side-" + id.toLowerCase(),
        text: "送られてきた名前： " + sideName(id),
      })
    );

    const chips = UI.el("div", { class: "chips" });
    // 自分をいちばん先に出す（いちばん多く選ぶため）
    const players = STORE.listPlayers().slice().sort(function (a, b) {
      if (me && a.id === me.id) return -1;
      if (me && b.id === me.id) return 1;
      return a.name.localeCompare(b.name, "ja");
    });
    players.forEach(function (p) {
      // 反対側で選ばれている人は出さない（同じ人を両側にできないため）
      const other = id === "A" ? "B" : "A";
      if (mapping[other] === p.id) return;
      chips.appendChild(
        UI.el("button", {
          type: "button",
          class: "chip" + (chosen === p.id ? " is-on" : ""),
          "aria-pressed": String(chosen === p.id),
          text: p.name + (me && p.id === me.id ? "（自分）" : ""),
          onclick: function () {
            mapping[id] = chosen === p.id ? null : p.id;
            render();
          },
        })
      );
    });
    wrap.appendChild(chips);

    const row = UI.el("div", { class: "chips" });
    row.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip" + (chosen === null ? " is-on" : ""),
        "aria-pressed": String(chosen === null),
        text: "成績に入れない",
        onclick: function () { mapping[id] = null; render(); },
      })
    );
    row.appendChild(
      UI.el("button", {
        type: "button",
        class: "chip",
        text: "「" + sideName(id) + "」を新しく登録する",
        onclick: UI.guard(function () {
          const p = STORE.upsertPlayer(sideName(id));
          if (!p) { UI.toast("登録できませんでした。", "warn"); return; }
          mapping[id] = p.id;
          UI.toast("「" + sideName(id) + "」を登録しました。");
          render();
        }),
      })
    );
    wrap.appendChild(row);

    // いまの選び方を文章で出す（読み違いを防ぐ）
    const now = chosen ? (STORE.findPlayerById(chosen) || {}).name : null;
    wrap.appendChild(
      UI.el("p", {
        class: "hint",
        text: now ? "→ " + now + " として数えます"
          : "→ 成績には入れません（記録だけ残します）",
      })
    );
    return wrap;
  }

  function doImport() {
    if (!payload) return;
    const saved = SHARE.importMatch(payload, mapping);
    if (!saved) {
      UI.toast("保存できませんでした。空き容量を確認してください。", "danger");
      return;
    }
    SHARE.clearHash();
    const names = ["A", "B"].map(function (id) {
      const pid = mapping[id];
      return pid ? (STORE.findPlayerById(pid) || {}).name : sideName(id);
    });
    payload = null;
    UI.toast("取り込みました（" + names.join(" 対 ") + "）。");
    if (typeof HISTORY !== "undefined") HISTORY.open();
    else UI.showScreen("screenSetup");
  }

  /* ---------- QRを写して取り込む（本人の指示 2026-08-22） ---------- */

  // カメラの映像。止めるときに使うので取っておく
  let stream = null;
  // 毎フレームの読み取りを止めるための番号
  let rafId = 0;
  let scanBound = false;
  // 読み取り用の作業台（画面には出さない）
  let scanCanvas = null;

  function scanBindOnce() {
    if (scanBound) return;
    scanBound = true;
    const close = $("scanCloseBtn");
    if (close) close.addEventListener("click", UI.guard(closeScan));
    const back = $("qrScanModal");
    if (back) {
      back.addEventListener("click", function (e) {
        if (e.target === back) closeScan();
      });
    }
    const file = $("scanFile");
    if (file) file.addEventListener("change", function (e) { readPhoto(e.target); });
  }

  function setScanMsg(text) {
    const n = $("scanMsg");
    if (n) n.textContent = text || "";
  }

  function openScan() {
    scanBindOnce();
    const m = $("qrScanModal");
    if (!m) return;
    setScanMsg("");
    m.hidden = false;

    if (typeof QRDECODE === "undefined") {
      setScanMsg("この版では読み取れません。リンクを貼り付けてください。");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanMsg("この端末ではカメラを開けません。下の「写真から読み取る」を使ってください。");
      return;
    }

    // 背面カメラを頼む。QRは細かいので、取れるなら高い解像度をもらう
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 1280 },
      },
      audio: false,
    }).then(function (s) {
      stream = s;
      const v = $("scanVideo");
      v.srcObject = s;
      // iOSは playsinline が無いと全画面になる（index.html 側で付けてある）
      return v.play();
    }).then(function () {
      setScanMsg("QRが枠に収まるように近づけてください。");
      tick();
    }).catch(function (e) {
      // 断られた／カメラが無い。理由が分かる言い方にする
      const name = (e && e.name) || "";
      if (name === "NotAllowedError") {
        setScanMsg("カメラの使用が許可されていません。"
          + "端末の設定でこのサイトのカメラを許可するか、下の「写真から読み取る」を使ってください。");
      } else if (name === "NotFoundError") {
        setScanMsg("カメラが見つかりません。下の「写真から読み取る」を使ってください。");
      } else {
        setScanMsg("カメラを開けませんでした（" + (name || "理由不明") + "）。"
          + "下の「写真から読み取る」を使ってください。");
      }
    });
  }

  function closeScan() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    // 止め忘れるとカメラのランプが点いたままになる
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    const v = $("scanVideo");
    if (v) v.srcObject = null;
    const m = $("qrScanModal");
    if (m) m.hidden = true;
  }

  /** 毎フレーム、映像を1枚取って読んでみる */
  function tick() {
    rafId = requestAnimationFrame(tick);
    const v = $("scanVideo");
    if (!v || !v.videoWidth) return;

    if (!scanCanvas) scanCanvas = document.createElement("canvas");
    // 大きすぎると1枚あたりが重い。長辺720までに抑える
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    if (scanCanvas.width !== w) { scanCanvas.width = w; scanCanvas.height = h; }
    const ctx = scanCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, w, h);

    let text = null;
    try {
      text = QRDECODE.fromImageData(ctx.getImageData(0, 0, w, h));
    } catch (e) {
      text = null;
    }
    if (text) gotScan(text);
  }

  /** 読めたときの処理。取り込みの確認へ進む */
  function gotScan(text) {
    const bodyStr = SHARE.readAny(text);
    if (!bodyStr) {
      // このアプリのQRではない。読み続ける
      setScanMsg("このQRは試合の記録ではありません。");
      return;
    }
    closeScan();
    SHARE.decode(bodyStr).then(function (obj) {
      open(obj, true);
      UI.toast("QRを読み取りました。");
    }).catch(function (e) {
      openPaste();
      setPasteMsg("読み取れましたが中身が読めませんでした（" + (e && e.message) + "）。");
    });
  }

  /** カメラが使えない端末のための道。写真を1枚選んで読む */
  function readPhoto(input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    setScanMsg("写真を読んでいます…");
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = function () {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let text = null;
      try {
        text = QRDECODE.fromImageData(ctx.getImageData(0, 0, c.width, c.height));
      } catch (e) {
        text = null;
      }
      input.value = "";
      if (text) { gotScan(text); return; }
      setScanMsg("この写真からはQRを読み取れませんでした。"
        + "QRが大きく写るように、明るい場所で撮り直してください。");
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      input.value = "";
      setScanMsg("この写真を開けませんでした。");
    };
    img.src = url;
  }

  return {
    checkHash: checkHash,
    open: open,
    openPaste: openPaste,
    openScan: openScan,
    closeScan: closeScan,
  };
})();
