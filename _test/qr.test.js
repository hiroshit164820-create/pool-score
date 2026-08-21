/**
 * qr.test.js — QRコード符号化（js/qr.js）の検証
 * 実行: node _test/qr.test.js
 *
 * 「作った本人の理屈」で答え合わせしても意味がないので、
 *   1. 規格の表（位置合わせパターンの座標・入る文字数）と突き合わせる
 *   2. 規格の既知の例（ISO/IEC 18004 の「01234567」）と突き合わせる
 *   3. このファイルの中に読み取り側を別に書いて、元の文字列に戻るか見る
 * の3通りで確かめる。3は符号化と復号で同じ間違いをしない限り通らない。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const QR = vm.runInNewContext(
  fs.readFileSync(path.join(ROOT, "js/qr.js"), "utf8") + "\n;QRCODE;",
  { console: console, Math: Math, JSON: JSON },
  { filename: "qr.js" }
);

let pass = 0;
let fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(label + "\n    期待: " + e + "\n    実際: " + a);
  }
}

function ok(cond, label) {
  eq(!!cond, true, label);
}

function section(name) {
  console.log("\n── " + name + " ──");
}

/* ============================================================
 * 読み取り側（検証専用）
 * qr.js の内部関数は使わず、規格の手順をこのファイルで別に書く。
 * 使うのは「1ブロックあたりの訂正符号語数」「ブロック数」の表だけ
 * （この2つは規格の表そのもので、計算では出せない）
 * ========================================================== */

// 位置合わせパターンの中心座標（ISO/IEC 18004 附属書E の表をそのまま書き写したもの）
const ALIGN_TABLE = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62],
  14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
  17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98], 23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110], 26: [6, 30, 58, 86, 114],
  27: [6, 34, 62, 90, 118],
  28: [6, 26, 50, 74, 98, 122], 29: [6, 30, 54, 78, 102, 126], 30: [6, 26, 52, 78, 104, 130],
  31: [6, 30, 56, 82, 108, 134], 32: [6, 34, 60, 86, 112, 138], 33: [6, 30, 58, 86, 114, 142],
  34: [6, 34, 62, 90, 118, 146],
  35: [6, 30, 54, 78, 102, 126, 150], 36: [6, 24, 50, 76, 102, 128, 154],
  37: [6, 28, 54, 80, 106, 132, 158], 38: [6, 32, 58, 84, 110, 136, 162],
  39: [6, 26, 54, 82, 110, 138, 166], 40: [6, 30, 58, 86, 114, 142, 170]
};

const ALNUM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const EC_BY_BITS = { 1: "L", 0: "M", 3: "Q", 2: "H" };

function maskFn(mask, x, y) {
  if (mask === 0) return (x + y) % 2 === 0;
  if (mask === 1) return y % 2 === 0;
  if (mask === 2) return x % 3 === 0;
  if (mask === 3) return (x + y) % 3 === 0;
  if (mask === 4) return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
  if (mask === 5) return ((x * y) % 2) + ((x * y) % 3) === 0;
  if (mask === 6) return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
  return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
}

/** 機能パターンの位置（データが入らないマス）を規格どおりに組み立てる */
function functionMap(version) {
  const size = 17 + 4 * version;
  const f = [];
  for (let y = 0; y < size; y++) {
    f.push(new Array(size).fill(false));
  }
  function mark(x, y) {
    if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = true;
  }
  // 位置検出パターン＋分離帯（8×8）
  const corners = [[0, 0], [size - 8, 0], [0, size - 8]];
  corners.forEach(function (c) {
    for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) mark(c[0] + dx, c[1] + dy);
  });
  // タイミングパターン
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // 位置合わせパターン
  const pos = ALIGN_TABLE[version];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === pos.length - 1)
        || (i === pos.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(pos[j] + dx, pos[i] + dy);
    }
  }
  // 形式情報
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8);
  for (let i = 0; i < 8; i++) mark(8, size - 1 - i);
  // 型番情報（版7以上）
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  }
  return f;
}

/** 形式情報15ビットを読み、訂正レベルとマスク番号を取り出す */
function readFormat(modules) {
  const bits = [];
  for (let i = 0; i <= 5; i++) bits[i] = modules[i][8];
  bits[6] = modules[7][8];
  bits[7] = modules[8][8];
  bits[8] = modules[8][7];
  for (let i = 9; i < 15; i++) bits[i] = modules[8][14 - i];
  let v = 0;
  for (let i = 0; i < 15; i++) if (bits[i]) v |= (1 << i);
  const data = (v ^ 0x5412) >> 10;
  return { ecLevel: EC_BY_BITS[data >> 3], mask: data & 7 };
}

