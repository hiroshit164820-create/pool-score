/**
 * app.js — 起動・画面遷移
 */
(function () {
  /**
   * 追加ぶんのスタイルを読み込む。
   *
   * index.html に <link> を足すのが本来だが、同じ時間に別のセッションが
   * index.html と style.css を編集していたため、書き込みの衝突で
   * どちらかの変更が消えるのを避けてここから足している。
   * 手が空いたら index.html の <link> に移してよい。
   */
  (function loadExtraCss() {
    if (document.querySelector('link[data-v2css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "css/v2.css";
    link.setAttribute("data-v2css", "1");
    document.head.appendChild(link);
  })();

  function boot() {
    SETUP.init();
    UI.bindBackButton();
    // 起動時はまだ showScreen を通っていないので、タブの状態をここで整える
    UI.updateTabBar(UI.currentScreen() || "screenSetup");

    UI.$("toHistoryBtn").addEventListener("click", function () {
      HISTORY.open();
    });
    UI.$("toPlayersBtn2").addEventListener("click", function () {
      PLAYERS.open();
    });
    UI.$("toPlayersBtn").addEventListener("click", function () {
      PLAYERS.open();
    });

    renderResume();
  }

  /**
   * 中断中の試合を設定画面のいちばん上に出す。
   *
   * 記録は操作のたびに保存されているので、アプリを閉じても続きから再開できる。
   * ただし履歴画面まで見に行かないと気づけなかったため、
   * 起動して最初に見る場所に出す。
   */
  function renderResume() {
    const card = UI.$("resumeCard");
    if (!card) return;

    const ongoing = STORE.findOngoing();
    if (!ongoing) {
      card.hidden = true;
      return;
    }

    const g = GAMES[ongoing.gameId];
    const st = reduceMatch(ongoing);
    const unit = ongoing.goal.type === "racks" ? "ラック" : "点";
    const cur = ongoing.goal.type === "racks" ? st.racks : st.score;

    const info = UI.$("resumeInfo");
    UI.clear(info);
    info.appendChild(
      UI.el("div", { class: "rc-game", text: g ? g.label : ongoing.gameId })
    );
    info.appendChild(
      UI.el("div", { class: "rc-score" }, [
        UI.el("span", { class: "rc-nm", text: ongoing.sides[0].name }),
        UI.el("b", { text: String(cur.A) }),
        UI.el("span", { class: "rc-vs", text: "対" }),
        UI.el("b", { text: String(cur.B) }),
        UI.el("span", { class: "rc-nm", text: ongoing.sides[1].name }),
      ])
    );
    info.appendChild(
      UI.el("div", {
        class: "hint",
        text: "ラック " + Math.max(1, st.rackNo) + "／" +
          ongoing.goal.targets.A + " 対 " + ongoing.goal.targets.B + unit +
          "・" + formatWhen(ongoing.updatedAt || ongoing.createdAt),
      })
    );

    card.hidden = false;

    UI.$("resumeBtn").onclick = UI.guard(function () {
      const m = STORE.loadMatch(ongoing.id);
      if (!m) {
        UI.toast("この試合を読み込めませんでした。", "danger");
        return;
      }
      MATCH.open(m);
    });

    UI.$("resumeDiscardBtn").onclick = UI.guard(function () {
      if (!window.confirm([
        "この試合をここで終了して保存します。",
        "",
        ongoing.sides[0].name + " " + cur.A + unit + " 対 " +
          ongoing.sides[1].name + " " + cur.B + unit,
        "",
        "よろしいですか？",
      ].join(String.fromCharCode(10)))) return;

      const m = STORE.loadMatch(ongoing.id);
      if (!m) return;
      const s2 = reduceMatch(m);
      appendEvent(m, {
        t: "MATCH_END",
        side: null,
        d: { winner: s2.winner, by: s2.winner ? "goal" : "manual", hasUnresolvedError: false },
      });
      m.result = buildResult(m, new Date());
      STORE.saveMatch(m);
      renderResume();
      UI.toast("試合を保存しました。");
    });
  }

  /** 「◯分前」のような表示。細かい日時より、いつのものかが分かればよい */
  function formatWhen(iso) {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    const min = Math.floor((Date.now() - then) / 60000);
    if (min < 1) return "たった今";
    if (min < 60) return min + "分前";
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + "時間前";
    return Math.floor(hour / 24) + "日前";
  }

  // 試合を終えたあと設定画面に戻ったときにも出し直す
  window.addEventListener("pool-score:refresh-resume", renderResume);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
