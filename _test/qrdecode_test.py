# -*- coding: utf-8 -*-
"""qrdecode_test.py — QRコードの読み取り（js/qrdecode.js）

カメラでQRを写して試合の記録を取り込むために、BarcodeDetector が無い端末
（iOS Safari）でも読めるよう、読み取りを自前で書いた。その往復を確かめる。

確かめ方:
  js/qr.js で作ったQRを実ブラウザの canvas に描き、
  js/qrdecode.js が canvas の getImageData() から読み戻せるかを見る。
  「作った側が正しい」ではなく「描いた絵から読み戻せる」ことを見る。

対象:
  1. 升目から直接読める（QRDECODE.fromMatrix）
  2. 短い英数字・日本語を含むバイト列・1,200文字のURL風文字列が読み戻せる
  3. 1マスを何ピクセルで描いても読める（2px / 4px / 8px）
  4. 余白（クワイエットゾーン）が狭くても読める
  5. 傾けて描いても読める（5度・15度、および限界の実測）
  6. 一部を汚しても読める（誤り訂正の範囲内、限界の実測）
  7. QRが写っていない画像では null を返し、例外にならない
  8. 読み取りが1回500ミリ秒以内に終わる（実測値を出す）
  9. JSエラーが無い

実行: python _test/qrdecode_test.py
"""
import sys, io, os, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "_test", "qrdecode_page.html")
SHOTS = os.path.join(ROOT, "_test", "shots")
if not os.path.isdir(SHOTS):
    os.makedirs(SHOTS)

# 読み取り1回の上限（カメラの毎フレームで呼ぶため）
LIMIT_MS = 500

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