/** 右下から2列ずつ、上下に折り返しながら符号語を読み出す */
function readCodewords(modules, isFunc, size) {
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFunc[y][x]) continue;
        bits.push(modules[y][x] ? 1 : 0);
      }
    }
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j];
    words.push(w);
  }
  return words;
}

/** 並べ替えを元に戻して、データ符号語だけを取り出す */
function deinterleave(words, version, ecLevel) {
  const numBlocks = QR.EC_BLOCKS[ecLevel][version];
  const ecLen = QR.EC_CODEWORDS_PER_BLOCK[ecLevel][version];
  const dataLen = words.length - ecLen * numBlocks;
  const shortLen = Math.floor(dataLen / numBlocks);
  const numLong = dataLen % numBlocks;

  const lens = [];
  for (let b = 0; b < numBlocks; b++) lens.push(shortLen + (b >= numBlocks - numLong ? 1 : 0));

  const blocks = [];
  for (let b = 0; b < numBlocks; b++) blocks.push([]);
  let k = 0;
  for (let i = 0; i <= shortLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < lens[b]) blocks[b].push(words[k++]);
    }
  }
  let out = [];
  for (let b = 0; b < numBlocks; b++) out = out.concat(blocks[b]);
  return out;
}

/** データ符号語を文字列に戻す（数字・英数字・バイトの3モードに対応） */
function decodeData(words, version) {
  const bits = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = 7; j >= 0; j--) bits.push((words[i] >> j) & 1);
  }
  let p = 0;
  function take(n) {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bits[p++];
    return v;
  }
  const mode = take(4);
  if (mode === 1) { // 数字モード
    const n = take(version <= 9 ? 10 : (version <= 26 ? 12 : 14));
    let s = "";
    let left = n;
    while (left >= 3) { s += String(take(10)).padStart(3, "0"); left -= 3; }
    if (left === 2) s += String(take(7)).padStart(2, "0");
    if (left === 1) s += String(take(4));
    return { mode: "numeric", text: s };
  }
  if (mode === 2) { // 英数字モード
    const n = take(version <= 9 ? 9 : (version <= 26 ? 11 : 13));
    let s = "";
    let left = n;
    while (left >= 2) {
      const v = take(11);
      s += ALNUM_CHARS.charAt(Math.floor(v / 45)) + ALNUM_CHARS.charAt(v % 45);
      left -= 2;
    }
    if (left === 1) s += ALNUM_CHARS.charAt(take(6));
    return { mode: "alnum", text: s };
  }
  if (mode === 4) { // バイトモード（UTF-8）
    const n = take(version <= 9 ? 8 : 16);
    const bytes = [];
    for (let i = 0; i < n; i++) bytes.push(take(8));
    return { mode: "byte", text: Buffer.from(bytes).toString("utf8") };
  }
  throw new Error("知らないモード: " + mode);
}

/** 生成された行列を読み取って、元の文字列に戻す */
function readQR(qr) {
  const size = qr.modules.length;
  const version = (size - 17) / 4;
  const fmt = readFormat(qr.modules);
  const isFunc = functionMap(version);
  // マスクを外す
  const m = qr.modules.map(function (row) { return row.slice(); });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunc[y][x] && maskFn(fmt.mask, x, y)) m[y][x] = !m[y][x];
    }
  }
  const words = readCodewords(m, isFunc, size);
  const data = deinterleave(words, version, fmt.ecLevel);
  const r = decodeData(data, version);
  return { version: version, ecLevel: fmt.ecLevel, mask: fmt.mask, mode: r.mode, text: r.text };
}

