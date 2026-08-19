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
   * 「自分」として扱うプレーヤー。
   *
   * 明示的な設定は持たせていないので、いちばん試合数の多い人を自分とみなす。
   * 1人で使う道具なので、これで実用上は足りる。
   */
  function mainPlayer() {
    const players = STORE.listPlayers();
    if (!players.length) return null;
    let best = null;
    let bestN = -1;
    players.forEach(function (p) {
      const st = STORE.playerStats(p.id);
      if (st.matches > bestN) {
        bestN = st.matches;
        best = { player: p, stats: st };
      }
    });
    return best && best.stats.matches > 0 ? best : null;
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
    const done = matches.filter(function (m) { return m.finished; }).slice(0, 3);
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

    // ---- 何も無いとき ----
    if (!ongoing.length && !me && !done.length) {
      body.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ記録がありません。" }),
          UI.el("p", { text: "下の「種目」から試合を始めてください。" }),
        ])
      );
    }

    // 新しい試合はどの状態でも始められるようにする
    body.appendChild(
      UI.el("button", {
        class: "primary home-new",
        text: "新しい試合を始める",
        onclick: function () { UI.showScreen("screenSetup"); },
      })
    );

    const sub = $("homeSub");
    if (sub) {
      sub.textContent = me
        ? me.player.name + "　" + me.stats.matches + "試合"
        : (matches.length ? matches.length + "件の記録" : "");
    }
  }

  function stat(label, value) {
    return UI.el("div", { class: "home-stat" }, [
      UI.el("div", { class: "hs-val", text: value }),
      UI.el("div", { class: "hs-label", text: label }),
    ]);
  }

  return { open: open, render: render };
})();
