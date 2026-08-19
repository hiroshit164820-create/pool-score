# -*- coding: utf-8 -*-
"""layout_fit_test.py — 1画面に収まっているかの全数確認

種目8つ × 画面サイズ4つ = 32通りで、次の4点を実物のレイアウトで見る:
  1. 下部ボタン（取り消し・訂正・試合終了）が画面内にある
  2. プレーヤー名がパネルの上に切れていない
  3. スコアの数字がパネルの下にはみ出していない
  4. 盤面のボタン（球・投球・マスワリ）と交代ボタンが押せる位置にある

この検証を足した経緯:
  「ローテーションの2人目の表示が隠れる」という指摘の再現を探したところ、
  縦の短い端末では種目を問わず下部が画面外へ出ていた（19通りで不具合）。
  数値で測らないと気付けないため、全数で自動確認する。

実行: python _test/layout_fit_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"

JS = """() => {
  const vh = window.innerHeight;
  const scr = document.getElementById('screenMatch');
  const bb = scr.querySelector('.bottom-bar').getBoundingClientRect();
  const res = { fits: bb.bottom <= vh + 1, over: Math.round(bb.bottom - vh) };
  // 盤面のボタンが実際に押せない位置にあるかを見る。
  // scrollHeight の差だけでは余白のはみ出しも拾ってしまうため、
  // ボタンの矩形が表示領域から出ているかで判定する
  const pa = scr.querySelector('.play-area');
  if (pa) {
    const pr = pa.getBoundingClientRect();
    const hidden = Array.from(pa.querySelectorAll('button')).filter(btn => {
      const r = btn.getBoundingClientRect();
      if (r.height === 0) return false;
      // 半分以上が隠れていたら押せないとみなす
      const visible = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
      return visible < r.height * 0.5;
    });
    if (hidden.length) {
      res.playAreaClipped = true;
      res.hiddenLabels = hidden.slice(0, 5).map(b => (b.textContent || '').trim().slice(0, 8));
    }
  }
  // 交代ボタンが画面内にあるか（押せないと試合が進まない）
  const tb = document.getElementById('turnBtn');
  if (tb && tb.offsetParent !== null) {
    const r = tb.getBoundingClientRect();
    if (r.bottom > vh + 1 || r.top < 0) res.turnBtnOffscreen = true;
  }
  // 名前と数字が切れていないか（両側）
  ['A','B'].forEach(sd => {
    const p = document.getElementById('panel'+sd);
    if (!p || p.offsetParent === null) return;
    const pr = p.getBoundingClientRect();
    const n = document.getElementById('name'+sd).getBoundingClientRect();
    const v = document.getElementById('score'+sd).getBoundingClientRect();
    res['name'+sd+'Clip'] = n.top < pr.top - 0.5;
    res['val'+sd+'Clip'] = v.bottom > pr.bottom + 0.5;
    res['panel'+sd+'Visible'] = pr.bottom <= vh + 1 && pr.height > 0;
  });
  return res;
}"""

GAMES = ["9ball", "10ball", "8ball", "rotation", "straight", "jpa_9ball", "jpa_8ball", "bowlard"]
SIZES = [(375, 667), (375, 812), (390, 844), (360, 640)]

bad = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in SIZES:
        pg = b.new_page(viewport={"width": w, "height": h})
        for g in GAMES:
            pg.goto(URL); pg.wait_for_timeout(350)
            helpers.pick_game(pg, g); pg.wait_for_timeout(200)
            pg.fill("#inNameA", "あきら")
            if pg.locator("#inNameB").count():
                pg.fill("#inNameB", "うたの")
            pg.wait_for_timeout(150)
            pg.click("#startMatchBtn"); pg.wait_for_timeout(500)
            r = pg.evaluate(JS)
            probs = []
            if not r["fits"]: probs.append("下部ボタンが%dpxはみ出し" % r["over"])
            if r.get("playAreaClipped"): probs.append("盤面のボタンが隠れる:%s" % r.get("hiddenLabels"))
            if r.get("turnBtnOffscreen"): probs.append("交代ボタンが画面外")
            for k, v in r.items():
                if k.endswith("Clip") and v: probs.append(k)
                if k.endswith("Visible") and v is False: probs.append(k+"=False")
            tag = "NG " if probs else "ok "
            if probs: bad.append((w, h, g, probs))
            print("%s%dx%d %-12s %s" % (tag, w, h, g, ", ".join(probs) if probs else ""))
        pg.close()
    b.close()
print("\n" + "=" * 44)
total = len(GAMES) * len(SIZES)
print("成功: %d / 失敗: %d" % (total - len(bad), len(bad)))
if bad:
    print("\n【失敗した組み合わせ】")
    for w, h, g, probs in bad:
        print("  - %dx%d %s: %s" % (w, h, g, ", ".join(probs)))
    sys.exit(1)
else:
    print("すべて成功")
