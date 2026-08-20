/**
 * ui_gamestats.js — 種目ごとの成績
 *
 * 「どの種目が得意か」を見る画面。プレーヤー別の成績（ui_players.js）とは別で、
 * 種目（フォーマット）を軸に並べる。
 *
 * 出す数字は3つ。
 *   平均イニング数     … 上り（試合終了）までに何イニングかかったか
 *   マスワリ率         … マスワリ ÷ ブレイク
 *   1イニング平均得点  … JPA 9ボールのみ（得点制なので意味を持つ）
 *
 * 実施したことのない種目は出さない（0が並ぶと読み取りの邪魔になるため）。
 */

const GAMESTATS = (function () {
  const $ = UI.$;
  let bound = false;
  let lastStats = null;
  let lastWho = "";

  function bindOnce() {
    if (bound) return;
    bound = true;
    $("backFromGameStatsBtn").addEventListener("click", function () {
      // 入口はホームから成績ページに移した（本人の指示 2026-08-21）ので、
      // 戻り先も成績ページにする。押した場所へ戻らないと迷子になる
      if (typeof PLAYERS !== "undefined" && PLAYERS.openStats) PLAYERS.openStats(null);
      else UI.showScreen("screenHome");
    });
    $("csvGameStatsBtn").addEventListener("click", UI.guard(function () {
      if (!lastStats) return;
      CSVOUT.download(CSVOUT.gameRows(lastStats, lastWho), "種目ごとの成績");
    }));
  }

  function open() {
    bindOnce();
    render();
    UI.showScreen("screenGameStats");
  }

  function pct(v) {
    return v === null || v === undefined ? "—" : (Math.round(v * 1000) / 10) + "%";
  }
  function num1(v) {
    return v === null || v === undefined ? "—" : String(Math.round(v * 10) / 10);
  }

  function render() {
    const body = $("gameStatsBody");
    if (!body) return;
    UI.clear(body);

    // 「自分」が登録されていればその人の成績、いなければ全試合をまとめて数える
    const self = STORE.getSelf ? STORE.getSelf() : null;
    lastWho = self ? self.name : "全体";
    const stats = STORE.gameStats(self ? self.id : null);
    lastStats = stats;

    const sub = $("gameStatsSub");
    if (sub) {
      sub.textContent = self
        ? self.name + " の成績"
        : "全体の成績（「自分」を登録すると自分だけの成績になります）";
    }

    if (!stats.games.length) {
      body.appendChild(
        UI.el("div", { class: "empty" }, [
          UI.el("p", { text: "まだ確定した試合がありません。" }),
          UI.el("p", { text: "試合を終えて保存すると、ここに種目ごとの成績が出ます。" }),
        ])
      );
      return;
    }

    stats.games.forEach(function (g) {
      const card = UI.el("div", { class: "match-card" });
      card.appendChild(
        UI.el("div", { class: "mc-top" }, [
          UI.el("span", { text: g.label }),
          UI.el("span", { text: g.matches + "試合" }),
        ])
      );

      const rows = [
        ["勝敗", g.wins + "勝 " + g.losses + "敗（" + pct(g.winRate) + "）"],
        ["上りまでの平均イニング数", num1(g.avgInnings)],
        ["マスワリ率", pct(g.masuwariRate) + "（" + g.masuwari + " ／ ブレイク " + g.breaks + "）"],
      ];
      // JPA 9ボールだけ、1イニングあたり何点取れているかを足す
      if (g.isJpa9) {
        rows.push(["1イニング当たりの平均得点", num1(g.pointsPerInning)]);
      }
      rows.push(["セーフティ", String(g.safety)]);

      const box = UI.el("div", { class: "gs-rows" });
      rows.forEach(function (pair) {
        box.appendChild(
          UI.el("div", { class: "ss-row" }, [
            UI.el("span", { class: "ss-key", text: pair[0] + "：" }),
            UI.el("span", { class: "ss-val", text: pair[1] }),
          ])
        );
      });
      card.appendChild(box);
      body.appendChild(card);
    });

    // ダブルスはパートナーによって成績が変わるので、人ごとにも出す
    if (stats.partners.length) {
      body.appendChild(UI.el("div", { class: "section-title", text: "パートナーごとの成績（ダブルス）" }));
      stats.partners.forEach(function (p) {
        const card = UI.el("div", { class: "match-card" });
        card.appendChild(
          UI.el("div", { class: "mc-top" }, [
            UI.el("span", { text: p.name }),
            UI.el("span", { text: p.gameLabels.join("・") }),
          ])
        );
        card.appendChild(
          UI.el("div", { class: "ss-row" }, [
            UI.el("span", { class: "ss-key", text: "組んだ成績：" }),
            UI.el("span", {
              class: "ss-val",
              text: p.matches + "試合 " + p.wins + "勝（" + pct(p.winRate) + "）",
            }),
          ])
        );
        body.appendChild(card);
      });
    }
  }

  return { open: open, render: render };
})();
