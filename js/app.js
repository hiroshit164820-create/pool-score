/**
 * app.js — 起動・画面遷移
 */
(function () {
  function boot() {
    SETUP.init();

    UI.$("toHistoryBtn").addEventListener("click", function () {
      HISTORY.open();
    });
    UI.$("toPlayersBtn2").addEventListener("click", function () {
      PLAYERS.open();
    });
    UI.$("toPlayersBtn").addEventListener("click", function () {
      PLAYERS.open();
    });

    // 進行中の試合があれば、続きから再開できるようにする
    const ongoing = STORE.findOngoing();
    if (ongoing) {
      HISTORY.open();
      UI.toast("進行中の試合があります。「続きを記録」から再開できます。");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
