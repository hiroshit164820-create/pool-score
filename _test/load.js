/**
 * load.js — 検証用ローダ
 * ブラウザと同じ「グローバルに順番に読み込む」挙動を Node で再現する。
 * アプリ本体はこのファイルに依存しない（検証専用）。
 *
 * 注意: トップレベル const は sandbox オブジェクトには生えないため、
 * 全ファイルを1つのスクリプトとして連結評価し、末尾で必要な識別子を返す。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const FILES = [
  "data/rules_data.js",
  "data/scoring_data.js",
  "data/games_data.js",
  "data/handicap_data.js",
  "js/engine.js",
];

// 読み込み後に取り出したいトップレベル識別子
const EXPORTS = [
  "BASE_RULES", "SCORING", "GAMES", "resolveGame",
  "JPA_SL_9BALL", "JPA_SL_8BALL_CHART", "JPA_TEAM_POINT_BANDS",
  "JPA_WINNER_POINTS", "JPA_TEAM_RULE", "BALL_HANDICAP_PRESETS",
  "jpaTeamPoints", "jpaGoal9Ball", "jpaGoal8Ball",
  "reduceMatch", "applyEvent", "checkWin", "makeScorer",
  "createMatch", "appendEvent", "voidEvent", "undoLast", "nextBreakSide",
  "buildResult", "other", "makeMatchId",
  "buildBowlardScore", "bowlardRemainingPins", "effectiveScoreKind",
];

function loadApp(extraFiles) {
  const files = FILES.concat(extraFiles || []);
  const parts = [];
  for (const rel of files) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    parts.push("/* === " + rel + " === */\n" + fs.readFileSync(full, "utf8"));
  }
  const tail =
    "\n;({" +
    EXPORTS.map((n) => n + ": typeof " + n + ' !== "undefined" ? ' + n + " : undefined").join(", ") +
    "});";

  const sandbox = { console, Date, Math, JSON };
  vm.createContext(sandbox);
  return vm.runInContext(parts.join("\n") + tail, sandbox, { filename: "app-bundle.js" });
}

module.exports = { loadApp, ROOT };