/* ============================================================ */
section("1. 構造（大きさ・位置検出パターン・タイミングパターン）");
{
  [1, 2, 7, 20, 40].forEach(function (v) {
    const qr = QR.make("TEST 123", { ecLevel: "L", minVersion: v, maxVersion: v });
    eq(qr.version, v, "版" + v + "を指定したら版" + v + "になる");
    eq(qr.size, 21 + 4 * (v - 1), "版" + v + "の一辺は " + (21 + 4 * (v - 1)) + " マス");
    eq(qr.modules.length, qr.size, "版" + v + ": 行数が size と一致");
    eq(qr.modules[0].length, qr.size, "版" + v + ": 列数が size と一致");

    const size = qr.size;
    // 3隅の位置検出パターン（7×7の二重四角）と、その外側の分離帯（白）
    const corners = [[0, 0], [size - 7, 0], [0, size - 7]];
    let finderOk = true;
    corners.forEach(function (c) {
      for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          if (qr.modules[c[1] + dy][c[0] + dx] !== (d !== 2)) finderOk = false;
        }
      }
    });
    ok(finderOk, "版" + v + ": 3隅の位置検出パターンが規格どおり");

    // 右下の隅には位置検出パターンが無い（あると向きが分からなくなる）
    let bottomRightDark = 0;
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) if (qr.modules[size - 7 + dy][size - 7 + dx]) bottomRightDark++;
    }
    ok(bottomRightDark !== 33, "版" + v + ": 右下に位置検出パターンは無い");

    // タイミングパターン（6行目・6列目が白黒交互）
    let timingOk = true;
    for (let i = 8; i < size - 8; i++) {
      if (qr.modules[6][i] !== (i % 2 === 0)) timingOk = false;
      if (qr.modules[i][6] !== (i % 2 === 0)) timingOk = false;
    }
    ok(timingOk, "版" + v + ": タイミングパターンが白黒交互");

    // 常に黒のマス
    ok(qr.modules[size - 8][8] === true, "版" + v + ": 固定の黒マスがある");
  });

  // 位置合わせパターンの座標が規格の表と一致するか（版1〜40すべて）
  let alignOk = true;
  const alignNg = [];
  for (let v = 1; v <= 40; v++) {
    const got = QR.alignPositions(v);
    if (JSON.stringify(got) !== JSON.stringify(ALIGN_TABLE[v])) {
      alignOk = false;
      alignNg.push("版" + v + " 期待" + JSON.stringify(ALIGN_TABLE[v]) + " 実際" + JSON.stringify(got));
    }
  }
  eq(alignNg, [], "位置合わせパターンの座標が規格の表と一致（版1〜40）");
  ok(alignOk, "位置合わせパターンの表と一致（まとめ）");

  // 版40で位置合わせパターンが実際に置かれているか（中心が黒・その周りが白）
  {
    const qr = QR.make("TEST", { ecLevel: "L", minVersion: 40, maxVersion: 40 });
    const c = 30; // 版40の2番目の中心
    let apOk = qr.modules[c][c] === true;
    for (let d = -1; d <= 1; d++) {
      if (d !== 0 && qr.modules[c + d][c] !== false) apOk = false;
    }
    for (let d = -2; d <= 2; d++) {
      if (qr.modules[c - 2][c + d] !== true) apOk = false;
    }
    ok(apOk, "版40: 位置合わせパターンが (30,30) に置かれている");
  }
}

/* ============================================================ */
section("2. 規格の既知の例との答え合わせ");
{
  /*
   * ISO/IEC 18004（JIS X 0510）の例: 「01234567」を版1・訂正レベルM で符号化。
   * 規格に載っているデータ符号語16個と、リード・ソロモン訂正符号語10個。
   * このモジュールは数字モードを持たない（英数字とバイトの2つ）ので、
   * 規格のデータ符号語を入力として与え、訂正符号語が一致するかで確かめる。
   */
  const ISO_DATA = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80,
    0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  const ISO_EC = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];

  // 版1は1ブロックなので、interleave の結果は「データ→訂正符号」の順に並ぶ
  const got = QR.interleave(ISO_DATA, 1, "M");
  eq(got.slice(0, 16), ISO_DATA, "規格の例: データ符号語がそのまま並ぶ（版1・M）");
  eq(got.slice(16), ISO_EC, "規格の例: リード・ソロモン訂正符号語10個が規格の値と一致");

  // 規格の例の行列に組み直して読み戻せるか（数字モードのまま復号できる）
  eq(QR.dataCodewords(1, "M"), 16, "版1・M のデータ符号語は16個");
  eq(QR.totalCodewords(1), 26, "版1の総符号語数は26");
  eq(decodeData(ISO_DATA, 1).text, "01234567", "規格の例のデータ符号語は「01234567」に戻る");

  /*
   * 英数字モードの既知の例:「HELLO WORLD」を版1・訂正レベルQ で符号化したときの
   * データ符号語13個（規格の手順どおりに手で組み立てても同じ値になる）
   */
  const HW = QR.buildBits("HELLO WORLD", "alnum", 1, "Q");
  eq(HW, [0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d, 0x43, 0x40, 0xec, 0x11, 0xec],
    "英数字モードの例: 「HELLO WORLD」版1・Q のデータ符号語");
  eq(QR.dataCodewords(1, "Q"), 13, "版1・Q のデータ符号語は13個");
}

