/**
 * qr.js — QRコードの符号化だけを行う（描画はしない）
 *
 * なぜ自前で書くか:
 *   このアプリはオフラインで動く必要があり、CDNや npm の外部ライブラリを
 *   足せない。共有リンク（share.js）は実測で約1,100〜2,000字になるため、
 *   よくある小さな実装（版1〜10程度）では入らない。版40まで作れる必要がある。
 *
 * なぜ表を持たずに計算する箇所があるか:
 *   版ごとの総符号語数は「機能パターンを置いたあとの空きマス÷8」で決まる。
 *   40行の表を書き写すと写し間違いが混ざっても気付けないので、
 *   実際に機能パターンを置いてから数える。手で持つ表は、
 *   規格から計算では出せない2つ（1ブロックあたりの訂正符号語数・ブロック数）だけにする。
 *
 * 対応: 版1〜40 / 訂正レベル L M Q H / 英数字モード・バイト(UTF-8)モード
 * 参照: JIS X 0510（ISO/IEC 18004）
 */
const QRCODE = (function () {
  "use strict";

  /* ============================================================
   * 規格の表（計算では出せないもの）
   * 添字は [訂正レベル][版]。版は1始まりなので先頭に番兵を置く
   * ========================================================== */

  // 1ブロックあたりの訂正符号語数
  const EC_CODEWORDS_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };

  // ブロック数（訂正符号語の塊をいくつに分けるか）
  const EC_BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };

  // 形式情報に入る訂正レベルの2ビット（L=01 M=00 Q=11 H=10）。数値の大小とは並びが違う
  const EC_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  const EC_LEVELS = ["L", "M", "Q", "H"];

  // 英数字モードで使える文字。ここに無い文字が1つでもあればバイトモードになる
  const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  const MODE_ALNUM = "alnum";
  const MODE_BYTE = "byte";

  /* ============================================================
   * 小さな道具
   * ========================================================== */

  /**
   * 文字列をUTF-8のバイト列にする。
   * TextEncoder を使わないのは、このモジュールを単体で完結させるため
   * （検証も描画も、外の何かが用意されている前提にしたくない）
   */
  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      // サロゲートペア（絵文字など）は2つで1文字なのでまとめて扱う
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0x10000) {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function isAlnumOnly(str) {
    for (let i = 0; i < str.length; i++) {
      if (ALNUM.indexOf(str.charAt(i)) < 0) return false;
    }
    return true;
  }

  /** 文字数指示子のビット数。版によって長さが変わる */
  function charCountBits(mode, version) {
    if (mode === MODE_ALNUM) return version <= 9 ? 9 : (version <= 26 ? 11 : 13);
    return version <= 9 ? 8 : 16; // バイトモードは版10以上すべて16
  }

  function modeIndicator(mode) {
    return mode === MODE_ALNUM ? 2 : 4; // 0010 / 0100
  }

  /* ============================================================
   * ガロア体 GF(256) — リード・ソロモン訂正符号の計算に使う
   * 原始多項式は規格指定の x^8+x^4+x^3+x^2+1 (0x11D)
   * ========================================================== */

  const GF_EXP = new Array(512);
  const GF_LOG = new Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    // 添字が255を超えても剰余を取らずに引けるよう、後半に同じ並びを繰り返す
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  /** 訂正符号語 n 個ぶんの生成多項式 */
  function rsGenerator(n) {
    let poly = [1];
    for (let i = 0; i < n; i++) {
      // (x + α^i) を掛ける
      const next = new Array(poly.length + 1);
      for (let j = 0; j < next.length; j++) next[j] = 0;
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  const GEN_CACHE = {};
  function generatorFor(n) {
    if (!GEN_CACHE[n]) GEN_CACHE[n] = rsGenerator(n);
    return GEN_CACHE[n];
  }

  /** データ符号語の並びから訂正符号語 n 個を作る */
  function rsRemainder(data, n) {
    const gen = generatorFor(n);
    const rem = new Array(n);
    for (let i = 0; i < n; i++) rem[i] = 0;
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      rem.shift();
      rem.push(0);
      for (let j = 0; j < n; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
    return rem;
  }

  /* ============================================================
   * 機能パターン（位置検出・タイミング・位置合わせ・形式情報）
   * ========================================================== */

  function sizeOf(version) {
    return 17 + 4 * version;
  }

  /**
   * 位置合わせパターンの中心座標。
   * 版32だけ規格の値が計算式と合わないので、そこだけ規格の値を直に入れている
   */
  function alignPositions(version) {
    if (version === 1) return [];
    const size = sizeOf(version);
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26
      : Math.ceil((size - 13) / (2 * count - 2)) * 2;
    const pos = [];
    for (let p = size - 7; pos.length < count - 1; p -= step) pos.unshift(p);
    pos.unshift(6);
    return pos;
  }

  function newGrid(size, value) {
    const g = new Array(size);
    for (let y = 0; y < size; y++) {
      const row = new Array(size);
      for (let x = 0; x < size; x++) row[x] = value;
      g[y] = row;
    }
    return g;
  }

  function copyGrid(g) {
    const out = new Array(g.length);
    for (let y = 0; y < g.length; y++) out[y] = g[y].slice();
    return out;
  }

  /** 形式情報15ビット（訂正レベル2 + マスク3 に BCH の誤り訂正10ビット） */
  function formatBits(ecLevel, mask) {
    const data = (EC_LEVEL_BITS[ecLevel] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    }
    // 固定パターンとの排他的論理和。中身が全部0でも模様が偏らないようにするため
    return ((data << 10) | rem) ^ 0x5412;
  }

  /** 型番情報18ビット（版6 + BCH 12ビット） */
  function versionBits(version) {
    let rem = version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ (((rem >> 11) & 1) * 0x1f25);
    }
    return (version << 12) | rem;
  }

  /**
   * 形式情報を書く。reserveOnly のときは中身を0にして場所だけ押さえる
   * （空きマスを数えて総符号語数を出すので、ここを漏らすと全部ずれる）
   */
  function drawFormatInfo(modules, isFunc, size, ecLevel, mask, reserveOnly) {
    const bits = reserveOnly ? 0 : formatBits(ecLevel, mask);
    function put(x, y, i) {
      modules[y][x] = ((bits >> i) & 1) === 1;
      isFunc[y][x] = true;
    }
    // 左上まわり（下位ビットから）
    for (let i = 0; i <= 5; i++) put(8, i, i);
    put(8, 7, 6);
    put(8, 8, 7);
    put(7, 8, 8);
    for (let i = 9; i < 15; i++) put(14 - i, 8, i);
    // 右上と左下（同じ15ビットの複製）
    for (let i = 0; i < 8; i++) put(size - 1 - i, 8, i);
    for (let i = 8; i < 15; i++) put(8, size - 15 + i, i);
    // 常に黒のマス。規格で位置が決まっている
    modules[size - 8][8] = true;
    isFunc[size - 8][8] = true;
  }

  function drawVersionInfo(modules, isFunc, size, version, reserveOnly) {
    const bits = reserveOnly ? 0 : versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      modules[b][a] = dark; isFunc[b][a] = true;
      modules[a][b] = dark; isFunc[a][b] = true;
    }
  }

  /** 機能パターンだけを置いた状態を作る */
  function buildFunctionMatrix(version) {
    const size = sizeOf(version);
    const modules = newGrid(size, false);
    const isFunc = newGrid(size, false);

    function set(x, y, dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = dark;
      isFunc[y][x] = true;
    }

    // タイミングパターン（6行目・6列目の白黒交互）を先に引く。
    // 位置検出パターンと重なる両端は、このあと位置検出パターンで上書きされる。
    // 順番を逆にすると位置検出パターンが削られる（実際に壊して検証で見つけた）
    for (let i = 0; i < size; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }

    // 位置検出パターン（3隅）。中心から4マス目の輪を白にすることで分離帯も同時に引ける
    function finder(cx, cy) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, d !== 2 && d !== 4);
        }
      }
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    // 位置合わせパターン。位置検出パターンと重なる3組だけ置かない
    const pos = alignPositions(version);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const corner = (i === 0 && j === 0)
          || (i === 0 && j === pos.length - 1)
          || (i === pos.length - 1 && j === 0);
        if (corner) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            set(pos[j] + dx, pos[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    // 形式情報の置き場所を押さえる（中身はマスクが決まってから書く）
    drawFormatInfo(modules, isFunc, size, "L", 0, true);
    // 型番情報は版7以上だけ
    if (version >= 7) drawVersionInfo(modules, isFunc, size, version, true);

    return { size: size, modules: modules, isFunc: isFunc };
  }

  /* ============================================================
   * 容量
   * ========================================================== */

  const TOTAL_CACHE = {};
  /** 版ごとの総符号語数。機能パターンを置いた残りのマス数から求める */
  function totalCodewords(version) {
    if (TOTAL_CACHE[version] != null) return TOTAL_CACHE[version];
    const f = buildFunctionMatrix(version);
    let free = 0;
    for (let y = 0; y < f.size; y++) {
      for (let x = 0; x < f.size; x++) if (!f.isFunc[y][x]) free++;
    }
    TOTAL_CACHE[version] = Math.floor(free / 8);
    return TOTAL_CACHE[version];
  }

  function dataCodewords(version, ecLevel) {
    return totalCodewords(version)
      - EC_CODEWORDS_PER_BLOCK[ecLevel][version] * EC_BLOCKS[ecLevel][version];
  }

  /** その版・レベルで、そのモードなら何文字入るか */
  function capacityChars(version, ecLevel, mode) {
    const bits = dataCodewords(version, ecLevel) * 8 - 4 - charCountBits(mode, version);
    if (bits < 0) return 0;
    if (mode === MODE_BYTE) return Math.floor(bits / 8);
    // 英数字は2文字で11ビット。余りが6ビットあればもう1文字だけ入る
    const pairs = Math.floor(bits / 11);
    return pairs * 2 + (bits % 11 >= 6 ? 1 : 0);
  }

  /* ============================================================
   * ビット列の組み立て
   * ========================================================== */

  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.push = function (value, len) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
  };

  /**
   * データ符号語を作る。入りきらなければ null（呼び出し側で次の版を試す）。
   * 文字数指示子の長さが版で変わるため、版が決まってからでないと作れない
   */
  function buildBits(text, mode, version, ecLevel) {
    const bb = new BitBuffer();
    const capacityBits = dataCodewords(version, ecLevel) * 8;

    if (mode === MODE_ALNUM) {
      bb.push(modeIndicator(mode), 4);
      bb.push(text.length, charCountBits(mode, version));
      for (let i = 0; i + 1 < text.length; i += 2) {
        bb.push(ALNUM.indexOf(text.charAt(i)) * 45 + ALNUM.indexOf(text.charAt(i + 1)), 11);
      }
      if (text.length % 2 === 1) {
        bb.push(ALNUM.indexOf(text.charAt(text.length - 1)), 6);
      }
    } else {
      const bytes = utf8Bytes(text);
      bb.push(modeIndicator(mode), 4);
      bb.push(bytes.length, charCountBits(mode, version));
      for (let i = 0; i < bytes.length; i++) bb.push(bytes[i], 8);
    }

    if (bb.bits.length > capacityBits) return null;

    // 終端パターン（残りが4ビット未満ならその長さでよい）
    bb.push(0, Math.min(4, capacityBits - bb.bits.length));
    // 符号語の切れ目まで0で埋める
    while (bb.bits.length % 8 !== 0) bb.bits.push(0);

    const words = [];
    for (let i = 0; i < bb.bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bb.bits[i + j];
      words.push(v);
    }
    // 余りは規格で決まった2つの値を交互に詰める
    const pads = [0xec, 0x11];
    for (let i = 0; words.length < capacityBits / 8; i++) words.push(pads[i % 2]);
    return words;
  }

  /* ============================================================
   * ブロック分割・訂正符号・並べ替え
   * ========================================================== */

  /**
   * データ符号語をブロックに分け、各ブロックに訂正符号語を付け、
   * 規格の順序（各ブロックの同じ位置を順に取る）で並べ直す。
   * 一部が汚れても復元できるよう、誤りを散らすのが目的
   */
  function interleave(data, version, ecLevel) {
    const numBlocks = EC_BLOCKS[ecLevel][version];
    const ecLen = EC_CODEWORDS_PER_BLOCK[ecLevel][version];
    const shortLen = Math.floor(data.length / numBlocks);
    const numLong = data.length % numBlocks; // 1符号語だけ長いブロックの数

    const blocks = [];
    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const len = shortLen + (i >= numBlocks - numLong ? 1 : 0);
      const dat = data.slice(k, k + len);
      k += len;
      blocks.push({ data: dat, ec: rsRemainder(dat, ecLen) });
    }

    const out = [];
    for (let i = 0; i <= shortLen; i++) {
      for (let b = 0; b < numBlocks; b++) {
        // 短いブロックには最後の1個が無いので飛ばす
        if (i < blocks[b].data.length) out.push(blocks[b].data[i]);
      }
    }
    for (let i = 0; i < ecLen; i++) {
      for (let b = 0; b < numBlocks; b++) out.push(blocks[b].ec[i]);
    }
    return out;
  }

  /* ============================================================
   * 配置とマスク
   * ========================================================== */

  /** 右下から上下に折り返しながら2列ずつ埋める */
  function placeCodewords(modules, isFunc, size, words) {
    let bit = 0;
    const total = words.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      // 6列目はタイミングパターンなので、列の組から外す
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (isFunc[y][x]) continue;
          if (bit < total) {
            modules[y][x] = ((words[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
            bit++;
          }
          // 端数のマス（remainder bits）は白のままでよい
        }
      }
    }
    return bit;
  }

  function maskAt(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function applyMask(modules, isFunc, size, mask) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunc[y][x] && maskAt(mask, x, y)) modules[y][x] = !modules[y][x];
      }
    }
  }

  // 位置検出パターンと紛らわしい並び。行・列の両方向で探す
  const FINDER_LIKE = "10111010000";
  const FINDER_LIKE_REV = "00001011101";

  function countOccurrences(s, sub) {
    let n = 0;
    let i = s.indexOf(sub);
    while (i >= 0) { n++; i = s.indexOf(sub, i + 1); }
    return n;
  }

  /** 読み取りにくさの点数。小さいほど良い（規格の4つの規則） */
  function penalty(modules, size) {
    let score = 0;

    // 規則1: 同じ色が5つ以上並ぶ
    function runPenalty(line) {
      let s = 0;
      let run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line.charAt(i) === line.charAt(i - 1)) {
          run++;
        } else {
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) s += 3 + (run - 5);
      return s;
    }

    const rows = [];
    const cols = [];
    for (let y = 0; y < size; y++) {
      let r = "";
      for (let x = 0; x < size; x++) r += modules[y][x] ? "1" : "0";
      rows.push(r);
    }
    for (let x = 0; x < size; x++) {
      let c = "";
      for (let y = 0; y < size; y++) c += modules[y][x] ? "1" : "0";
      cols.push(c);
    }

    let dark = 0;
    for (let i = 0; i < size; i++) {
      score += runPenalty(rows[i]) + runPenalty(cols[i]);
      // 規則3: 位置検出パターンに似た並び
      score += 40 * (countOccurrences(rows[i], FINDER_LIKE)
        + countOccurrences(rows[i], FINDER_LIKE_REV));
      score += 40 * (countOccurrences(cols[i], FINDER_LIKE)
        + countOccurrences(cols[i], FINDER_LIKE_REV));
      for (let j = 0; j < size; j++) if (modules[i][j]) dark++;
    }

    // 規則2: 同じ色の2×2の塊
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          score += 3;
        }
      }
    }

    // 規則4: 白黒の割合が5割から離れているほど減点
    const total = size * size;
    score += 10 * Math.floor(Math.abs(dark * 20 - total * 10) / total);

    return score;
  }

  /* ============================================================
   * 組み立て
   * ========================================================== */

  function buildMatrix(version, ecLevel, words) {
    const f = buildFunctionMatrix(version);
    placeCodewords(f.modules, f.isFunc, f.size, words);

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(f.modules, f.isFunc, f.size, mask);
      drawFormatInfo(f.modules, f.isFunc, f.size, ecLevel, mask, false);
      const p = penalty(f.modules, f.size);
      if (best === null || p < best.score) {
        best = { mask: mask, score: p, modules: copyGrid(f.modules) };
      }
      // 同じ盤面を使い回すので、次のマスクを試す前に必ず戻す（同じ演算を2回で元に戻る）
      applyMask(f.modules, f.isFunc, f.size, mask);
    }
    return { size: f.size, modules: best.modules, mask: best.mask, penalty: best.score };
  }

  /* ============================================================
   * 公開する関数
   * ========================================================== */

  /**
   * 文字列をQRコードの白黒の並びにする。
   * @param text 入れる文字列
   * @param opts { ecLevel:"L"|"M"|"Q"|"H"（既定 "L"）, minVersion, maxVersion }
   * @returns { size, modules, version, ecLevel, mask, mode }
   *          modules[y][x] が true なら黒
   */
  function make(text, opts) {
    const o = opts || {};
    const ecLevel = o.ecLevel || "L";
    if (EC_LEVELS.indexOf(ecLevel) < 0) {
      throw new Error("訂正レベルは L M Q H のいずれかです（受け取った値: " + ecLevel + "）");
    }
    const s = String(text == null ? "" : text);
    if (s.length === 0) throw new Error("QRコードにする文字列が空です");

    const minV = Math.max(1, o.minVersion || 1);
    const maxV = Math.min(40, o.maxVersion || 40);
    if (minV > maxV) throw new Error("版の指定が逆です（最小 " + minV + " / 最大 " + maxV + "）");

    // 英数字モードで書ける文字だけなら英数字モードにする。同じ文字数でも小さく収まるため
    const mode = isAlnumOnly(s) ? MODE_ALNUM : MODE_BYTE;

    for (let v = minV; v <= maxV; v++) {
      const words = buildBits(s, mode, v, ecLevel);
      if (words) {
        const m = buildMatrix(v, ecLevel, interleave(words, v, ecLevel));
        return {
          size: m.size,
          modules: m.modules,
          version: v,
          ecLevel: ecLevel,
          mask: m.mask,
          mode: mode
        };
      }
    }

    const limit = capacityChars(maxV, ecLevel, mode);
    const unit = mode === MODE_BYTE ? "バイト" : "文字";
    const actual = mode === MODE_BYTE ? utf8Bytes(s).length : s.length;
    throw new Error(
      "QRコードに入りきりません。訂正レベル" + ecLevel + "・版" + maxV
      + "の上限は" + limit + unit + "ですが、" + actual + unit + "あります。"
      + "文字数を減らすか、訂正レベルを下げてください"
    );
  }

  /**
   * 入る文字数の上限を返す（画面に出す目安や、事前の判定に使う）。
   * @param ecLevel 訂正レベル（既定 "L"）
   * @param version 版（既定 40 = 最大）
   */
  function capacity(ecLevel, version) {
    const lv = ecLevel || "L";
    const v = version || 40;
    if (EC_LEVELS.indexOf(lv) < 0) throw new Error("訂正レベルは L M Q H のいずれかです");
    if (v < 1 || v > 40) throw new Error("版は1〜40です");
    return {
      version: v,
      ecLevel: lv,
      size: sizeOf(v),
      alnum: capacityChars(v, lv, MODE_ALNUM),
      byte: capacityChars(v, lv, MODE_BYTE),
      dataCodewords: dataCodewords(v, lv),
      totalCodewords: totalCodewords(v)
    };
  }

  return {
    make: make,
    capacity: capacity,
    // 以下は検証用に見せている（画面側からは使わない）
    sizeOf: sizeOf,
    alignPositions: alignPositions,
    totalCodewords: totalCodewords,
    dataCodewords: dataCodewords,
    buildBits: buildBits,
    interleave: interleave,
    utf8Bytes: utf8Bytes,
    isAlnumOnly: isAlnumOnly,
    charCountBits: charCountBits,
    maskAt: maskAt,
    EC_CODEWORDS_PER_BLOCK: EC_CODEWORDS_PER_BLOCK,
    EC_BLOCKS: EC_BLOCKS
  };
})();
