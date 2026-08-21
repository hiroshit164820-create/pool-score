/**
 * qrdecode.js — QRコードの読み取り（復号）だけを行う
 *
 * なぜ自前で書くか:
 *   カメラでQRを写して取り込むために BarcodeDetector を使いたいが、
 *   iOS Safari には無い。使えない端末では自前で読むしかない。
 *   このアプリはオフラインで動く必要があるので CDN も npm も足せない。
 *   符号化側（qr.js）と対になる復号側として、これ1枚で完結させる。
 *
 * なぜ例外を投げないか:
 *   カメラの毎フレームで呼ぶ。写っていない・ぶれている・ピントが合っていないのは
 *   異常ではなく普通のこと。読めなければ null を返すだけにする。
 *
 * 流れ:
 *   画素 → 二値化（区画ごとのしきい値）→ 位置検出パターン3つ →
 *   射影変換で升目を取り出す → 形式情報 → アンマスク → 符号語 →
 *   デインタリーブ → リード・ソロモン訂正 → 文字列
 *
 * 対応: 版1〜40 / 訂正レベル L M Q H / 数字・英数字・バイト(UTF-8)モード
 * 参照: JIS X 0510（ISO/IEC 18004）
 */
const QRDECODE = (function () {
  "use strict";

  /* ============================================================
   * 規格の表（計算では出せないもの）
   * qr.js と同じ値。ここを片方だけ直すと符号化と復号がずれるので、
   * 直すときは必ず両方を同時に直すこと
   * ========================================================== */

  // 1ブロックあたりの訂正符号語数。添字は [訂正レベル][版]、版は1始まり
  const EC_CODEWORDS_PER_BLOCK = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };

  // ブロック数
  const EC_BLOCKS = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };

  // 形式情報の2ビットから訂正レベルへ（L=01 M=00 Q=11 H=10）。数値の大小とは並びが違う
  const EC_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  const EC_LEVELS = ["L", "M", "Q", "H"];

  // 英数字モードの文字表。添字がそのまま符号値になる
  const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

  /* ============================================================
   * ガロア体 GF(256) — リード・ソロモン誤り訂正に使う
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

  function gfInv(a) {
    // a^254 = a^-1。表があるので指数の引き算で出す
    return GF_EXP[255 - GF_LOG[a]];
  }

  /* ------------------------------------------------------------
   * GF(256)上の多項式。係数は「次数の高い順」で持つ
   * （先頭の0は落として持つ。零多項式だけは [0]）
   * ---------------------------------------------------------- */

  function polyTrim(c) {
    let i = 0;
    while (i < c.length - 1 && c[i] === 0) i++;
    return i === 0 ? c : c.slice(i);
  }

  function polyIsZero(c) {
    return c[0] === 0;
  }

  function polyDegree(c) {
    return c.length - 1;
  }

  /** 次数 degree の係数を取り出す（配列は高い次数が先頭なので添字が逆になる） */
  function polyCoef(c, degree) {
    return c[c.length - 1 - degree];
  }

  function polyEval(c, x) {
    if (x === 0) return polyCoef(c, 0);
    let result = c[0];
    for (let i = 1; i < c.length; i++) result = gfMul(result, x) ^ c[i];
    return result;
  }

  /** 加算と減算は同じ（排他的論理和） */
  function polyAdd(a, b) {
    if (polyIsZero(a)) return b;
    if (polyIsZero(b)) return a;
    let small = a;
    let large = b;
    if (small.length > large.length) { small = b; large = a; }
    const out = large.slice();
    const off = large.length - small.length;
    for (let i = 0; i < small.length; i++) out[off + i] ^= small[i];
    return polyTrim(out);
  }

  function polyMul(a, b) {
    if (polyIsZero(a) || polyIsZero(b)) return [0];
    const out = new Array(a.length + b.length - 1);
    for (let i = 0; i < out.length; i++) out[i] = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) out[i + j] ^= gfMul(a[i], b[j]);
    }
    return polyTrim(out);
  }

  function polyScale(a, s) {
    if (s === 0) return [0];
    if (s === 1) return a;
    const out = new Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = gfMul(a[i], s);
    return out;
  }

  /** s * x^degree の単項式 */
  function polyMonomial(degree, s) {
    if (s === 0) return [0];
    const out = new Array(degree + 1);
    for (let i = 0; i < out.length; i++) out[i] = 0;
    out[0] = s;
    return out;
  }

  function polyMulMonomial(a, degree, s) {
    if (s === 0) return [0];
    const out = new Array(a.length + degree);
    for (let i = 0; i < out.length; i++) out[i] = 0;
    for (let i = 0; i < a.length; i++) out[i] = gfMul(a[i], s);
    return polyTrim(out);
  }

  /**
   * リード・ソロモン復号。received は データ+訂正 の符号語列、ecLen は訂正符号語数。
   * 直せたら true（received を書き換える）。直せなければ false。
   *
   * ユークリッドの互除法による方法:
   *   シンドローム → 誤り位置多項式σと誤り評価多項式ω →
   *   位置（チェン探索）→ 大きさ（フォーニーの式）
   */
  function rsDecode(received, ecLen) {
    // シンドローム。全部0なら誤り無し
    const syn = new Array(ecLen);
    let noError = true;
    for (let i = 0; i < ecLen; i++) {
      const v = polyEval(received, GF_EXP[i]);
      syn[ecLen - 1 - i] = v;
      if (v !== 0) noError = false;
    }
    if (noError) return true;

    const syndrome = polyTrim(syn);

    // x^ecLen とシンドローム多項式から σ と ω を得る
    let rLast = polyMonomial(ecLen, 1);
    let r = syndrome;
    let tLast = [0];
    let t = [1];
    const stop = ecLen >> 1;
    while (polyDegree(r) >= stop) {
      const rLastLast = rLast;
      const tLastLast = tLast;
      rLast = r;
      tLast = t;
      if (polyIsZero(rLast)) return false; // 直せない
      r = rLastLast;
      let q = [0];
      const dltInverse = gfInv(polyCoef(rLast, polyDegree(rLast)));
      let guard = 0;
      while (polyDegree(r) >= polyDegree(rLast) && !polyIsZero(r)) {
        const degreeDiff = polyDegree(r) - polyDegree(rLast);
        const scale = gfMul(polyCoef(r, polyDegree(r)), dltInverse);
        q = polyAdd(q, polyMonomial(degreeDiff, scale));
        r = polyAdd(r, polyMulMonomial(rLast, degreeDiff, scale));
        // 読み取りが崩れていると割り切れずに回り続けることがあるので保険を置く
        if (++guard > 300) return false;
      }
      t = polyAdd(polyMul(q, tLast), tLastLast);
      if (polyDegree(r) >= polyDegree(rLast)) return false;
    }

    const sigmaTildeAtZero = polyCoef(t, 0);
    if (sigmaTildeAtZero === 0) return false;
    const inv = gfInv(sigmaTildeAtZero);
    const sigma = polyScale(t, inv);
    const omega = polyScale(r, inv);

    // 誤りの位置（チェン探索）
    const numErrors = polyDegree(sigma);
    if (numErrors < 1) return false;
    const locations = new Array(numErrors);
    let e = 0;
    if (numErrors === 1) {
      locations[0] = polyCoef(sigma, 1);
      e = 1;
    } else {
      for (let i = 1; i < 256 && e < numErrors; i++) {
        if (polyEval(sigma, i) === 0) locations[e++] = gfInv(i);
      }
    }
    if (e !== numErrors) return false;

    // 誤りの大きさ（フォーニーの式）
    const magnitudes = new Array(numErrors);
    for (let i = 0; i < numErrors; i++) {
      const xiInverse = gfInv(locations[i]);
      let denominator = 1;
      for (let j = 0; j < numErrors; j++) {
        if (i === j) continue;
        const term = gfMul(locations[j], xiInverse);
        // (1 + term) を作る。GF(2)なので最下位ビットを反転させるだけでよい
        const termPlus1 = (term & 1) === 0 ? (term | 1) : (term & 0xfe);
        denominator = gfMul(denominator, termPlus1);
      }
      // QRの生成多項式は α^0 始まりなので、ここで位置の重みを掛け直す必要はない
      magnitudes[i] = gfMul(polyEval(omega, xiInverse), gfInv(denominator));
    }

    for (let i = 0; i < numErrors; i++) {
      const position = received.length - 1 - GF_LOG[locations[i]];
      if (position < 0 || position >= received.length) return false;
      received[position] ^= magnitudes[i];
    }
    return true;
  }

  /* ============================================================
   * 機能パターン（qr.js と同じ置き方を再現する）
   * 「どのマスがデータか」を知るために、符号化と同じ盤面をもう一度作る
   * ========================================================== */

  function sizeOf(version) {
    return 17 + 4 * version;
  }

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

  /** 機能パターンの「場所」だけが要るので、白黒の中身は作らず isFunc だけ返す */
  function buildFunctionMask(version) {
    const size = sizeOf(version);
    const isFunc = newGrid(size, false);

    function set(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      isFunc[y][x] = true;
    }

    // タイミングパターン
    for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }

    // 位置検出パターンと分離帯（中心から4マスぶん）
    function finder(cx, cy) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy);
      }
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    // 位置合わせパターン。位置検出パターンと重なる3組は置かれていない
    const pos = alignPositions(version);
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        const corner = (i === 0 && j === 0)
          || (i === 0 && j === pos.length - 1)
          || (i === pos.length - 1 && j === 0);
        if (corner) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) set(pos[j] + dx, pos[i] + dy);
        }
      }
    }

    // 形式情報の場所
    for (let i = 0; i <= 5; i++) set(8, i);
    set(8, 7); set(8, 8); set(7, 8);
    for (let i = 9; i < 15; i++) set(14 - i, 8);
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8);
    for (let i = 8; i < 15; i++) set(8, size - 15 + i);
    set(8, size - 8); // 常に黒のマス

    // 型番情報（版7以上）
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b);
        set(b, a);
      }
    }
    return isFunc;
  }

  const FUNC_CACHE = {};
  function functionMaskFor(version) {
    if (!FUNC_CACHE[version]) FUNC_CACHE[version] = buildFunctionMask(version);
    return FUNC_CACHE[version];
  }

  const TOTAL_CACHE = {};
  /** 版ごとの総符号語数。機能パターンを置いた残りのマス数から求める */
  function totalCodewords(version) {
    if (TOTAL_CACHE[version] != null) return TOTAL_CACHE[version];
    const isFunc = functionMaskFor(version);
    const size = sizeOf(version);
    let free = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!isFunc[y][x]) free++;
    }
    TOTAL_CACHE[version] = Math.floor(free / 8);
    return TOTAL_CACHE[version];
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

  function formatBits(ecLevel, mask) {
    const data = (EC_LEVEL_BITS[ecLevel] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function popCount(v) {
    let n = 0;
    let x = v;
    while (x) { n += x & 1; x >>= 1; }
    return n;
  }

  /**
   * 形式情報を読む。15ビットの中に10ビットのBCH訂正が入っているので、
   * 32通り全部と見比べて一番近いものを選ぶ（3ビットまでの違いなら直せる）。
   * 同じ情報が2組あるので、両方を候補に入れて近い方を採る
   */
  function readFormat(modules, size) {
    let a = 0;
    let b = 0;
    function bitAt(x, y) { return modules[y][x] ? 1 : 0; }
    // 1組目（左上のまわり）。qr.js の書き込み順を逆にたどる
    for (let i = 0; i <= 5; i++) a |= bitAt(8, i) << i;
    a |= bitAt(8, 7) << 6;
    a |= bitAt(8, 8) << 7;
    a |= bitAt(7, 8) << 8;
    for (let i = 9; i < 15; i++) a |= bitAt(14 - i, 8) << i;
    // 2組目（右上と左下）
    for (let i = 0; i < 8; i++) b |= bitAt(size - 1 - i, 8) << i;
    for (let i = 8; i < 15; i++) b |= bitAt(8, size - 15 + i) << i;

    let best = null;
    for (let l = 0; l < 4; l++) {
      for (let mask = 0; mask < 8; mask++) {
        const ref = formatBits(EC_LEVELS[l], mask);
        const d = Math.min(popCount(ref ^ a), popCount(ref ^ b));
        if (best === null || d < best.dist) {
          best = { dist: d, ecLevel: EC_LEVELS[l], mask: mask };
        }
      }
    }
    // 3ビットを超えて違うなら、そもそも形式情報として信用できない
    return (best && best.dist <= 3) ? best : null;
  }

  /** 符号語を読む。qr.js の placeCodewords と同じ順路（右下から2列ずつ折り返す） */
  function readCodewords(modules, isFunc, size, version) {
    const total = totalCodewords(version);
    const words = new Array(total);
    for (let i = 0; i < total; i++) words[i] = 0;
    let bit = 0;
    const totalBits = total * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // 6列目はタイミングパターンなので列の組から外す
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (isFunc[y][x]) continue;
          if (bit < totalBits) {
            if (modules[y][x]) words[bit >> 3] |= 1 << (7 - (bit & 7));
            bit++;
          }
        }
      }
    }
    return words;
  }

  /**
   * インタリーブを解いてブロックに戻し、ブロックごとに誤り訂正する。
   * 直せないブロックが1つでもあれば null（＝この読み取りは捨てる）
   */
  function deinterleaveAndCorrect(words, version, ecLevel) {
    const numBlocks = EC_BLOCKS[ecLevel][version];
    const ecLen = EC_CODEWORDS_PER_BLOCK[ecLevel][version];
    const total = totalCodewords(version);
    const dataLen = total - ecLen * numBlocks;
    if (dataLen <= 0) return null;
    const shortLen = Math.floor(dataLen / numBlocks);
    const numLong = dataLen % numBlocks;

    const lens = new Array(numBlocks);
    const blocks = new Array(numBlocks);
    for (let b = 0; b < numBlocks; b++) {
      lens[b] = shortLen + (b >= numBlocks - numLong ? 1 : 0);
      blocks[b] = [];
    }

    let k = 0;
    for (let i = 0; i <= shortLen; i++) {
      for (let b = 0; b < numBlocks; b++) {
        if (i < lens[b]) blocks[b].push(words[k++]);
      }
    }
    for (let i = 0; i < ecLen; i++) {
      for (let b = 0; b < numBlocks; b++) blocks[b].push(words[k++]);
    }

    const out = [];
    for (let b = 0; b < numBlocks; b++) {
      if (!rsDecode(blocks[b], ecLen)) return null;
      for (let i = 0; i < lens[b]; i++) out.push(blocks[b][i]);
    }
    return out;
  }

  /* ============================================================
   * ビット列から文字列へ
   * ========================================================== */

  function BitReader(bytes) {
    this.bytes = bytes;
    this.pos = 0; // ビット単位
  }
  BitReader.prototype.remaining = function () {
    return this.bytes.length * 8 - this.pos;
  };
  BitReader.prototype.read = function (n) {
    if (n > this.remaining()) return -1;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const p = this.pos + i;
      v = (v << 1) | ((this.bytes[p >> 3] >> (7 - (p & 7))) & 1);
    }
    this.pos += n;
    return v;
  };

  function numericCountBits(version) {
    return version <= 9 ? 10 : (version <= 26 ? 12 : 14);
  }
  function alnumCountBits(version) {
    return version <= 9 ? 9 : (version <= 26 ? 11 : 13);
  }
  function byteCountBits(version) {
    return version <= 9 ? 8 : 16;
  }

  /** UTF-8として筋が通っているか。通らなければ Latin-1 として読む */
  function isValidUtf8(bytes) {
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      let n;
      if (b < 0x80) n = 0;
      else if ((b & 0xe0) === 0xc0) n = 1;
      else if ((b & 0xf0) === 0xe0) n = 2;
      else if ((b & 0xf8) === 0xf0) n = 3;
      else return false;
      if (i + n > bytes.length - 1) return false;
      for (let k = 1; k <= n; k++) {
        if ((bytes[i + k] & 0xc0) !== 0x80) return false;
      }
      i += n + 1;
    }
    return true;
  }

  function utf8Decode(bytes) {
    let s = "";
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      let cp;
      let n;
      if (b < 0x80) { cp = b; n = 0; }
      else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; n = 1; }
      else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; n = 2; }
      else { cp = b & 0x07; n = 3; }
      i++;
      for (let k = 0; k < n; k++) { cp = (cp << 6) | (bytes[i] & 0x3f); i++; }
      if (cp > 0xffff) {
        // サロゲートペア（絵文字など）に戻す
        const c = cp - 0x10000;
        s += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      } else {
        s += String.fromCharCode(cp);
      }
    }
    return s;
  }

  function latin1Decode(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function decodeBytes(bytes) {
    return isValidUtf8(bytes) ? utf8Decode(bytes) : latin1Decode(bytes);
  }

  /**
   * データ符号語を文字列に戻す。
   * 知らないモードに出会ったらそこで打ち切る（壊れたQRを掴んだときのため）
   */
  function decodeBitStream(data, version) {
    const br = new BitReader(data);
    let out = "";
    for (;;) {
      if (br.remaining() < 4) break;
      const mode = br.read(4);
      if (mode === 0) break; // 終端

      if (mode === 1) { // 数字
        const n = br.read(numericCountBits(version));
        if (n < 0) return null;
        let i = 0;
        while (i + 3 <= n) {
          const v = br.read(10);
          if (v < 0 || v > 999) return null;
          out += ("00" + v).slice(-3);
          i += 3;
        }
        if (n - i === 2) {
          const v = br.read(7);
          if (v < 0 || v > 99) return null;
          out += ("0" + v).slice(-2);
        } else if (n - i === 1) {
          const v = br.read(4);
          if (v < 0 || v > 9) return null;
          out += String(v);
        }
      } else if (mode === 2) { // 英数字
        const n = br.read(alnumCountBits(version));
        if (n < 0) return null;
        let i = 0;
        while (i + 2 <= n) {
          const v = br.read(11);
          if (v < 0 || v >= 45 * 45) return null;
          out += ALNUM.charAt(Math.floor(v / 45)) + ALNUM.charAt(v % 45);
          i += 2;
        }
        if (i < n) {
          const v = br.read(6);
          if (v < 0 || v >= 45) return null;
          out += ALNUM.charAt(v);
        }
      } else if (mode === 4) { // バイト（UTF-8）
        const n = br.read(byteCountBits(version));
        if (n < 0) return null;
        if (n * 8 > br.remaining()) return null;
        const bytes = new Array(n);
        for (let i = 0; i < n; i++) bytes[i] = br.read(8);
        out += decodeBytes(bytes);
      } else if (mode === 7) { // ECI（文字集合の指定）。読み飛ばす
        const first = br.read(8);
        if (first < 0) return null;
        if ((first & 0x80) === 0) { /* 1バイトで終わり */ }
        else if ((first & 0xc0) === 0x80) br.read(8);
        else br.read(16);
      } else {
        // 漢字モードなど、ここでは扱わないもの。読めた分だけ返す
        break;
      }
    }
    return out.length > 0 ? out : null;
  }

  /* ============================================================
   * 升目（boolean[][]）から文字列へ
   * ========================================================== */

  /**
   * 白黒の並びから中身を読む。
   * @param modules boolean[][]（true が黒）。正方形であること
   * @returns 文字列。読めなければ null
   */
  function fromMatrix(modules) {
    try {
      if (!modules || !modules.length) return null;
      const size = modules.length;
      if ((size - 17) % 4 !== 0) return null;
      const version = (size - 17) / 4;
      if (version < 1 || version > 40) return null;
      for (let y = 0; y < size; y++) {
        if (!modules[y] || modules[y].length !== size) return null;
      }

      const fmt = readFormat(modules, size);
      if (!fmt) return null;

      const isFunc = functionMaskFor(version);

      // アンマスク。渡された盤面を書き換えないよう作り直す
      const grid = new Array(size);
      for (let y = 0; y < size; y++) {
        const row = new Array(size);
        for (let x = 0; x < size; x++) {
          const v = !!modules[y][x];
          row[x] = (!isFunc[y][x] && maskAt(fmt.mask, x, y)) ? !v : v;
        }
        grid[y] = row;
      }

      const words = readCodewords(grid, isFunc, size, version);
      const data = deinterleaveAndCorrect(words, version, fmt.ecLevel);
      if (!data) return null;
      return decodeBitStream(data, version);
    } catch (err) {
      // 読めないのは普通のこと。呼び出し側に例外を出さない
      return null;
    }
  }

  /* ============================================================
   * 画像から升目へ
   * ========================================================== */

  const BLOCK = 8;          // 二値化の区画の一辺（画素）
  const MIN_DYNAMIC = 24;   // これより明暗差が小さい区画は「一様な面」とみなす

  /**
   * 明暗の二値化。画面全体で1つのしきい値にすると、
   * 斜めから撮った写真や片側だけ影になった写真で必ず潰れる。
   * そこで8×8画素の区画ごとにしきい値を決め、さらに周り5×5区画で均して使う
   */
  function binarize(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const lum = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
      // 緑に重みを置いた簡易的な明るさ。人の目に近く、計算も軽い
      lum[i] = (src[p] * 77 + src[p + 1] * 151 + src[p + 2] * 28) >> 8;
    }

    const subW = Math.max(1, Math.ceil(w / BLOCK));
    const subH = Math.max(1, Math.ceil(h / BLOCK));
    const black = new Int32Array(subW * subH);

    for (let by = 0; by < subH; by++) {
      let yoff = by * BLOCK;
      if (yoff + BLOCK > h) yoff = Math.max(0, h - BLOCK);
      for (let bx = 0; bx < subW; bx++) {
        let xoff = bx * BLOCK;
        if (xoff + BLOCK > w) xoff = Math.max(0, w - BLOCK);
        let sum = 0;
        let min = 255;
        let max = 0;
        let n = 0;
        const yLimit = Math.min(h, yoff + BLOCK);
        const xLimit = Math.min(w, xoff + BLOCK);
        for (let y = yoff; y < yLimit; y++) {
          const base = y * w;
          for (let x = xoff; x < xLimit; x++) {
            const v = lum[base + x];
            sum += v;
            n++;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        let avg;
        if (max - min > MIN_DYNAMIC) {
          avg = sum / n;
        } else {
          // 区画の中がほぼ一様（全部白 または 全部黒）。
          // そのまま平均を取ると砂嵐になるので、隣の区画の値を引き継ぐ
          avg = min / 2;
          if (by > 0 && bx > 0) {
            const near = (black[(by - 1) * subW + bx]
              + 2 * black[by * subW + bx - 1]
              + black[(by - 1) * subW + bx - 1]) / 4;
            if (min < near) avg = near;
          }
        }
        black[by * subW + bx] = avg | 0;
      }
    }

    const bits = new Uint8Array(w * h);
    for (let by = 0; by < subH; by++) {
      const y0 = by * BLOCK;
      const yEnd = Math.min(h, y0 + BLOCK);
      for (let bx = 0; bx < subW; bx++) {
        // 周り5×5区画の平均。区画の境目でしきい値が急に変わるのを防ぐ
        let sum = 0;
        let cnt = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = by + dy;
          if (yy < 0 || yy >= subH) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = bx + dx;
            if (xx < 0 || xx >= subW) continue;
            sum += black[yy * subW + xx];
            cnt++;
          }
        }
        const th = sum / cnt;
        const x0 = bx * BLOCK;
        const xEnd = Math.min(w, x0 + BLOCK);
        for (let y = y0; y < yEnd; y++) {
          const base = y * w;
          for (let x = x0; x < xEnd; x++) {
            bits[base + x] = lum[base + x] <= th ? 1 : 0;
          }
        }
      }
    }
    return { data: bits, width: w, height: h };
  }

  function isBlack(bin, x, y) {
    if (x < 0 || y < 0 || x >= bin.width || y >= bin.height) return false;
    return bin.data[y * bin.width + x] === 1;
  }

  function distance(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ---------- 位置検出パターン（3隅の四角）を探す ---------- */

  /** 1:1:3:1:1 の並びかどうか */
  function foundFinderCross(sc) {
    let total = 0;
    for (let i = 0; i < 5; i++) {
      if (sc[i] === 0) return false;
      total += sc[i];
    }
    if (total < 7) return false;
    const mod = total / 7;
    const maxVar = mod / 2;
    return Math.abs(mod - sc[0]) < maxVar
      && Math.abs(mod - sc[1]) < maxVar
      && Math.abs(3 * mod - sc[2]) < 3 * maxVar
      && Math.abs(mod - sc[3]) < maxVar
      && Math.abs(mod - sc[4]) < maxVar;
  }

  function centerFromEnd(sc, end) {
    return end - sc[4] - sc[3] - sc[2] / 2;
  }

  function crossCheckVertical(bin, startI, centerJ, maxCount, originalTotal) {
    const h = bin.height;
    const sc = [0, 0, 0, 0, 0];
    let i = startI;
    while (i >= 0 && isBlack(bin, centerJ, i)) { sc[2]++; i--; }
    if (i < 0) return NaN;
    while (i >= 0 && !isBlack(bin, centerJ, i) && sc[1] <= maxCount) { sc[1]++; i--; }
    if (i < 0 || sc[1] > maxCount) return NaN;
    while (i >= 0 && isBlack(bin, centerJ, i) && sc[0] <= maxCount) { sc[0]++; i--; }
    if (sc[0] > maxCount) return NaN;

    i = startI + 1;
    while (i < h && isBlack(bin, centerJ, i)) { sc[2]++; i++; }
    if (i === h) return NaN;
    while (i < h && !isBlack(bin, centerJ, i) && sc[3] < maxCount) { sc[3]++; i++; }
    if (i === h || sc[3] >= maxCount) return NaN;
    while (i < h && isBlack(bin, centerJ, i) && sc[4] < maxCount) { sc[4]++; i++; }
    if (sc[4] >= maxCount) return NaN;

    const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
    // 横で測った大きさと2割以上ずれていたら、別の模様を掴んでいる
    if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return NaN;
    return foundFinderCross(sc) ? centerFromEnd(sc, i) : NaN;
  }

  function crossCheckHorizontal(bin, startJ, centerI, maxCount, originalTotal) {
    const w = bin.width;
    const sc = [0, 0, 0, 0, 0];
    let j = startJ;
    while (j >= 0 && isBlack(bin, j, centerI)) { sc[2]++; j--; }
    if (j < 0) return NaN;
    while (j >= 0 && !isBlack(bin, j, centerI) && sc[1] <= maxCount) { sc[1]++; j--; }
    if (j < 0 || sc[1] > maxCount) return NaN;
    while (j >= 0 && isBlack(bin, j, centerI) && sc[0] <= maxCount) { sc[0]++; j--; }
    if (sc[0] > maxCount) return NaN;

    j = startJ + 1;
    while (j < w && isBlack(bin, j, centerI)) { sc[2]++; j++; }
    if (j === w) return NaN;
    while (j < w && !isBlack(bin, j, centerI) && sc[3] < maxCount) { sc[3]++; j++; }
    if (j === w || sc[3] >= maxCount) return NaN;
    while (j < w && isBlack(bin, j, centerI) && sc[4] < maxCount) { sc[4]++; j++; }
    if (sc[4] >= maxCount) return NaN;

    const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
    if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return NaN;
    return foundFinderCross(sc) ? centerFromEnd(sc, j) : NaN;
  }

  /**
   * 行を横に走査して 1:1:3:1:1 を見つけ、縦横で確かめてから中心として溜める。
   * 同じ四角には何行ぶんも当たるので、近いものは平均して1つにまとめる
   */
  function findFinderPatterns(bin, rowStep) {
    const w = bin.width;
    const h = bin.height;
    const centers = [];

    function handle(sc, i, j) {
      const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
      const centerJ = centerFromEnd(sc, j);
      const centerI = crossCheckVertical(bin, Math.floor(i), Math.floor(centerJ),
        sc[2] * 2, total);
      if (isNaN(centerI)) return false;
      const centerJ2 = crossCheckHorizontal(bin, Math.floor(centerJ), Math.floor(centerI),
        sc[2] * 2, total);
      if (isNaN(centerJ2)) return false;
      const est = total / 7;
      for (let k = 0; k < centers.length; k++) {
        const c = centers[k];
        if (Math.abs(centerI - c.y) <= c.module && Math.abs(centerJ2 - c.x) <= c.module) {
          const diff = Math.abs(c.module - est);
          if (diff <= 1 || diff <= c.module) {
            // 何度も当たるほど確からしい。当たった回数で重みを付けて平均する
            const n = c.count + 1;
            c.x = (c.count * c.x + centerJ2) / n;
            c.y = (c.count * c.y + centerI) / n;
            c.module = (c.count * c.module + est) / n;
            c.count = n;
            return true;
          }
        }
      }
      centers.push({ x: centerJ2, y: centerI, module: est, count: 1 });
      return true;
    }

    for (let i = rowStep - 1; i < h; i += rowStep) {
      let sc = [0, 0, 0, 0, 0];
      let currentState = 0;
      const base = i * w;
      for (let j = 0; j < w; j++) {
        if (bin.data[base + j] === 1) { // 黒
          if ((currentState & 1) === 1) currentState++;
          sc[currentState]++;
        } else { // 白
          if ((currentState & 1) === 0) {
            if (currentState === 4) {
              if (foundFinderCross(sc) && handle(sc, i, j)) {
                sc = [0, 0, 0, 0, 0];
                currentState = 0;
              } else {
                // 2つぶんずらして、続きから次の候補を探す
                sc = [sc[2], sc[3], sc[4], 1, 0];
                currentState = 3;
              }
            } else {
              currentState++;
              sc[currentState]++;
            }
          } else {
            sc[currentState]++;
          }
        }
      }
      if (currentState === 4 && foundFinderCross(sc)) handle(sc, i, w);
    }
    return centers;
  }

  /** 3つの中心を 左下・左上・右上 に振り分ける */
  function orderFinders(p) {
    const d01 = distance(p[0].x, p[0].y, p[1].x, p[1].y);
    const d12 = distance(p[1].x, p[1].y, p[2].x, p[2].y);
    const d02 = distance(p[0].x, p[0].y, p[2].x, p[2].y);
    let a;
    let b;
    let c;
    // 一番離れている2つが対角。残った1つが左上（直角の頂点）
    if (d12 >= d01 && d12 >= d02) { b = p[0]; a = p[1]; c = p[2]; }
    else if (d02 >= d12 && d02 >= d01) { b = p[1]; a = p[0]; c = p[2]; }
    else { b = p[2]; a = p[0]; c = p[1]; }
    // 外積の向きで、左下と右上のどちらがどちらかを決める
    const cross = (c.x - b.x) * (a.y - b.y) - (c.y - b.y) * (a.x - b.x);
    if (cross < 0) { const t = a; a = c; c = t; }
    return { bottomLeft: a, topLeft: b, topRight: c };
  }

  /* ---------- 1マスの大きさを測る ---------- */

  /**
   * 2点を結ぶ線を辿り、黒→白→黒 と変わるまでの長さを返す（ブレゼンハムの直線）。
   * 位置検出パターンの中心から外へ向かうと、ちょうど3.5マスぶんになる
   */
  function sizeOfRun(bin, fromX, fromY, toX, toY) {
    const steep = Math.abs(toY - fromY) > Math.abs(toX - fromX);
    let fx = fromX;
    let fy = fromY;
    let tx = toX;
    let ty = toY;
    if (steep) {
      let t = fx; fx = fy; fy = t;
      t = tx; tx = ty; ty = t;
    }
    const dx = Math.abs(tx - fx);
    const dy = Math.abs(ty - fy);
    let error = -dx / 2;
    const xstep = fx < tx ? 1 : -1;
    const ystep = fy < ty ? 1 : -1;
    let state = 0;
    const xLimit = tx + xstep;
    let y = fy;
    for (let x = fx; x !== xLimit; x += xstep) {
      const realX = steep ? y : x;
      const realY = steep ? x : y;
      if ((state === 1) === isBlack(bin, realX, realY)) {
        if (state === 2) return distance(x, y, fx, fy);
        state++;
      }
      error += dy;
      if (error > 0) {
        if (y === ty) break;
        y += ystep;
        error -= dx;
      }
    }
    if (state === 2) return distance(tx + xstep, ty, fx, fy);
    return NaN;
  }

  function sizeOfRunBothWays(bin, fromX, fromY, toX, toY) {
    let result = sizeOfRun(bin, fromX, fromY, toX, toY);
    // 反対側にも同じだけ辿る。画像の外に出るときは向きを保ったまま縮める
    let scale = 1;
    let otherToX = fromX - (toX - fromX);
    if (otherToX < 0) {
      scale = fromX / (fromX - otherToX);
      otherToX = 0;
    } else if (otherToX >= bin.width) {
      scale = (bin.width - 1 - fromX) / (otherToX - fromX);
      otherToX = bin.width - 1;
    }
    let otherToY = Math.floor(fromY - (toY - fromY) * scale);
    scale = 1;
    if (otherToY < 0) {
      scale = fromY / (fromY - otherToY);
      otherToY = 0;
    } else if (otherToY >= bin.height) {
      scale = (bin.height - 1 - fromY) / (otherToY - fromY);
      otherToY = bin.height - 1;
    }
    otherToX = Math.floor(fromX + (otherToX - fromX) * scale);
    result += sizeOfRun(bin, fromX, fromY, otherToX, otherToY);
    return result - 1; // 中心の1画素を二重に数えているぶんを引く
  }

  function moduleSizeOneWay(bin, a, b) {
    const e1 = sizeOfRunBothWays(bin, Math.floor(a.x), Math.floor(a.y),
      Math.floor(b.x), Math.floor(b.y));
    const e2 = sizeOfRunBothWays(bin, Math.floor(b.x), Math.floor(b.y),
      Math.floor(a.x), Math.floor(a.y));
    if (isNaN(e1)) return e2 / 7;
    if (isNaN(e2)) return e1 / 7;
    return (e1 + e2) / 14;
  }

  /* ---------- 位置合わせパターン（右下の小さな四角）を探す ---------- */

  /**
   * 1本の線の上で「黒・白・黒・白・黒（各1マス）」を探し、
   * 真ん中の黒の中心を **すべて** 返す。
   * データの中にも同じ並びは何度も出るので、最初の1つで打ち切ると本物を取り逃す。
   * horizontal が true なら fixed は y、false なら fixed は x
   */
  function scanFivePattern(bin, from, to, fixed, moduleSize, horizontal) {
    const runs = [];
    let cur = -1;
    let runStart = from;
    for (let p = from; p <= to; p++) {
      const b = (horizontal ? isBlack(bin, p, fixed) : isBlack(bin, fixed, p)) ? 1 : 0;
      if (b !== cur) {
        if (cur >= 0) runs.push({ black: cur === 1, start: runStart, len: p - runStart });
        cur = b;
        runStart = p;
      }
    }
    if (cur >= 0) runs.push({ black: cur === 1, start: runStart, len: to + 1 - runStart });

    const found = [];
    const lo = moduleSize * 0.5;
    const hi = moduleSize * 1.8;
    for (let i = 0; i + 4 < runs.length; i++) {
      if (!runs[i].black || runs[i + 1].black || !runs[i + 2].black
        || runs[i + 3].black || !runs[i + 4].black) continue;
      // 外側の黒（i と i+4）は長さを見ない。
      // 位置合わせパターンの外周は周りのデータのマスと繋がって伸びるのが普通で、
      // ここに上限を付けると本物を取りこぼす
      if (runs[i].len < lo || runs[i + 4].len < lo) continue;
      let ok = true;
      for (let k = 1; k <= 3; k++) {
        const len = runs[i + k].len;
        if (len < lo || len > hi) { ok = false; break; }
      }
      if (!ok) continue;
      found.push({
        c: runs[i + 2].start + runs[i + 2].len / 2,
        // その場の1マスの大きさ。斜めの写真では場所によって伸び縮みするので、
        // 全体の平均ではなくここで測った値を形の確認に使う
        w: (runs[i + 1].len + runs[i + 2].len + runs[i + 3].len) / 3
      });
    }
    return found;
  }

  /** 候補の中から目当ての位置に一番近いものを選ぶ（無ければ null） */
  function nearestTo(list, target, limit) {
    let best = null;
    let bestD = limit;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(list[i].c - target);
      if (d <= bestD) { bestD = d; best = list[i]; }
    }
    return best;
  }

  /**
   * 候補の周り5×5マスが本当に位置合わせパターンの形かを確かめる。
   * 外周が黒・その内側の輪が白・中心が黒。
   * ex, ey は「1マス右」「1マス下」に相当する画像上のベクトル。
   * データの中にも 黒白黒白黒 の並びは山ほど出るので、この確認が無いと誤検出する
   */
  function verifyAlignmentShape(bin, cx, cy, ex, ey) {
    let hit = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = Math.round(cx + dx * ex.x + dy * ey.x);
        const py = Math.round(cy + dx * ex.y + dy * ey.y);
        const want = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
        if (isBlack(bin, px, py) === want) hit++;
      }
    }
    return hit >= 23; // 25マス中2マスまでの食い違いは許す（画素の丸め誤差ぶん）
  }

  /**
   * 位置合わせパターンの候補を探し、見当を付けた場所に近い順で返す。
   *
   * なぜ1つに絞らないか:
   *   斜めから撮るほど「見当」は実際の位置からずれる。
   *   ずれが大きいと、データの中のそれらしい模様の方が近くなることがある。
   *   どれが本物かは、実際に読んでみて誤り訂正が通るかで決めるのが確実
   */
  function findAlignment(bin, estX, estY, allowance, moduleSize, ex, ey, limit, deadline) {
    const startX = Math.max(0, Math.floor(estX - allowance));
    const endX = Math.min(bin.width - 1, Math.ceil(estX + allowance));
    const startY = Math.max(0, Math.floor(estY - allowance));
    const endY = Math.min(bin.height - 1, Math.ceil(estY + allowance));
    if (endX - startX < moduleSize * 5 || endY - startY < moduleSize * 5) return [];

    const found = [];
    for (let y = startY; y <= endY; y++) {
      // 探す窓が広いと1回が長くなるので、ここでも時間を見る
      if ((y & 15) === 0 && deadline && Date.now() > deadline) break;
      const hits = scanFivePattern(bin, startX, endX, y, moduleSize, true);
      for (let k = 0; k < hits.length; k++) {
        const hx = hits[k].c;
        // 縦にも同じ並びが出るか確かめる（横だけだと別の模様に当たる）
        const v = nearestTo(
          scanFivePattern(bin, startY, endY, Math.round(hx), moduleSize, false),
          y, moduleSize);
        if (v === null) continue;
        const h = nearestTo(
          scanFivePattern(bin, startX, endX, Math.round(v.c), moduleSize, true),
          hx, moduleSize);
        if (h === null) continue;
        // その場で測った1マスの大きさに合わせて、確認に使う歩幅を伸び縮みさせる
        const s = ((h.w + v.w) / 2) / moduleSize;
        const lex = { x: ex.x * s, y: ex.y * s };
        const ley = { x: ey.x * s, y: ey.y * s };
        if (!verifyAlignmentShape(bin, h.c, v.c, lex, ley)) continue;
        const dd = (h.c - estX) * (h.c - estX) + (v.c - estY) * (v.c - estY);
        // 同じ場所を何度も拾うので、近すぎるものはまとめる
        let dup = false;
        for (let m = 0; m < found.length; m++) {
          if (Math.abs(found[m].x - h.c) <= moduleSize
            && Math.abs(found[m].y - v.c) <= moduleSize) { dup = true; break; }
        }
        if (dup) continue;
        found.push({ x: h.c, y: v.c, d: dd });
      }
    }
    found.sort(function (a, b) { return a.d - b.d; });
    return found.slice(0, limit || 8);
  }

  /* ---------- 射影変換 ---------- */

  /**
   * 単位正方形(0,0)-(1,1)を4点に写す変換。
   * 斜めから撮ると四角が台形になるので、拡大縮小と回転だけでは足りない
   */
  function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
    const dx3 = x0 - x1 + x2 - x3;
    const dy3 = y0 - y1 + y2 - y3;
    if (dx3 === 0 && dy3 === 0) {
      // 平行四辺形（＝台形にならない）なら素直な一次変換でよい
      return {
        a11: x1 - x0, a21: x2 - x1, a31: x0,
        a12: y1 - y0, a22: y2 - y1, a32: y0,
        a13: 0, a23: 0, a33: 1
      };
    }
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    const a13 = (dx3 * dy2 - dx2 * dy3) / den;
    const a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return {
      a11: x1 - x0 + a13 * x1, a21: x3 - x0 + a23 * x3, a31: x0,
      a12: y1 - y0 + a13 * y1, a22: y3 - y0 + a23 * y3, a32: y0,
      a13: a13, a23: a23, a33: 1
    };
  }

  /** 逆行列の代わりの余因子行列。射影変換は定数倍しても同じ写像なのでこれでよい */
  function adjoint(t) {
    return {
      a11: t.a22 * t.a33 - t.a23 * t.a32,
      a21: t.a23 * t.a31 - t.a21 * t.a33,
      a31: t.a21 * t.a32 - t.a22 * t.a31,
      a12: t.a13 * t.a32 - t.a12 * t.a33,
      a22: t.a11 * t.a33 - t.a13 * t.a31,
      a32: t.a12 * t.a31 - t.a11 * t.a32,
      a13: t.a12 * t.a23 - t.a13 * t.a22,
      a23: t.a13 * t.a21 - t.a11 * t.a23,
      a33: t.a11 * t.a22 - t.a12 * t.a21
    };
  }

  function times(t, o) {
    return {
      a11: t.a11 * o.a11 + t.a21 * o.a12 + t.a31 * o.a13,
      a21: t.a11 * o.a21 + t.a21 * o.a22 + t.a31 * o.a23,
      a31: t.a11 * o.a31 + t.a21 * o.a32 + t.a31 * o.a33,
      a12: t.a12 * o.a11 + t.a22 * o.a12 + t.a32 * o.a13,
      a22: t.a12 * o.a21 + t.a22 * o.a22 + t.a32 * o.a23,
      a32: t.a12 * o.a31 + t.a22 * o.a32 + t.a32 * o.a33,
      a13: t.a13 * o.a11 + t.a23 * o.a12 + t.a33 * o.a13,
      a23: t.a13 * o.a21 + t.a23 * o.a22 + t.a33 * o.a23,
      a33: t.a13 * o.a31 + t.a23 * o.a32 + t.a33 * o.a33
    };
  }

  /** 升目の座標 → 画像の座標 の変換を作る */
  function quadToQuad(g, im) {
    const qToS = adjoint(squareToQuad(g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7]));
    const sToQ = squareToQuad(im[0], im[1], im[2], im[3], im[4], im[5], im[6], im[7]);
    return times(sToQ, qToS);
  }

  function applyTransform(t, x, y) {
    const den = t.a13 * x + t.a23 * y + t.a33;
    return {
      x: (t.a11 * x + t.a21 * y + t.a31) / den,
      y: (t.a12 * x + t.a22 * y + t.a32) / den
    };
  }

  /**
   * 変換を使って dim×dim の升目を取り出す。
   * 各マスの中心（+0.5）を見る。画像の外に出たら失敗
   */
  function sampleGrid(bin, dim, t) {
    const modules = new Array(dim);
    for (let y = 0; y < dim; y++) {
      const row = new Array(dim);
      for (let x = 0; x < dim; x++) {
        const p = applyTransform(t, x + 0.5, y + 0.5);
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        if (px < 0 || py < 0 || px >= bin.width || py >= bin.height) return null;
        row[x] = bin.data[py * bin.width + px] === 1;
      }
      modules[y] = row;
    }
    return modules;
  }

  /* ---------- 3隅が決まったあとの読み取り ---------- */

  // 1回の読み取りに使ってよい時間の上限（ミリ秒）。
  // カメラの毎フレームで呼ぶので、読めない絵に粘るより早く諦めて次の絵を見る方がよい
  const TIME_BUDGET_MS = 400;

  function detectAndDecode(bin, f, deadline) {
    const tl = f.topLeft;
    const tr = f.topRight;
    const bl = f.bottomLeft;

    let moduleSize = (moduleSizeOneWay(bin, tl, tr) + moduleSizeOneWay(bin, tl, bl)) / 2;
    if (isNaN(moduleSize) || !(moduleSize > 0)) {
      moduleSize = (tl.module + tr.module + bl.module) / 3;
    }
    if (!(moduleSize >= 1)) return null;

    // 位置検出パターンの中心どうしは（一辺 - 7）マスぶん離れている
    const across = distance(tl.x, tl.y, tr.x, tr.y) / moduleSize;
    const down = distance(tl.x, tl.y, bl.x, bl.y) / moduleSize;
    let dim = Math.round((across + down) / 2) + 7;
    // 一辺は必ず 4の倍数+1。近い方へ寄せる
    dim = dim - ((dim - 1) % 4);

    // 1マスの大きさの見積もりには誤差があるので、近い一辺を順に試す。
    // 間違った一辺は形式情報か誤り訂正で必ず落ちるため、通ったものが正しい
    const offsets = [0, 4, -4, 8, -8, 12, -12, 16, -16];
    for (let oi = 0; oi < offsets.length; oi++) {
      if (Date.now() > deadline) return null; // 時間切れ。次の絵に回す
      const d = dim + offsets[oi];
      if (d < 21 || d > 177 || (d - 1) % 4 !== 0) continue;

      // 右下の角。位置合わせパターンが見つかればそれを使う（斜めの写真で効く）。
      // 見つからなければ3隅から平行四辺形として当てる
      const brX = tr.x - tl.x + bl.x;
      const brY = tr.y - tl.y + bl.y;
      const candidates = [];
      if (d >= 25) { // 版2以上には位置合わせパターンがある
        // 「1マス右」「1マス下」に相当する画像上のベクトル。形の確認に使う
        const ex = { x: (tr.x - tl.x) / (d - 7), y: (tr.y - tl.y) / (d - 7) };
        const ey = { x: (bl.x - tl.x) / (d - 7), y: (bl.y - tl.y) / (d - 7) };
        const corr = 1 - 3 / (d - 7);
        const estX = tl.x + corr * (brX - tl.x);
        const estY = tl.y + corr * (brY - tl.y);
        for (let a = 4; a <= 16; a <<= 1) {
          const aps = findAlignment(bin, estX, estY, a * moduleSize, moduleSize,
            ex, ey, 8, deadline);
          if (aps.length) {
            for (let m = 0; m < aps.length; m++) candidates.push(aps[m]);
            break;
          }
        }
      }
      candidates.push(null); // 位置合わせパターン無しの読み方も必ず試す

      for (let ci = 0; ci < candidates.length; ci++) {
        if (Date.now() > deadline) return null;
        const ap = candidates[ci];
        const gx = ap ? d - 6.5 : d - 3.5;
        const ix = ap ? ap.x : brX;
        const iy = ap ? ap.y : brY;
        const t = quadToQuad(
          [3.5, 3.5, d - 3.5, 3.5, gx, gx, 3.5, d - 3.5],
          [tl.x, tl.y, tr.x, tr.y, ix, iy, bl.x, bl.y]
        );
        const modules = sampleGrid(bin, d, t);
        if (!modules) continue;
        const text = fromMatrix(modules);
        if (text !== null) return text;
      }
    }
    return null;
  }

  /**
   * カメラや画像から読む。
   * @param imageData canvas の getImageData() が返すもの（{data, width, height}）
   * @returns 読めた文字列。読めなければ null（例外は投げない）
   */
  function fromImageData(imageData) {
    try {
      if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
        return null;
      }
      const deadline = Date.now() + TIME_BUDGET_MS;
      const bin = binarize(imageData);

      // 大きい画像で全行を走査すると遅いので、まず間引いて探す。
      // 位置検出パターンは最低でも7マスあるので、数行飛ばしても当たる。
      // 空振りしたときだけ全行を見る（読めないことより遅いことの方が困る）
      const steps = [Math.max(1, Math.floor(bin.height / 240)), 1];
      let lastStep = -1;
      for (let si = 0; si < steps.length; si++) {
        const step = steps[si];
        if (step === lastStep) continue;
        lastStep = step;
        const centers = findFinderPatterns(bin, step);
        if (centers.length < 3) continue;
        // 何度も当たったものほど確からしい。上位を組み合わせて試す
        centers.sort(function (a, b) { return b.count - a.count; });
        const top = centers.slice(0, 6);
        for (let i = 0; i < top.length; i++) {
          for (let j = i + 1; j < top.length; j++) {
            for (let k = j + 1; k < top.length; k++) {
              if (Date.now() > deadline) return null;
              const text = detectAndDecode(bin, orderFinders([top[i], top[j], top[k]]),
                deadline);
              if (text !== null) return text;
            }
          }
        }
      }
      return null;
    } catch (err) {
      // カメラの毎フレームで呼ぶので、何があっても落とさない
      return null;
    }
  }

  return {
    fromImageData: fromImageData,
    fromMatrix: fromMatrix,
    // 以下は検証用に見せている（画面側からは使わない）
    binarize: binarize,
    sizeOf: sizeOf,
    totalCodewords: totalCodewords,
    maskAt: maskAt,
    rsDecode: rsDecode
  };
})();