/* ============================================================ */
section("3. 入る文字数（規格の容量表との突き合わせ）");
{
  const table = [
    // [版, レベル, 英数字, バイト]
    [1, "L", 25, 17], [1, "M", 20, 14], [1, "Q", 16, 11], [1, "H", 10, 7],
    [2, "L", 47, 32], [10, "L", 395, 271],
    [40, "L", 4296, 2953], [40, "M", 3391, 2331],
    [40, "Q", 2420, 1663], [40, "H", 1852, 1273]
  ];
  table.forEach(function (t) {
    const c = QR.capacity(t[1], t[0]);
    eq(c.alnum, t[2], "版" + t[0] + "・" + t[1] + " の英数字モードは " + t[2] + "文字");
    eq(c.byte, t[3], "版" + t[0] + "・" + t[1] + " のバイトモードは " + t[3] + "バイト");
  });
  eq(QR.capacity("L").version, 40, "capacity() は既定で版40を返す");
  eq(QR.capacity().ecLevel, "L", "capacity() は既定でレベルLを返す");
}

/* ============================================================ */
section("4. 読み戻し（生成した行列から元の文字列に戻る）");
{
  const cases = [
    ["HTTPS://EXAMPLE.COM/POOL", "alnum", "英数字モード"],
    ["https://example.com/pool-score/#m=1.g.abcDEF_-123", "byte", "バイトモード（小文字を含むURL）"],
    ["山田 対 佐藤　JPA9ボール 5-3 ★", "byte", "日本語を含む文字列"]
  ];
  cases.forEach(function (c) {
    ["L", "M", "Q", "H"].forEach(function (lv) {
      const qr = QR.make(c[0], { ecLevel: lv });
      const back = readQR(qr);
      eq(back.text, c[0], c[2] + "・レベル" + lv + ": 読み戻して元に戻る");
      eq(back.mode, c[1], c[2] + "・レベル" + lv + ": モードの選び方");
      eq(back.version, qr.version, c[2] + "・レベル" + lv + ": 形式情報から読める版");
      eq(back.ecLevel, lv, c[2] + "・レベル" + lv + ": 形式情報から読める訂正レベル");
      eq(back.mask, qr.mask, c[2] + "・レベル" + lv + ": 形式情報から読めるマスク番号");
      ok(qr.mask >= 0 && qr.mask <= 7, c[2] + "・レベル" + lv + ": マスク番号は0〜7");
    });
  });

  // ブロック分割が起きる大きさでも戻るか（版が上がるとブロックが複数になる）
  [5, 10, 20, 30, 40].forEach(function (v) {
    const len = Math.min(QR.capacity("L", v).alnum, 40 + v * 30);
    let s = "";
    for (let i = 0; i < len; i++) s += ALNUM_CHARS.charAt((i * 7 + v) % 45);
    const qr = QR.make(s, { ecLevel: "L", minVersion: v, maxVersion: v });
    eq(readQR(qr).text, s, "版" + v + "（" + len + "文字・" + QR.EC_BLOCKS.L[v] + "ブロック）で読み戻せる");
  });
}

/* ============================================================ */
section("5. このアプリで使う長さ（共有リンクのURL）");
{
  // share.js が作るリンクに近い形（英数字モードで通る文字だけのURL）
  // 「#」「=」は英数字モードに無い文字なので、リンクのその部分は入れずに長さだけ合わせる
  let url = "HTTPS://EXAMPLE.COM/POOL-SCORE/M.1.G.";
  const body = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$%*+-./:";
  while (url.length < 1200) url += body;
  url = url.slice(0, 1200);
  eq(url.length, 1200, "検証に使うURL風の文字列は1,200文字");

  const qr = QR.make(url, { ecLevel: "L" });
  ok(QR.isAlnumOnly(url), "1,200文字のURL風文字列は英数字モードで通る");
  eq(qr.mode, "alnum", "1,200文字: 英数字モードが選ばれる");
  ok(qr.version <= 40, "1,200文字: 版40以内に収まる（実際は版" + qr.version + "）");
  eq(qr.size, 17 + 4 * qr.version, "1,200文字: 一辺は " + qr.size + " マス");
  eq(readQR(qr).text, url, "1,200文字: 読み戻して元に戻る");

  // 版40を明示しても作れる（このアプリの上限側の確認）
  const qr40 = QR.make(url, { ecLevel: "L", minVersion: 40, maxVersion: 40 });
  eq(qr40.version, 40, "1,200文字を版40で作れる");
  eq(qr40.size, 177, "版40の一辺は177マス");
  eq(readQR(qr40).text, url, "版40でも読み戻して元に戻る");

  // 上限ちょうど（版40・L・英数字 4,296文字）
  let max = "";
  for (let i = 0; i < 4296; i++) max += ALNUM_CHARS.charAt(i % 45);
  const qrMax = QR.make(max, { ecLevel: "L" });
  eq(qrMax.version, 40, "上限4,296文字は版40になる");
  eq(readQR(qrMax).text, max, "上限4,296文字でも読み戻して元に戻る");

  // 2,000文字（share.js の実測上限に近い長さ）
  const qr2000 = QR.make(max.slice(0, 2000), { ecLevel: "L" });
  ok(qr2000.version <= 40, "2,000文字も版40以内（実際は版" + qr2000.version + "）");
  eq(readQR(qr2000).text, max.slice(0, 2000), "2,000文字でも読み戻せる");

  console.log("  [実測] 1,200文字 → 版" + qr.version + " / " + qr.size + "×" + qr.size
    + "マス（" + (qr.size * qr.size) + "マス）/ マスク" + qr.mask);
  console.log("  [実測] 版40・レベルLの上限 → 英数字 " + QR.capacity("L", 40).alnum
    + "文字 / バイト " + QR.capacity("L", 40).byte + "バイト");
  console.log("  [実測] 2,000文字 → 版" + qr2000.version + " / " + qr2000.size + "×" + qr2000.size + "マス");
}

