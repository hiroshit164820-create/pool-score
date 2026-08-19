/**
 * sw.js — オフライン対応（Service Worker）
 *
 * ビリヤード場は電波が弱いことがあるため、一度開いたら通信なしでも動くようにする。
 * 記録はもともと端末内(localStorage)に保存されるので、オフラインでも試合は記録できる。
 *
 * 更新の考え方:
 *   CACHE_VERSION を上げると古いキャッシュを捨てて入れ替える。
 *   ファイルを変更したときは必ずこの数字を上げること。
 */
const CACHE_VERSION = "v10";
const CACHE_NAME = "pool-score-" + CACHE_VERSION;

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./data/balls_data.js",
  "./data/rules_data.js",
  "./data/scoring_data.js",
  "./data/games_data.js",
  "./data/handicap_data.js",
  "./js/engine.js",
  "./js/shotclock.js",
  "./js/chessclock.js",
  "./js/store.js",
  "./js/ui_setup.js",
  "./js/ui_match.js",
  "./js/ui_history.js",
  "./js/ui_sheet.js",
  "./js/ui_players.js",
  "./js/app.js",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // 1つでも失敗すると全体が失敗するため、個別に入れて失敗を無視する
      return Promise.all(
        ASSETS.map(function (url) {
          return cache.add(url).catch(function () {
            /* 取得できないものは諦める（オンライン時に取りに行く） */
          });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  // 同一オリジンのみ扱う（Googleフォント等は素通し）
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ネットワーク優先。取れたらキャッシュを更新し、駄目ならキャッシュを返す。
  // （更新が反映されないまま古い画面が出続けるのを避けるため）
  e.respondWith(
    fetch(req)
      .then(function (res) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, copy);
        });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
  );
});
