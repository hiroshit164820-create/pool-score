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
  const KEY_LAYOUTS = "pool_layouts"; // 練習配置

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
      note: match.note || "",
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

  /**
   * 試合のメモを書き換える。
   *
   * 本体と一覧（インデックス）の両方を更新する。
   * 一覧にも持たせておくと、履歴を開くたびに全試合を読み込まずに済む。
   */
  function setMatchNote(id, note) {
    const text = String(note == null ? "" : note);
    const m = loadMatch(id);
    if (!m) return false;
    m.note = text;
    m.updatedAt = new Date().toISOString();
    if (!writeJSON(KEY_MATCH + id, m)) return false;

    const idx = readJSON(KEY_INDEX, []);
    const at = idx.findIndex(function (e) { return e.id === id; });
    if (at >= 0) {
      idx[at].note = text;
      idx[at].updatedAt = m.updatedAt;
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

  /* ---- 練習配置 ----
   * 台の上の球の並びを保存して、あとで同じ配置を作り直せるようにする。
   * ドリル練習で「前回と同じ配置からやる」ために使う。
   * 試合の記録とは無関係なので、別のキーで持つ。
   */

  function listLayouts() {
    const all = readJSON(KEY_LAYOUTS, []);
    return all
      .filter(function (l) { return !l.deletedAt; })
      .sort(function (a, b) {
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      });
  }

  function saveLayout(layout) {
    const all = readJSON(KEY_LAYOUTS, []);
    const now = new Date().toISOString();
    const item = {
      id: layout.id || ("L_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      name: String(layout.name || "名前なし"),
      // balls: [{ n: 球番号(0=手玉), x: 0〜1, y: 0〜1 }]
      // 位置は台の大きさに対する割合で持つ。画面の大きさが変わっても再現できる
      balls: (layout.balls || []).map(function (b) {
        return { n: b.n, x: Math.max(0, Math.min(1, b.x)), y: Math.max(0, Math.min(1, b.y)) };
      }),
      note: String(layout.note || ""),
      createdAt: layout.createdAt || now,
      updatedAt: now,
    };
    const at = all.findIndex(function (l) { return l.id === item.id; });
    if (at >= 0) all[at] = item;
    else all.unshift(item);
    return writeJSON(KEY_LAYOUTS, all) ? item : null;
  }

  function loadLayout(id) {
    const all = readJSON(KEY_LAYOUTS, []);
    return all.find(function (l) { return l.id === id && !l.deletedAt; }) || null;
  }

  function deleteLayout(id) {
    const all = readJSON(KEY_LAYOUTS, []);
    const at = all.findIndex(function (l) { return l.id === id; });
    if (at < 0) return false;
    all[at].deletedAt = new Date().toISOString();
    return writeJSON(KEY_LAYOUTS, all);
  }

  /* ---- プレーヤー ---- */
  function listPlayers() {
    return readJSON(KEY_PLAYERS, []);
  }

  /**
   * プレーヤーを登録する（同名があればそれを返す）。
   * skill は JPA のスキルレベル。{ nine: 1..9, eight: 2..7 } の形で持つ。
   * 種目ごとに別の表を使うため、9ボールと8ボールで別々に保持する。
   */
  function upsertPlayer(name, skill) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const players = listPlayers();
    const found = players.find(function (p) {
      return p.name === trimmed;
    });
    if (found) {
      // 既存の人にスキルレベルだけ後から付けられるようにする。
      // 渡されなかった種目の値は消さない
      if (skill) {
        found.skill = Object.assign({}, found.skill, pickSkill(skill));
        writeJSON(KEY_PLAYERS, players);
      }
      return found;
    }
    const p = {
      id: "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: trimmed,
      skill: pickSkill(skill),
    };
    players.push(p);
    writeJSON(KEY_PLAYERS, players);
    return p;
  }

  /** スキルレベルを範囲内の整数だけに絞る（範囲外・未指定は持たせない） */
  function pickSkill(skill) {
    const out = {};
    if (!skill) return out;
    const nine = parseInt(skill.nine, 10);
    const eight = parseInt(skill.eight, 10);
    if (!isNaN(nine) && nine >= 1 && nine <= 9) out.nine = nine;
    if (!isNaN(eight) && eight >= 2 && eight <= 7) out.eight = eight;
    return out;
  }

  /**
   * プレーヤーのスキルレベルを更新する。
   * 値に null を渡した種目は「未設定」に戻す（キーごと消す）。
   * 渡さなかった種目の値はそのまま残す。
   */
  function setPlayerSkill(id, skill) {
    const players = listPlayers();
    const p = players.find(function (x) { return x.id === id; });
    if (!p) return false;
    const next = Object.assign({}, p.skill);
    ["nine", "eight"].forEach(function (k) {
      if (!skill || !(k in skill)) return;
      if (skill[k] === null) delete next[k];
      else {
        const only = pickSkill_one(k, skill[k]);
        if (only !== null) next[k] = only;
      }
    });
    p.skill = next;
    return writeJSON(KEY_PLAYERS, players);
  }

  /** 1種目ぶんのスキルレベルを検証する。範囲外は null */
  function pickSkill_one(kind, value) {
    const v = parseInt(value, 10);
    if (isNaN(v)) return null;
    if (kind === "nine") return v >= 1 && v <= 9 ? v : null;
    if (kind === "eight") return v >= 2 && v <= 7 ? v : null;
    return null;
  }

  /** プレーヤーをIDで引く */
  function findPlayerById(id) {
    return listPlayers().find(function (p) { return p.id === id; }) || null;
  }

  /**
   * この人を試合で使ったことを記録する（一覧の「最近」の並び替えに使う）。
   * 試合を開始したときに呼ぶ。
   */
  function touchPlayer(id, at) {
    const players = listPlayers();
    const p = players.find(function (x) { return x.id === id; });
    if (!p) return false;
    p.lastUsedAt = (at || new Date()).toISOString();
    p.useCount = (p.useCount || 0) + 1;
    return writeJSON(KEY_PLAYERS, players);
  }

  /** 登録済みプレーヤーを名前で引く */
  function findPlayerByName(name) {
    const t = (name || "").trim();
    if (!t) return null;
    return listPlayers().find(function (p) { return p.name === t; }) || null;
  }

  /** プレーヤーを削除する（過去の試合記録は消さない） */
  function deletePlayer(id) {
    const players = listPlayers().filter(function (p) { return p.id !== id; });
    // 自分を消したら設定側の指定も外す（消えた人を指したままにしない）
    const s = getSettings() || {};
    if (s.selfPlayerId === id) {
      delete s.selfPlayerId;
      saveSettings(s);
    }
    return writeJSON(KEY_PLAYERS, players);
  }

  /** プレーヤー名を変更する */
  function renamePlayer(id, newName) {
    const t = (newName || "").trim();
    if (!t) return false;
    const players = listPlayers();
    const p = players.find(function (x) { return x.id === id; });
    if (!p) return false;
    p.name = t;
    return writeJSON(KEY_PLAYERS, players);
  }

  /**
   * プレーヤー別のスタッツを集計する。
   *
   * 集計対象は「確定した試合」かつ「playerIds にそのプレーヤーが入っているもの」。
   * 名前だけ入力された過去の試合は含めない（本人の指示による）。
   */
  function playerStats(playerId) {
    const out = {
      matches: 0, wins: 0, losses: 0,
      racks: 0, rackWins: 0,
      masuwari: 0, breakAce: 0, safety: 0, fouls: 0,
      breaks: 0, breakWins: 0,
      innings: 0, score: 0,
      shotClockMatches: 0, shotClockShots: 0, shotClockTotalSec: 0,
      shotClockViolations: 0, shotClockExtensions: 0,
      byGame: {},
      opponents: {},
    };

    listMatches().forEach(function (idx) {
      if (!idx.finished) return;
      const m = loadMatch(idx.id);
      if (!m || !m.result) return;

      // どちら側のプレーヤーか
      let side = null;
      if (m.sides[0].playerIds && m.sides[0].playerIds.indexOf(playerId) >= 0) side = "A";
      else if (m.sides[1].playerIds && m.sides[1].playerIds.indexOf(playerId) >= 0) side = "B";
      if (!side) return;

      const opp = side === "A" ? "B" : "A";
      const r = m.result;
      const st = r.perSide && r.perSide[side] ? r.perSide[side] : {};

      out.matches++;
      if (r.winner === side) out.wins++;
      else if (r.winner) out.losses++;

      out.racks += (r.racks ? r.racks.A + r.racks.B : 0);
      out.rackWins += (r.racks ? r.racks[side] : 0);
      out.score += (r.scores ? r.scores[side] : 0);
      out.innings += r.innings || 0;

      ["masuwari", "breakAce", "safety", "fouls", "breaks", "breakWins",
       "shotClockViolations", "shotClockExtensions"].forEach(function (k) {
        out[k] += st[k] || 0;
      });

      // ショットクロックの平均タイム（使った試合のみ）
      if (st.shotClockShots) {
        out.shotClockMatches++;
        out.shotClockShots += st.shotClockShots;
        out.shotClockTotalSec += st.shotClockTotalSec || 0;
      }

      // 種目別
      const g = out.byGame[m.gameId] || { label: idx.gameLabel, matches: 0, wins: 0 };
      g.matches++;
      if (r.winner === side) g.wins++;
      out.byGame[m.gameId] = g;

      // 対戦相手別
      const oppName = m.sides[opp === "A" ? 0 : 1].name;
      const o = out.opponents[oppName] || { matches: 0, wins: 0 };
      o.matches++;
      if (r.winner === side) o.wins++;
      out.opponents[oppName] = o;
    });

    out.winRate = out.matches ? out.wins / out.matches : null;
    out.rackWinRate = out.racks ? out.rackWins / out.racks : null;
    out.masuwariRate = out.breaks ? out.masuwari / out.breaks : null;
    out.avgShotSec = out.shotClockShots ? out.shotClockTotalSec / out.shotClockShots : null;
    return out;
  }

  /* ---- 「自分」 ---- */
  /*
   * 自分は設定に id を1つ持つ形で覚える。
   * 各プレーヤーに旗を立てる形にすると、旗が2つ立った状態を
   * 作れてしまうため、持てる場所を1か所に絞っている。
   */

  /** 自分として登録されている人。未登録・登録した人が消えていれば null */
  function getSelf() {
    const id = (getSettings() || {}).selfPlayerId;
    if (!id) return null;
    return findPlayerById(id) || null;
  }

  /** 自分の id。登録されていなければ null */
  function getSelfId() {
    const p = getSelf();
    return p ? p.id : null;
  }

  /**
   * 自分を決める。null を渡すと解除する。
   * 自分は1人だけなので、設定を上書きするだけでよい。
   */
  function setSelf(id) {
    const s = getSettings() || {};
    if (!id) delete s.selfPlayerId;
    else s.selfPlayerId = id;
    saveSettings(s);
    return true;
  }

  /** その人が自分か */
  function isSelf(id) {
    return !!id && getSelfId() === id;
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
    setMatchNote: setMatchNote,
    listLayouts: listLayouts,
    saveLayout: saveLayout,
    loadLayout: loadLayout,
    deleteLayout: deleteLayout,
    findOngoing: findOngoing,
    listPlayers: listPlayers,
    upsertPlayer: upsertPlayer,
    findPlayerByName: findPlayerByName,
    findPlayerById: findPlayerById,
    touchPlayer: touchPlayer,
    setPlayerSkill: setPlayerSkill,
    deletePlayer: deletePlayer,
    renamePlayer: renamePlayer,
    playerStats: playerStats,
    getSelf: getSelf,
    getSelfId: getSelfId,
    setSelf: setSelf,
    isSelf: isSelf,
    getSettings: getSettings,
    saveSettings: saveSettings,
    exportAll: exportAll,
    importAll: importAll,
    usageKB: usageKB,
  };
})();
