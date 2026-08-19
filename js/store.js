/**
 * store.js — localStorage 永続化
 *
 * Phase2でサーバー移行できるよう、キー名は将来のテーブル名に合わせる。
 * 一覧表示で全試合をパースしないよう、索引と本体を分けて保存する。
 */

const STORE = (function () {
  const KEY_INDEX = "pool_matches_index"; // 軽量メタのみ
  const KEY_MATCH = "pool_match_"; // + id
  const KEY_PLAYERS = "pool_players";
  const KEY_SETTINGS = "pool_settings";

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("読み込みに失敗しました: " + key, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // 容量超過が主な原因。呼び出し側でユーザーに知らせる
      console.error("保存に失敗しました: " + key, e);
      return false;
    }
  }

  /** 試合の索引（新しい順） */
  function listMatches() {
    const idx = readJSON(KEY_INDEX, []);
    return idx.filter(function (m) {
      return !m.deletedAt;
    });
  }

  function indexEntry(match) {
    const g = GAMES[match.gameId];
    return {
      id: match.id,
      gameId: match.gameId,
      gameLabel: g ? g.label : match.gameId,
      names: { A: match.sides[0].name, B: match.sides[1].name },
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
      finished: !!match.result,
      winner: match.result ? match.result.winner : null,
      scores: match.result ? match.result.scores : null,
      racks: match.result ? match.result.racks : null,
      deletedAt: match.deletedAt || null,
    };
  }

  function saveMatch(match) {
    const okBody = writeJSON(KEY_MATCH + match.id, match);
    if (!okBody) return false;

    const idx = readJSON(KEY_INDEX, []);
    const entry = indexEntry(match);
    const at = idx.findIndex(function (e) {
      return e.id === match.id;
    });
    if (at >= 0) idx[at] = entry;
    else idx.unshift(entry);
    return writeJSON(KEY_INDEX, idx);
  }

  function loadMatch(id) {
    return readJSON(KEY_MATCH + id, null);
  }

  /** 論理削除（Phase2の同期のため物理削除しない） */
  function deleteMatch(id) {
    const m = loadMatch(id);
    if (m) {
      m.deletedAt = new Date().toISOString();
      writeJSON(KEY_MATCH + id, m);
    }
    const idx = readJSON(KEY_INDEX, []);
    const at = idx.findIndex(function (e) {
      return e.id === id;
    });
    if (at >= 0) {
      idx[at].deletedAt = new Date().toISOString();
      writeJSON(KEY_INDEX, idx);
    }
    return true;
  }

  /** 進行中の試合（未確定のもの）を1件返す */
  function findOngoing() {
    const idx = listMatches();
    for (let i = 0; i < idx.length; i++) {
      if (!idx[i].finished) {
        const m = loadMatch(idx[i].id);
        if (m && !m.result) return m;
      }
    }
    return null;
  }

  /* ---- プレーヤー ---- */
  function listPlayers() {
    return readJSON(KEY_PLAYERS, []);
  }

  function upsertPlayer(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const players = listPlayers();
    const found = players.find(function (p) {
      return p.name === trimmed;
    });
    if (found) return found;
    const p = { id: "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: trimmed };
    players.push(p);
    writeJSON(KEY_PLAYERS, players);
    return p;
  }

  /* ---- 設定 ---- */
  function getSettings() {
    return readJSON(KEY_SETTINGS, {});
  }

  function saveSettings(s) {
    return writeJSON(KEY_SETTINGS, s);
  }

  /* ---- エクスポート / インポート ---- */
  function exportAll() {
    const idx = readJSON(KEY_INDEX, []);
    const matches = idx
      .map(function (e) {
        return loadMatch(e.id);
      })
      .filter(Boolean);
    return {
      format: "pool-score-export",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      players: listPlayers(),
      matches: matches,
    };
  }

  function importAll(data) {
    if (!data || data.format !== "pool-score-export") {
      throw new Error("このファイルはビリヤードスコアのバックアップではありません。");
    }
    const matches = data.matches || [];
    let added = 0;
    matches.forEach(function (m) {
      if (!m || !m.id) return;
      if (loadMatch(m.id)) return; // 既存はスキップ（IDが衝突しない設計）
      if (saveMatch(m)) added++;
    });
    if (data.players) {
      const cur = listPlayers();
      data.players.forEach(function (p) {
        if (!cur.find(function (c) { return c.name === p.name; })) cur.push(p);
      });
      writeJSON(KEY_PLAYERS, cur);
    }
    return { added: added, total: matches.length };
  }

  /** 概算の使用容量（KB） */
  function usageKB() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("pool_") === 0) {
        total += (localStorage.getItem(k) || "").length;
      }
    }
    return Math.round(total / 1024);
  }

  return {
    listMatches: listMatches,
    saveMatch: saveMatch,
    loadMatch: loadMatch,
    deleteMatch: deleteMatch,
    findOngoing: findOngoing,
    listPlayers: listPlayers,
    upsertPlayer: upsertPlayer,
    getSettings: getSettings,
    saveSettings: saveSettings,
    exportAll: exportAll,
    importAll: importAll,
    usageKB: usageKB,
  };
})();
