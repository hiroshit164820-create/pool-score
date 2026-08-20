/**
 * balls_data.js — ボールセットごとの配色
 *
 * ローテーションの盤面で球番号を色分けするために使う。競技規程ではない。
 *
 * **16進カラーコードはどのメーカーも公開していない。**
 * ここの値は公式・販売店の商品画像を目視して決めた近似値で、実物とは完全に一致しない。
 * 目的は「台の脇で番号を見分けやすくすること」なので、実用上はこれで足りる。
 *
 * 出典と各セットの配色は 04_種目ルール仕様.md 8.6節を参照（2026-08-20確認）。
 */

/** ストライプ球かどうか（9番以上） */
function isStripeBall(n) {
  return n >= 9;
}

const BALL_SETS = {
  // 通常のプール球（多くの店にある標準配色）
  standard: {
    label: "標準（パラジウム）",
    note: "一般的なプール球の配色です。アラミス パラジウムもこの配色です。",
    numberStyle: "circle", // 番号を白い丸の中に置く（一般的な意匠）
    stripeBase: "#f4efe2", // ストライプ球の地色
    stripeOnBase: false, // false = 地が白で帯が色（通常の向き）
    colors: {
      1: "#f2b705", 2: "#1a4fa0", 3: "#d3202a", 4: "#5b2d8e",
      5: "#e8620c", 6: "#1e7a3c", 7: "#7b2d26", 8: "#141414",
    },
  },

  // Dynaspheres Platinum（プラチナム）
  // 出典: キューショップジャパン商品画像（JAPA公認・的球15＋手球2）
  // https://www.cue-shop.jp/view/item/000000004214
  // ※ メーカー公式サイトには掲載がない（公式のPlatinum 615はキャロム用の別物）
  platinum: {
    label: "ダイナスフィア プラチナム",
    note: "6番がグレー、7番がターコイズです（通常とは違います）。",
    // 数字が白い三角形（ロータ形）の枠に入るのがこのシリーズの見た目の特徴
    numberStyle: "triangle",
    stripeBase: "#f4efe2",
    stripeOnBase: false,
    colors: {
      1: "#f5a800", // 山吹
      2: "#2f8fd4", // 明るい青
      3: "#d8232a", // 赤
      4: "#a48ac0", // 藤色
      5: "#e8481f", // 朱色
      6: "#b9b5ad", // 薄いグレー（通常は緑）
      7: "#3fb8b8", // ターコイズ（通常は茶）
      8: "#241a12", // 黒（べっ甲調）
    },
  },

  // ※ Dynaspheres Titanium（チタニウム）は本人の指示（2026-08-20）で削除した。
  //   使わないため。色の出典と数値は 04_種目ルール仕様.md に残してある。
  //   過去の試合が titanium を指していても ballAppearance が標準に倒すので壊れない。

  // Aramith Tournament BLACK（Duramith™ Technology）
  // 出典: https://aramith.com/story-behind-aramith-tournament-black-colours/
  //   3セット中このセットだけメーカーが番号ごとの色を文章で明記している
  // ストライプの向きが通常と逆（色地に黒帯）
  aramith_black: {
    label: "アラミス ブラック",
    note: "ストライプが「色地に黒帯」で通常と逆です。5番が薄紫、7番が薄茶です。",
    numberStyle: "circle",
    stripeBase: "#141414", // 帯の色（このセットは帯が黒）
    stripeOnBase: true, // true = 地が色で帯が黒
    colors: {
      1: "#f0c11b", // 黄
      2: "#1d3f7a", // 濃紺
      3: "#cf2b28", // 赤
      4: "#e87ba8", // ピンク（通常は紫）
      5: "#a98fd0", // 薄紫（通常は橙）
      6: "#4fae5a", // 明るい緑
      7: "#b08968", // 薄茶（通常はえんじ）
      8: "#141414", // 黒
    },
  },
};

/** 選べるボールセットの一覧（表示順） */
const BALL_SET_ORDER = ["standard", "platinum", "aramith_black"];

/**
 * 球番号の見た目を返す。
 *
 * @returns {{base: string, band: string|null, ink: string}}
 *   base = 地の色、band = 帯の色（ストライプでなければ null）、ink = 番号の文字色
 */
function ballAppearance(setId, n) {
  const set = BALL_SETS[setId] || BALL_SETS.standard;
  // 9番以上は 1〜7番と同じ色のストライプ（8番だけ黒で単独）
  const baseNo = n <= 8 ? n : n - 8;
  const color = set.colors[baseNo] || "#888888";
  const shape = set.numberStyle || "circle";

  if (!isStripeBall(n)) {
    return { base: color, band: null, ink: readableInk(color), shape: shape };
  }
  if (set.stripeOnBase) {
    // 色地に黒帯（アラミス ブラック）
    return { base: color, band: set.stripeBase, ink: readableInk(color), shape: shape };
  }
  // 白地に色帯（通常）
  return {
    base: set.stripeBase, band: color,
    ink: readableInk(set.stripeBase), shape: shape,
  };
}

/** 背景色に対して読める文字色（黒か白）を返す */
function readableInk(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return "#1a1408";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // 相対輝度で判断する（WCAGの簡易版）
  const lum = (0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b));
  return lum > 0.42 ? "#1a1408" : "#ffffff";
}

function srgb(v) {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