# ============================================================
# 検証用のページを書き出す。
# 中身は「描く」と「読む」の2つだけ。アプリ本体には一切触らない
# ============================================================
PAGE_HTML = u"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>qrdecode 検証</title>
</head>
<body>
<canvas id="cv" width="10" height="10"></canvas>
<script src="../js/qr.js"></script>
<script src="../js/qrdecode.js"></script>
<script>
var T = {
  // QRを canvas に描く。scale=1マスの画素数, quiet=余白のマス数, deg=傾き(度)
  render: function (text, opt) {
    opt = opt || {};
    var scale = opt.scale || 6;
    var quiet = (opt.quiet == null) ? 4 : opt.quiet;
    var deg = opt.deg || 0;
    var q = QRCODE.make(text, opt.ec ? { ecLevel: opt.ec } : undefined);
    var n = q.size;
    var side = (n + quiet * 2) * scale;
    var rad = deg * Math.PI / 180;
    var W = Math.ceil(side * (Math.abs(Math.cos(rad)) + Math.abs(Math.sin(rad))));
    var cv = document.getElementById('cv');
    cv.width = W; cv.height = W;
    var g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, W);
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(rad);
    g.translate(-side / 2, -side / 2);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, side, side);
    g.fillStyle = '#000000';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (q.modules[y][x]) {
          g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    }
    g.restore();
    if (opt.blot) {
      g.fillStyle = '#000000';
      g.fillRect(opt.blot.x, opt.blot.y, opt.blot.w, opt.blot.h);
    }
    return { version: q.version, size: n, px: W, mode: q.mode, ec: q.ecLevel };
  },

  // 斜めから撮った写真の代わり。台形に歪ませて描く。
  // canvas の 2D は台形の描画ができないので、いったん描いた絵を画素ごとに写し替える。
  // shrink=0.4 なら上辺が下辺の60%の幅になる（＝かなり寝かせて撮った状態）
  warp: function (text, opt) {
    opt = opt || {};
    var shrink = opt.shrink || 0.3;
    var info = T.render(text, { scale: opt.scale || 6, quiet: opt.quiet == null ? 4 : opt.quiet });
    var cv = document.getElementById('cv');
    var W = cv.width;
    var src = cv.getContext('2d').getImageData(0, 0, W, W);
    // 変換元＝画像全体の四隅、変換先＝上辺を縮めた台形
    var d = W * shrink / 2;
    var t = T._quadToQuad(
      [d, 0, W - d, 0, W, W, 0, W],   // 台形（描きたい形）
      [0, 0, W, 0, W, W, 0, W]        // 元の正方形
    );
    var out = cv.getContext('2d').createImageData(W, W);
    for (var y = 0; y < W; y++) {
      for (var x = 0; x < W; x++) {
        var den = t.a13 * (x + 0.5) + t.a23 * (y + 0.5) + t.a33;
        var sx = Math.round((t.a11 * (x + 0.5) + t.a21 * (y + 0.5) + t.a31) / den);
        var sy = Math.round((t.a12 * (x + 0.5) + t.a22 * (y + 0.5) + t.a32) / den);
        var o = (y * W + x) * 4;
        var v = 255;
        if (sx >= 0 && sy >= 0 && sx < W && sy < W) v = src.data[(sy * W + sx) * 4];
        out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = 255;
      }
    }
    cv.getContext('2d').putImageData(out, 0, 0);
    return info;
  },

  // 台形→正方形 の射影変換（検証で歪ませるためだけに使う小さな実装）
  _squareToQuad: function (x0, y0, x1, y1, x2, y2, x3, y3) {
    var dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
    if (dx3 === 0 && dy3 === 0) {
      return { a11: x1 - x0, a21: x2 - x1, a31: x0,
               a12: y1 - y0, a22: y2 - y1, a32: y0, a13: 0, a23: 0, a33: 1 };
    }
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    var den = dx1 * dy2 - dx2 * dy1;
    var a13 = (dx3 * dy2 - dx2 * dy3) / den;
    var a23 = (dx1 * dy3 - dx3 * dy1) / den;
    return { a11: x1 - x0 + a13 * x1, a21: x3 - x0 + a23 * x3, a31: x0,
             a12: y1 - y0 + a13 * y1, a22: y3 - y0 + a23 * y3, a32: y0,
             a13: a13, a23: a23, a33: 1 };
  },
  _quadToQuad: function (from, to) {
    var f = T._squareToQuad(from[0], from[1], from[2], from[3], from[4], from[5], from[6], from[7]);
    var adj = { a11: f.a22 * f.a33 - f.a23 * f.a32, a21: f.a23 * f.a31 - f.a21 * f.a33,
                a31: f.a21 * f.a32 - f.a22 * f.a31, a12: f.a13 * f.a32 - f.a12 * f.a33,
                a22: f.a11 * f.a33 - f.a13 * f.a31, a32: f.a12 * f.a31 - f.a11 * f.a32,
                a13: f.a12 * f.a23 - f.a13 * f.a22, a23: f.a13 * f.a21 - f.a11 * f.a23,
                a33: f.a11 * f.a22 - f.a12 * f.a21 };
    var s = T._squareToQuad(to[0], to[1], to[2], to[3], to[4], to[5], to[6], to[7]);
    return { a11: s.a11 * adj.a11 + s.a21 * adj.a12 + s.a31 * adj.a13,
             a21: s.a11 * adj.a21 + s.a21 * adj.a22 + s.a31 * adj.a23,
             a31: s.a11 * adj.a31 + s.a21 * adj.a32 + s.a31 * adj.a33,
             a12: s.a12 * adj.a11 + s.a22 * adj.a12 + s.a32 * adj.a13,
             a22: s.a12 * adj.a21 + s.a22 * adj.a22 + s.a32 * adj.a23,
             a32: s.a12 * adj.a31 + s.a22 * adj.a32 + s.a32 * adj.a33,
             a13: s.a13 * adj.a11 + s.a23 * adj.a12 + s.a33 * adj.a13,
             a23: s.a13 * adj.a21 + s.a23 * adj.a22 + s.a33 * adj.a23,
             a33: s.a13 * adj.a31 + s.a23 * adj.a32 + s.a33 * adj.a33 };
  },

  // canvas を写真代わりに使わない場合（QRが写っていない画像）
  noise: function (w) {
    var cv = document.getElementById('cv');
    cv.width = w; cv.height = w;
    var g = cv.getContext('2d');
    var img = g.createImageData(w, w);
    var seed = 12345;
    for (var i = 0; i < w * w; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      var v = (seed >> 16) & 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return w;
  },

  blank: function (w) {
    var cv = document.getElementById('cv');
    cv.width = w; cv.height = w;
    var g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, w);
    return w;
  },

  // canvas から読み戻す。かかった時間も返す
  read: function (times) {
    var cv = document.getElementById('cv');
    var g = cv.getContext('2d', { willReadFrequently: true });
    var img = g.getImageData(0, 0, cv.width, cv.height);
    var n = times || 1;
    var best = null, worst = 0, out = null;
    for (var i = 0; i < n; i++) {
      var t0 = performance.now();
      out = QRDECODE.fromImageData(img);
      var ms = performance.now() - t0;
      if (best === null || ms < best) best = ms;
      if (ms > worst) worst = ms;
    }
    return { text: out, ms: worst, best: best, px: cv.width };
  },

  // 升目から直接読む
  matrix: function (text, ec) {
    var q = QRCODE.make(text, ec ? { ecLevel: ec } : undefined);
    return { text: QRDECODE.fromMatrix(q.modules), version: q.version, mode: q.mode };
  }
};
</script>
</body>
</html>
"""

with io.open(PAGE, "w", encoding="utf-8") as f:
    f.write(PAGE_HTML)

URL = "file:///" + PAGE.replace(chr(92), "/")

SHORT = "POOL-SCORE 9BALL 2026"
JA = "たいら vs いっちょ 9ボール 3先 ★勝敗:○"
# 1,200文字のURL風文字列（共有リンクと同じ形）
LONG = "https://example.com/pool-score/#s=1.g."
LONG += "".join("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[i % 64]
                for i in range(1200 - len(LONG)))

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 900, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(400)

    check(pg.evaluate("() => typeof QRDECODE === 'object'"), "qrdecode.js が読み込める")
    check(pg.evaluate("() => typeof QRDECODE.fromImageData === 'function'"),
          "QRDECODE.fromImageData がある")
    check(pg.evaluate("() => typeof QRDECODE.fromMatrix === 'function'"),
          "QRDECODE.fromMatrix がある")
    check(len(LONG) == 1200, "1,200文字の文字列を用意した", len(LONG))

    # ================= 1. 升目から直接読む =================
    section("1. 升目から直接読む（QRDECODE.fromMatrix）")
    for label, text in [("短い英数字", SHORT), ("日本語（バイト）", JA),
                        ("1,200文字のURL", LONG), ("数字だけ", "0123456789" * 8)]:
        r = pg.evaluate("t => T.matrix(t)", text)
        print("   %s: 版%d / %sモード" % (label, r["version"], r["mode"]))
        check(r["text"] == text, "fromMatrix で読み戻せる（%s）" % label,
              (r["text"] or "null")[:40])

    # 訂正レベル4種すべて
    for ec in ["L", "M", "Q", "H"]:
        r = pg.evaluate("a => T.matrix(a[0], a[1])", [JA, ec])
        check(r["text"] == JA, "訂正レベル %s でも読める" % ec, (r["text"] or "null")[:30])

    # ================= 2. canvas に描いて読み戻す =================
    section("2. canvas に描いて読み戻す（往復）")
    for label, text in [("短い英数字", SHORT), ("日本語（バイト）", JA),
                        ("1,200文字のURL", LONG)]:
        info = pg.evaluate("t => T.render(t, {scale: 6, quiet: 4})", text)
        r = pg.evaluate("() => T.read()")
        print("   %s: 版%d / %dpx四方 / %.1fms" % (label, info["version"], r["px"], r["ms"]))
        check(r["text"] == text, "canvas から読み戻せる（%s）" % label,
              (r["text"] or "null")[:40])

    # ================= 3. 1マスの画素数 =================
    section("3. 1マスを何ピクセルで描いても読める")
    # 長い文字列は毎回渡すと遅いので、ページ側に置いておく
    pg.evaluate("t => { window.__long = t; }", LONG)
    pg.evaluate("t => { window.__short = t; }", SHORT)
    for scale in [2, 4, 8]:
        info = pg.evaluate("s => T.render(window.__long, {scale: s, quiet: 4})", scale)
        r = pg.evaluate("() => T.read()")
        print("   1マス%dpx: 版%d / %dpx四方 / %.1fms" % (scale, info["version"], r["px"], r["ms"]))
        check(r["text"] == LONG, "1マス%dpx でも読める" % scale, (r["text"] or "null")[:30])
        check(r["ms"] <= LIMIT_MS, "1マス%dpx が%dms以内" % (scale, LIMIT_MS), "%.1fms" % r["ms"])

    # 短い文字列も同じ3種で
    for scale in [2, 4, 8]:
        pg.evaluate("s => T.render(window.__short, {scale: s, quiet: 4})", scale)
        r = pg.evaluate("() => T.read()")
        check(r["text"] == SHORT, "短い文字列も1マス%dpx で読める" % scale,
              (r["text"] or "null")[:30])

    # ================= 4. 余白（クワイエットゾーン） =================
    section("4. 余白が狭くても読める")
    quiet_ok = []
    for quiet in [4, 3, 2, 1, 0]:
        pg.evaluate("q => T.render(window.__long, {scale: 6, quiet: q})", quiet)
        r = pg.evaluate("() => T.read()")
        ok = (r["text"] == LONG)
        print("   余白%dマス: %s" % (quiet, "読めた" if ok else "読めない"))
        if ok:
            quiet_ok.append(quiet)
    check(1 in quiet_ok, "余白1マスでも読める", quiet_ok)
    check(2 in quiet_ok, "余白2マスでも読める", quiet_ok)
    print("   → 読めた最小の余白: %sマス" % (min(quiet_ok) if quiet_ok else "なし"))

    # ================= 5. 傾き =================
    section("5. 傾けて描いても読める")
    for deg in [5, 15]:
        pg.evaluate("d => T.render(window.__long, {scale: 6, quiet: 4, deg: d})", deg)
        r = pg.evaluate("() => T.read()")
        print("   %d度: %s / %.1fms" % (deg, "読めた" if r["text"] == LONG else "読めない", r["ms"]))
        check(r["text"] == LONG, "%d度に傾けても読める（1,200文字）" % deg,
              (r["text"] or "null")[:30])
        check(r["ms"] <= LIMIT_MS, "%d度でも%dms以内" % (deg, LIMIT_MS), "%.1fms" % r["ms"])
    pg.screenshot(path=os.path.join(SHOTS, "qrdecode_tilt15.png"))

    # どこまで傾けられるかの実測
    max_deg = 0
    for deg in [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]:
        pg.evaluate("d => T.render(window.__short, {scale: 6, quiet: 4, deg: d})", deg)
        r = pg.evaluate("() => T.read()")
        if r["text"] == SHORT:
            max_deg = deg
        else:
            break
    print("   → 短い文字列で読めた最大の傾き: %d度（45度は正方形が元に戻る角度）" % max_deg)
    check(max_deg >= 15, "少なくとも15度までは耐える", max_deg)

    # ================= 5b. 斜めから撮った写真（台形） =================
    section("5b. 斜めから撮った写真（台形に歪ませる）")
    warp_ok = 0
    for shrink in [0.05, 0.1, 0.15, 0.2, 0.3]:
        pg.evaluate("s => T.warp(window.__long, {scale: 6, quiet: 4, shrink: s})", shrink)
        r = pg.evaluate("() => T.read()")
        ok = (r["text"] == LONG)
        print("   上辺を%d%%縮める: %s / %.1fms"
              % (shrink * 100, "読めた" if ok else "読めない", r["ms"]))
        check(r["ms"] <= LIMIT_MS, "上辺%d%%の台形でも%dms以内" % (shrink * 100, LIMIT_MS),
              "%.1fms" % r["ms"])
        if ok:
            warp_ok = shrink
        else:
            break
    check(warp_ok >= 0.1, "上辺を1割縮めた台形（＝斜めから撮った写真）でも読める", warp_ok)
    print("   → 1,200文字（版25）で上辺を%d%%縮めるところまで読めた" % (warp_ok * 100))

    # 小さいQRほど強い（位置合わせパターンの見当が付けやすいため）
    warp_ok_small = 0
    for shrink in [0.1, 0.2, 0.3, 0.4]:
        pg.evaluate("""s => T.warp('たいら vs いっちょ 9ボール',
            {scale: 6, quiet: 4, shrink: s})""", shrink)
        r = pg.evaluate("() => T.read()")
        if r["text"] == "たいら vs いっちょ 9ボール":
            warp_ok_small = shrink
        else:
            break
    print("   → 小さいQR（版3）では上辺を%d%%縮めるところまで読めた" % (warp_ok_small * 100))
    check(warp_ok_small >= 0.2, "小さいQRなら上辺2割の台形でも読める", warp_ok_small)
    pg.evaluate("() => T.warp(window.__long, {scale: 6, quiet: 4, shrink: 0.3})")
    pg.screenshot(path=os.path.join(SHOTS, "qrdecode_warp.png"))

    # ================= 6. 一部を汚す（誤り訂正） =================
    section("6. 一部を汚しても読める（誤り訂正）")
    # 訂正レベルLの1,200文字QRの真ん中あたりに黒い四角を重ねる
    info = pg.evaluate("() => T.render(window.__long, {scale: 6, quiet: 4})")
    side = info["px"]
    code_px = info["size"] * 6
    blot_report = {}
    for ec in ["L", "M", "Q", "H"]:
        best = 0
        for w in range(10, 520, 10):
            pg.evaluate("""a => T.render(window.__long, {scale: 6, quiet: 4, ec: a[0],
                blot: {x: a[1], y: a[1], w: a[2], h: a[2]}})""",
                        [ec, int(side * 0.30), w])
            r = pg.evaluate("() => T.read()")
            if r["text"] == LONG:
                best = w
            else:
                break
        blot_report[ec] = best
        print("   訂正レベル%s: 一辺%dpx（約%.0fマス四方）の汚れまで読めた"
              % (ec, best, best / 6.0))
    check(blot_report["L"] >= 60, "訂正レベルLで一辺60px以上の汚れに耐える", blot_report)
    check(blot_report["H"] > blot_report["L"], "訂正レベルを上げるほど汚れに強い", blot_report)

    # 見た目の控えを残す（レベルL・限界の少し手前）
    pg.evaluate("""w => T.render(window.__long, {scale: 6, quiet: 4, ec: 'L',
        blot: {x: Math.floor(w[0]), y: Math.floor(w[0]), w: w[1], h: w[1]}})""",
                [side * 0.30, max(10, blot_report["L"])])
    r = pg.evaluate("() => T.read()")
    check(r["text"] == LONG, "控えに残す汚し画像も読める", (r["text"] or "null")[:30])
    pg.screenshot(path=os.path.join(SHOTS, "qrdecode_blot.png"))

    # ================= 7. QRが写っていない画像 =================
    section("7. QRが写っていない画像")
    pg.evaluate("() => T.noise(400)")
    r = pg.evaluate("() => T.read()")
    check(r["text"] is None, "砂嵐の画像では null を返す", r["text"])
    check(r["ms"] <= LIMIT_MS, "砂嵐でも%dms以内" % LIMIT_MS, "%.1fms" % r["ms"])

    pg.evaluate("() => T.blank(400)")
    r = pg.evaluate("() => T.read()")
    check(r["text"] is None, "真っ白な画像では null を返す", r["text"])

    bad = pg.evaluate("""() => {
      const out = [];
      const cases = [null, undefined, {}, {data: null, width: 0, height: 0},
                     {data: new Uint8ClampedArray(4), width: 1, height: 1}];
      for (let i = 0; i < cases.length; i++) {
        try { out.push(QRDECODE.fromImageData(cases[i])); }
        catch (e) { out.push('EXCEPTION:' + e.message); }
      }
      try { out.push(QRDECODE.fromMatrix(null)); }
      catch (e) { out.push('EXCEPTION:' + e.message); }
      try { out.push(QRDECODE.fromMatrix([[true, false], [false, true]])); }
      catch (e) { out.push('EXCEPTION:' + e.message); }
      return out;
    }""")
    check(all(v is None for v in bad), "でたらめな入力でも例外を投げず null を返す", bad)

    # ================= 8. 速さ =================
    section("8. 読み取りの速さ（1回あたり）")
    speed = {}
    for label, scale in [("2px", 2), ("4px", 4), ("8px", 8)]:
        pg.evaluate("s => T.render(window.__long, {scale: s, quiet: 4})", scale)
        r = pg.evaluate("() => T.read(5)")  # 5回まわして最も遅い回を採る
        speed[label] = (r["ms"], r["best"], r["px"])
        print("   1,200文字 1マス%s（%dpx四方）: 最遅 %.1fms / 最速 %.1fms"
              % (label, r["px"], r["ms"], r["best"]))
        check(r["text"] == LONG, "速さ計測でも正しく読める（1マス%s）" % label)
        check(r["ms"] <= LIMIT_MS, "1マス%s が%dms以内" % (label, LIMIT_MS), "%.1fms" % r["ms"])

    pg.evaluate("() => T.render(window.__long, {scale: 6, quiet: 4, deg: 15})")
    r = pg.evaluate("() => T.read(5)")
    print("   1,200文字 15度傾き（%dpx四方）: 最遅 %.1fms" % (r["px"], r["ms"]))
    check(r["ms"] <= LIMIT_MS, "傾いていても%dms以内" % LIMIT_MS, "%.1fms" % r["ms"])

    # ================= 9. JSエラー =================
    section("9. JSエラー")
    check(not errs, "JSエラーなし", errs[:3])

    br.close()

print("")
print("== 実測のまとめ ==")
print("  1,200文字（版%d）の読み取り: 1マス8px で 最遅 %.1fms / 最速 %.1fms（上限 %dms）"
      % (info["version"], speed["8px"][0], speed["8px"][1], LIMIT_MS))
print("  傾き: %d度まで読めた（5度・15度は合格）" % max_deg)
print("  斜めから撮った写真: 上辺を%d%%縮めた台形まで読めた" % (warp_ok * 100))
print("  余白: %dマスまで狭めても読めた" % (min(quiet_ok) if quiet_ok else -1))
print("  汚し: レベルL=一辺%dpx / M=%dpx / Q=%dpx / H=%dpx まで読めた"
      % (blot_report["L"], blot_report["M"], blot_report["Q"], blot_report["H"]))

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
