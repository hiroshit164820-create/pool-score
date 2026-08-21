/**
 * qrview.js — 試合の記録を「リンク」か「QR」で渡す（本人の指示 2026-08-22）
 *
 * 本人の指示:
 *   「送信時にリンクでおくるか、QRを表示を選択。
 *     受信側はQRを読み込むボタンを押せばカメラが起動する形をとれるように」
 *
 * なぜQRが要るか:
 *   いまはLINEなどを挟まないと渡せない。同じ店で対面しているなら、
 *   画面にQRを出して相手に写してもらうのが一番速く、他のアプリも要らない。
 *   記録はリンクそのものに入っている（share.js）ので、QRに載せるのは
 *   そのリンクの文字列だけでよい。サーバーは介さない。
 *
 * 大きさの見当（実測 2026-08-22）:
 *   1試合ぶんのリンクは約1,100〜2,000字。QRの版で言うと20〜27
 *   （97×97〜125×125マス）。スマホの画面いっぱいに出せば読める大きさだが、
 *   マスが細かいほど失敗しやすいので、細かくなりすぎたときは
 *   「結果だけ」に落として小さくする道を用意する。
 *
 * 描画だけを持ち、符号化は qr.js に任せる。
 */
const QRVIEW = (function () {
  "use strict";

  const $ = UI.$;

  let bound = false;
  // いま渡そうとしている試合
  let match = null;
  // 作ったリンク（{url, chars, slim}）
  let link = null;
  // 「結果だけ」に落としてQRを小さくしたか
  let slimmed = false;

  /** これより細かいQRは、読み取りに失敗しやすいので注意書きを出す */
  const DENSE_VERSION = 25;

  function bindOnce() {
    if (bound) return;
    bound = true;
    const close = $("shareCloseBtn");
    if (close) close.addEventListener("click", UI.guard(closeModal));
    const back = $("shareModal");
    if (back) {
      back.addEventListener("click", function (e) {
        if (e.target === back) closeModal();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  function closeModal() {
    const m = $("shareModal");
    if (m) m.hidden = true;
    match = null;
    link = null;
    slimmed = false;
  }

  /* ---------- 入口 ---------- */

  /**
   * 「相手に送る」を押したときに開く。
   * リンクを先に作ってから出す（QRを選んだ瞬間に待たせないため）。
   */
  function openSend(fullMatch) {
    bindOnce();
    match = fullMatch;
    slimmed = false;
    buildLink(fullMatch).then(function (out) {
      link = out;
      renderChoice();
      const m = $("shareModal");
      if (m) m.hidden = false;
    }).catch(function (e) {
      UI.toast("送る形にできませんでした（" + (e && e.message) + "）", "warn");
    });
  }

  function buildLink(m) {
    return SHARE.makeLink(m);
  }

  /**
   * 「結果だけ」のリンクを作る。
   *
   * share.js には結果だけに落とす道が中にあるが、外から呼べない。
   * 1球ごとの記録を空にした写しを渡せば同じものが得られるので、
   * share.js に手を入れずにこちらで作る。
   */
  function buildSlimLink(m) {
    const copy = {};
    Object.keys(m).forEach(function (k) { copy[k] = m[k]; });
    copy.events = [];
    return SHARE.makeLink(copy);
  }

  function titleOf(m) {
    const g = (typeof GAMES !== "undefined" && GAMES[m.gameId]) || {};
    return (g.label || m.gameId) + "　"
      + m.sides[0].name + " 対 " + m.sides[1].name;
  }

  /* ---------- 選ぶ画面 ---------- */

  function renderChoice() {
    const body = $("shareBody");
    if (!body) return;
    UI.clear(body);
    setHead("記録を送る", titleOf(match));

    body.appendChild(
      UI.el("p", {
        class: "hint",
        text: "同じ場所にいるならQR、離れているならリンクが早いです。",
      })
    );

    body.appendChild(
      UI.el("button", {
        class: "primary share-way",
        text: "QRを表示する",
        onclick: UI.guard(renderQr),
      })
    );
    body.appendChild(
      UI.el("p", { class: "hint", text: "相手にこの画面を写してもらいます。" })
    );

    body.appendChild(
      UI.el("button", {
        class: "share-way",
        text: "リンクで送る",
        onclick: UI.guard(sendLink),
      })
    );
    body.appendChild(
      UI.el("p", { class: "hint", text: "LINEなどに貼って渡します。" })
    );
  }

  function setHead(title, sub) {
    const t = $("shareTitle");
    if (t) t.textContent = title;
    const s = $("shareSub");
    if (s) s.textContent = sub;
  }

  /* ---------- リンクで送る ---------- */

  function sendLink() {
    if (!link) return;
    const text = titleOf(match) + " の記録です。開くと取り込めます。";
    if (navigator.share) {
      navigator.share({ title: "試合の記録", text: text, url: link.url })
        .then(function () {
          UI.toast(link.slim ? "送りました（長いので結果だけにしました）。" : "送りました。");
          closeModal();
        })
        .catch(function () { /* 送るのをやめただけなので何も出さない */ });
      return;
    }
    copyText(link.url).then(function (ok) {
      if (ok) {
        UI.toast("リンクを写しました。LINEなどに貼って送ってください。");
        closeModal();
        return;
      }
      window.prompt("このリンクを送ってください", link.url);
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  /* ---------- QRを出す ---------- */

  function renderQr() {
    const body = $("shareBody");
    if (!body || !link) return;
    UI.clear(body);
    setHead("QRを写してもらう", titleOf(match));

    let qr = null;
    try {
      qr = QRCODE.make(link.url, { ecLevel: "L" });
    } catch (e) {
      body.appendChild(
        UI.el("p", { class: "hint import-msg", text: "QRにできませんでした（" + e.message + "）。" })
      );
      body.appendChild(backButton());
      return;
    }

    const canvas = UI.el("canvas", { id: "shareQrCanvas", class: "qr-canvas" });
    body.appendChild(canvas);
    drawMatrix(canvas, qr);

    body.appendChild(
      UI.el("p", {
        class: "hint",
        text: "相手のアプリで「試合結果を取り込む」→「QRを読み取る」を押して、"
          + "この画面を写してもらってください。",
      })
    );

    // 細かすぎると読み取りに失敗しやすい。小さくする道を出す
    if (qr.version >= DENSE_VERSION && !slimmed) {
      body.appendChild(
        UI.el("div", { class: "card-note" }, [
          UI.el("p", {
            text: "記録が長いためQRが細かくなっています（" + qr.size + "マス）。"
              + "読み取れないときは、1球ごとの記録を省いて小さくできます。",
          }),
          UI.el("button", {
            class: "small",
            style: "margin-top:8px",
            text: "結果だけにして小さくする",
            onclick: UI.guard(makeSlimQr),
          }),
        ])
      );
    } else if (slimmed) {
      body.appendChild(
        UI.el("p", {
          class: "hint",
          text: "結果だけのQRです（" + qr.size + "マス）。1球ごとの記録は入っていません。",
        })
      );
    } else {
      body.appendChild(
        UI.el("p", { class: "hint", text: qr.size + "マス。画面を明るくすると写しやすいです。" })
      );
    }

    body.appendChild(backButton());
  }

  function backButton() {
    return UI.el("button", {
      class: "ghost",
      style: "width:100%;margin-top:10px",
      text: "送り方を選び直す",
      onclick: UI.guard(renderChoice),
    });
  }

  function makeSlimQr() {
    if (!match) return;
    buildSlimLink(match).then(function (out) {
      link = out;
      slimmed = true;
      renderQr();
      UI.toast("結果だけのQRにしました。");
    }).catch(function (e) {
      UI.toast("小さくできませんでした（" + (e && e.message) + "）", "warn");
    });
  }

  /**
   * 行列をcanvasに描く。
   *
   * 読み取りの成否は「実物の1マスが何ミリになるか」でほぼ決まるので、
   * **画面に入る限り大きく**出すことを優先する。
   *
   * ・まわりに余白（クワイエットゾーン）を4マス空ける。これが無いと読めない
   * ・中の絵は1マス＝整数ピクセルで描く（縁が半端になるとにじむ）
   * ・**見た目の大きさは使える幅いっぱいまで広げる**。
   *   整数マスに切り下げた大きさのまま出すと、実測で使える334pxのうち
   *   258pxしか使えず、1マスが0.33mm程度まで細くなっていた（2026-08-22）
   */
  function drawMatrix(canvas, qr) {
    const QUIET = 4;
    const total = qr.size + QUIET * 2;

    // 画面に入る最大の大きさ。横幅と、カードに残る高さの両方を見る
    const avail = Math.max(220, Math.min(
      window.innerWidth - 44,
      Math.max(240, window.innerHeight - 300)
    ));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    // 描く側は1マス＝整数ピクセル。足りないより多いほうがよいので切り上げる
    const cell = Math.max(1, Math.ceil((avail * dpr) / total));
    const px = cell * total;

    canvas.width = px;
    canvas.height = px;
    // 出す大きさは使える幅ちょうど。中は高い解像度で描いてあるので縮めて出す
    canvas.style.width = Math.round(avail) + "px";
    canvas.style.height = Math.round(avail) + "px";

    const ctx = canvas.getContext("2d");
    // 余白も含めて白で塗る
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (!qr.modules[y][x]) continue;
        ctx.fillRect((x + QUIET) * cell, (y + QUIET) * cell, cell, cell);
      }
    }
  }

  return {
    openSend: openSend,
    close: closeModal,
    // 検証から使う
    drawMatrix: drawMatrix,
  };
})();
