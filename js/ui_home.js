/**
 * ui_home.js — ホーム（個人ダッシュボード）
 *
 * 台の脇で開いたときに、まず知りたいことだけを出す:
 *   1. 中断している試合があるか（続きから記録できる）
 *   2. 自分の直近の成績（勝率・試合数）
 *   3. 直近の試合の結果
 *
 * 集計そのものは store.js の playerStats に任せ、
 * ここは「何を出すか」だけを決める。
 */

const HOME = (function () {
  const $ = UI.$;
  let bound = false;

  function bindOnce() {
    if (bound) return;
    bound = true;
  }

  function open() {
    bindOnce();
    render();
    UI.showScreen("screenHome");
  }

  /**
   * 「自分」として登録されているプレーヤー。
   *
   * 以前は試合数がいちばん多い人を自分と推測していたが、
   * 本人の指示（2026-08-20）で登録時に自分を明示できるようにしたため、
   * 推測はやめて登録された人だけを見る。
   * 登録していなければ null を返し、画面では登録を促す。
   */
  function mainPlayer() {
    const p = STORE.getSelf();
    if (!p) return null;
    return { player: p, stats: STORE.playerStats(p.id) };
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      const p = function (n) { return String(n).padStart(2, "0"); };
      return (d.getMonth() + 1) + "/" + d.getDate() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) {
      return "";
    }
  }

  function render() {
    const body = $("homeBody");
    if (!body) return;
    UI.clear(body);

    const matches = STORE.listMatches();
    const me = mainPlayer();

    // ---- 中断している試合 ----
    // いちばん上に置く。記録の続きが最優先の用事なので
    const ongoing = matches.filter(function (m) { return !m.finished; });
    if (ongoing.length) {
      const m = ongoing[0];
      const card = UI.el("div", { class: "home-card resume" }, [
        // × で閉じる。記録は保存しない（本人の指示 2026-08-21）
        UI.el("button", {
          class: "hc-close",
          type: "button",
          text: "×",
          "aria-label": "この中断中の試合を閉じる",
          onclick: UI.guard(function () { discardOngoing(m.id); }),
        }),
        UI.el("div", { class: "hc-title", text: "中断している試合があります" }),
        UI.el("div", { class: "hc-main", text: m.names.A + " 対 " + m.names.B }),
        UI.el("div", { class: "hc-sub", text: m.gameLabel + "　" + fmtDate(m.createdAt) }),
        UI.el("button", {
          class: "primary",
          text: "続きから記録する",
          onclick: function () {
            const full = STORE.loadMatch(m.id);
            if (full) MATCH.open(full);
          },
        }),
      ]);
      body.appendChild(card);
    }

    // ---- 自分の成績 ----
    if (me) {
      const st = me.stats;
      const rate = st.matches ? Math.round((st.wins / st.matches) * 100) : 0;
      const card = UI.el("div", { class: "home-card" }, [
        UI.el("div", { class: "hc-title", text: me.player.name + " の成績" }),
        UI.el("div", { class: "home-stats" }, [
          stat("勝率", rate + "%"),
          stat("勝ち", String(st.wins)),
          stat("負け", String(st.losses)),
          stat("試合", String(st.matches)),
        ]),
        UI.el("button", {
          class: "ghost",
          text: "くわしい成績を見る",
          onclick: function () { PLAYERS.openStats(me.player); },
        }),
      ]);
      body.appendChild(card);
    }

    // ---- 直近の試合 ----
    // 直近の試合は5件まで（本人の指示 2026-08-21・E。以前は3件）
    const done = matches.filter(function (m) { return m.finished; }).slice(0, 5);
    if (done.length) {
      const card = UI.el("div", { class: "home-card" }, [
        UI.el("div", { class: "hc-title", text: "直近の試合" }),
      ]);
      done.forEach(function (m) {
        const sc = m.scores
          ? (m.racks && (m.racks.A || m.racks.B) && !m.scores.A && !m.scores.B
              ? m.racks.A + " - " + m.racks.B
              : m.scores.A + " - " + m.scores.B)
          : "—";
        card.appendChild(
          UI.el("div", { class: "home-row" }, [
            UI.el("span", { class: "hr-names", text: m.names.A + " 対 " + m.names.B }),
            UI.el("span", { class: "hr-score", text: sc }),
            UI.el("span", { class: "hr-date", text: fmtDate(m.createdAt) }),
          ])
        );
      });
      card.appendChild(
        UI.el("button", {
          class: "ghost",
          text: "履歴をぜんぶ見る",
          onclick: function () { HISTORY.open(); },
        })
      );
      body.appendChild(card);
    }

    // ---- 自分が未登録のとき ----
    // 成績はこの登録が無いと出せないので、ここから登録できるようにする
    if (!me) {
      const card = UI.el("div", { class: "home-card" }, [
        UI.el("div", { class: "hc-title", text: "自分を登録すると成績が出ます" }),
        UI.el("div", { class: "hc-sub", text: "いつも記録する自分の名前を登録してください。" }),
        UI.el("button", {
          class: "primary",
          text: "自分を登録する",
          onclick: function () { PLAYERS.openSelfRegister(); },
        }),
      ]);
      body.appendChild(card);
    }

    // ---- 何も無いとき ----
    if (!ongoing.length && !me && !done.length) {
      body.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ記録がありません。" }),
          UI.el("p", { text: "下の「種目」から試合を始めてください。" }),
        ])
      );
    }

    // 「種目ごとの成績を見る」ボタンは本人の指示（2026-08-21・D）で削除した。
    // 種目ごとの数字は、成績ページの「種目別でさらに詳しく」で見る

    const sub = $("homeSub");
    if (sub) {
      sub.textContent = me
        ? me.player.name + "　" + me.stats.matches + "試合"
        : (matches.length ? matches.length + "件の記録" : "");
    }
  }

  /**
   * 中断中の試合を、保存せずに捨てる。
   *
   * 本人の指示（2026-08-21）で「×は記録を保存しない」ため、
   * 履歴には残さずそのまま消す。
   */
  function discardOngoing(id) {
    STORE.deleteMatch(id);
    render();
    window.dispatchEvent(new Event("pool-score:refresh-resume"));
    UI.toast("中断中の試合を閉じました。記録は残していません。");
  }

  function stat(label, value) {
    return UI.el("div", { class: "home-stat" }, [
      UI.el("div", { class: "hs-val", text: value }),
      UI.el("div", { class: "hs-label", text: label }),
    ]);
  }

  return { open: open, render: render };
})();