/* ============================================================ */
section("6. 入りきらないときの知らせ方");
{
  function catchMsg(fn) {
    try { fn(); return null; } catch (e) { return e.message; }
  }

  let over = "";
  for (let i = 0; i < 4297; i++) over += "A";
  const m1 = catchMsg(function () { QR.make(over, { ecLevel: "L" }); });
  ok(m1 !== null, "上限を1文字超えたら例外になる");
  ok(m1 && m1.indexOf("入りきりません") >= 0, "例外の文が日本語で「入りきりません」と伝える");
  ok(m1 && m1.indexOf("4296") >= 0, "例外の文に上限（4296）が入っている");
  ok(m1 && m1.indexOf("4297") >= 0, "例外の文に実際の長さ（4297）が入っている");

  const m2 = catchMsg(function () { QR.make(over, { ecLevel: "H" }); });
  ok(m2 && m2.indexOf("訂正レベルH") >= 0, "レベルHのときは例外の文にHと出る");

  // 版を小さく指定したときも入らない
  const m3 = catchMsg(function () { QR.make("HELLO WORLD 1234567890", { minVersion: 1, maxVersion: 1, ecLevel: "H" }); });
  ok(m3 && m3.indexOf("入りきりません") >= 0, "版を1に限ると入らず例外になる");

  // 日本語（バイトモード）で入りきらない場合は「バイト」で数える
  let jp = "";
  for (let i = 0; i < 1000; i++) jp += "山";
  const m4 = catchMsg(function () { QR.make(jp, { ecLevel: "H" }); });
  ok(m4 && m4.indexOf("バイト") >= 0, "バイトモードのときは「バイト」で知らせる");

  eq(catchMsg(function () { QR.make("", {}); }), "QRコードにする文字列が空です", "空文字は日本語で断る");
  ok(catchMsg(function () { QR.make("A", { ecLevel: "X" }); }).indexOf("訂正レベルは L M Q H") >= 0,
    "知らない訂正レベルは日本語で断る");
}

/* ============================================================ */
section("7. マスクの選び方");
{
  // 8種類すべてが使われうること（同じ番号しか出ないなら選定が働いていない）
  const used = {};
  for (let i = 0; i < 40; i++) {
    const qr = QR.make("POOL SCORE TEST " + i + " ABCDEFGHIJ", { ecLevel: "M" });
    used[qr.mask] = true;
  }
  ok(Object.keys(used).length >= 3, "文字列を変えるとマスク番号も変わる（" + Object.keys(used).length + "種類）");

  // マスクの式が規格どおり（代表点で確認）
  eq(QR.maskAt(0, 0, 0), true, "マスク0: (0,0)は反転する");
  eq(QR.maskAt(1, 0, 1), false, "マスク1: 奇数行は反転しない");
  eq(QR.maskAt(2, 3, 5), true, "マスク2: x が3の倍数なら反転");
  eq(QR.maskAt(3, 1, 2), true, "マスク3: (x+y)が3の倍数なら反転");
}

/* ============================================================ */
console.log("\n========================================");
console.log("成功: " + pass + " / 失敗: " + fail);
if (failures.length) {
  console.log("\n【失敗した項目】");
  failures.forEach(function (f, i) {
    console.log("  " + (i + 1) + ". " + f);
  });
  process.exit(1);
} else {
  console.log("すべて成功");
}
