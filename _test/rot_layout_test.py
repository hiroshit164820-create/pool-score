# -*- coding: utf-8 -*-
"""rot_layout_test.py — ローテーションの試合画面のレイアウト確認

本人の指示（2026-08-22・実機スクリーンショット）:
  縦向き: スコアボードを2段にする（上段=撞き番/BREAK/名前、下段=点数を大きく）
          名前が潰れないこと、点数と目標（/120）が重ならないこと
  横向き: A/Bともセーフティは左、交代とブレイク入れ替えは画面右に縦並び

時計なし/ショットクロック/チェスクロックの3通り × 縦横2通りで実測する。
スクリーンショットも撮る（環境変数 ROT_SHOTS で保存先を変えられる）。

実行: python _test/rot_layout_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace("\\", "/") + "/index.html"
SHOTS = os.environ.get("ROT_SHOTS") or os.path.join(ROOT, "_test", "shots")
os.makedirs(SHOTS, exist_ok=True)

# 縦は「高さ820px以下」の分岐（style.css の @media (max-height:820px)）を必ず通す。
# 本人の実機の症状（名前が1文字に潰れ、点数と目標が重なる）はこの分岐で出ていた
VIEWS = [("portrait", 390, 844), ("portrait667", 375, 667), ("portrait640", 360, 640),
         ("landscape", 844, 390)]
CLOCKS = ["none", "shot", "chess"]

PROBE = r"""() => {
  const q = s => document.querySelector(s);
  const g = id => document.getElementById(id);
  const R = e => { const r = e.getBoundingClientRect();
    return {x:r.left, y:r.top, w:r.width, h:r.height, r:r.right, b:r.bottom}; };
  const vis = e => { if (!e) return false; const s = getComputedStyle(e);
    if (s.display==='none'||s.visibility==='hidden') return false;
    const r = e.getBoundingClientRect(); return r.width>0 && r.height>0; };
  const out = {W: innerWidth, H: innerHeight, issues: []};

  ['A','B'].forEach(sd => {
    const p = g('panel'+sd); if (!vis(p)) return;
    const pr = R(p), nm = g('name'+sd), val = g('score'+sd), tg = g('target'+sd);
    out['panel'+sd] = pr;
    out['val'+sd] = R(val);
    out['nameText'+sd] = nm.textContent;
    out['nameFont'+sd] = parseFloat(getComputedStyle(nm).fontSize);
    out['valFont'+sd] = parseFloat(getComputedStyle(val).fontSize);
    // 名前が潰れていないか（省略されていたら scrollWidth が clientWidth を超える）
    if (nm.scrollWidth - nm.clientWidth > 1)
      out.issues.push('名前が省略'+sd+' '+nm.clientWidth+'<'+nm.scrollWidth);
    if (R(nm).y < pr.y - 0.5) out.issues.push('名前が上に切れ'+sd);
    if (R(val).b > pr.b + 0.5) out.issues.push('点数が下にはみ出し'+sd);
    if (vis(tg)) {
      const a = R(val), b2 = R(tg);
      const ox = Math.min(a.r,b2.r) - Math.max(a.x,b2.x);
      const oy = Math.min(a.b,b2.b) - Math.max(a.y,b2.y);
      if (ox > 1 && oy > 1)
        out.issues.push('点数と目標が重なり'+sd+' '+Math.round(ox)+'x'+Math.round(oy));
      if (b2.b > pr.b + 0.5) out.issues.push('目標が下にはみ出し'+sd);
    }
    // 数字が横に切れていないか（val-row は overflow:hidden なので
    // 大きすぎると左右が削れる）
    const vr = val.closest('.val-row');
    if (vr && vr.scrollWidth - vr.clientWidth > 1)
      out.issues.push('点数が横に切れ'+sd+' '+vr.clientWidth+'<'+vr.scrollWidth);
    if (val.scrollWidth - val.clientWidth > 1)
      out.issues.push('点数の字が切れ'+sd);
  });

  // セーフティ等の記録ボタンが、スコア欄の左右どちらにあるか
  ['A','B'].forEach(sd => {
    const f = g('panelFlags'+sd), p = g('panel'+sd);
    if (!vis(f) || !vis(p)) { out['flags'+sd] = null; return; }
    const fr = R(f), pr = R(p);
    out['flags'+sd] = {rect: fr, side: (fr.x + fr.w/2 < pr.x + pr.w/2) ? 'left' : 'right'};
  });

  ['turnBtn','breakToggleBtn'].forEach(id => {
    const e = g(id); out[id] = vis(e) ? R(e) : null;
  });
  const sb = q('#screenMatch .scoreboard');
  out.scoreboard = vis(sb) ? R(sb) : null;
  const bg = g('ballGrid');
  out.ballGrid = vis(bg) ? R(bg) : null;

  // ボタンの重なり・画面外・44px割れ（overlap_test と同じ見方）
  const scr = g('screenMatch');
  const btns = [...scr.querySelectorAll('button')]
    .filter(b => !b.disabled && !b.closest('[hidden]') && vis(b))
    .map(b => { const r = R(b);
      return {id: b.id || b.className.split(' ')[0],
              t: (b.textContent||'').replace(/\s+/g,' ').trim().slice(0,14), r}; });
  out.nbtn = btns.length;
  for (let i=0;i<btns.length;i++) for (let j=i+1;j<btns.length;j++) {
    const a=btns[i].r, b2=btns[j].r;
    const ox = Math.min(a.r,b2.r)-Math.max(a.x,b2.x);
    const oy = Math.min(a.b,b2.b)-Math.max(a.y,b2.y);
    if (ox>1 && oy>1)
      out.issues.push('ボタン重なり: '+(btns[i].t||btns[i].id)+' <-> '+(btns[j].t||btns[j].id));
  }
  btns.forEach(b => {
    if (b.r.b > innerHeight+1 || b.r.r > innerWidth+1 || b.r.y < -1 || b.r.x < -1)
      out.issues.push('画面外: '+(b.t||b.id));
    if (b.r.h < 43.5) out.issues.push('44px割れ: '+(b.t||b.id)+' '+Math.round(b.r.h));
  });
  return out;
}"""


def start(pg, clock):
    helpers.pick_game(pg, "rotation")
    pg.wait_for_timeout(300)
    pg.fill("#inNameA", "たいら")
    if pg.locator("#inNameB").count():
        pg.fill("#inNameB", "いっちょ")
    pg.wait_for_timeout(200)
    tg = pg.locator("#clockTypeToggle")
    if tg.count():
        label = {"none": "使わない", "shot": "ショット", "chess": "チェス"}[clock]
        b = tg.locator("button", has_text=label)
        if b.count():
            b.first.click()
            pg.wait_for_timeout(250)
    pg.click("#startMatchBtn")
    pg.wait_for_timeout(800)


def main():
    bad = []
    with sync_playwright() as p:
        br = p.chromium.launch()
        for vname, W, H in VIEWS:
            for clock in CLOCKS:
                pg = br.new_page(viewport={"width": W, "height": H})
                pg.goto(URL)
                pg.wait_for_timeout(400)
                start(pg, clock)
                # 2桁・3桁の数字でも重ならないか見るため、何点か入れておく
                for b in (15, 14, 13):
                    loc = pg.locator('.ball-btn[data-ball="%d"]' % b)
                    if loc.count() and loc.first.is_enabled():
                        loc.first.click()
                        pg.wait_for_timeout(120)
                # 「◯番（+n点）」の知らせは流れに入って高さを取る。
                # 数秒で消える一時的なものなので、消えてから測る
                for _ in range(40):
                    if not pg.evaluate(
                            "() => { const t = document.querySelector('.toast-wrap');"
                            " return !!t && t.getBoundingClientRect().height > 1; }"):
                        break
                    pg.wait_for_timeout(200)
                pg.wait_for_timeout(400)
                shot = os.path.join(SHOTS, "rot_%s_%s.png" % (vname, clock))
                pg.screenshot(path=shot)
                r = pg.evaluate(PROBE)
                tag = "%s/clock=%s" % (vname, clock)
                print("--- %s (%dx%d) ---" % (tag, r["W"], r["H"]))
                for sd in ("A", "B"):
                    if r.get("panel" + sd):
                        pr, vr = r["panel" + sd], r["val" + sd]
                        print("  %s panel_h=%.0f name='%s'(%.0fpx) val_font=%.0f val_box=%.0fx%.0f"
                              % (sd, pr["h"], r["nameText" + sd], r["nameFont" + sd],
                                 r["valFont" + sd], vr["w"], vr["h"]))
                    fl = r.get("flags" + sd)
                    if fl:
                        print("  %s flags=%s" % (sd, fl["side"]))
                for key, lab in (("turnBtn", "turn"), ("breakToggleBtn", "swap")):
                    t = r.get(key)
                    if t:
                        print("  %s: x=%.0f y=%.0f w=%.0f h=%.0f"
                              % (lab, t["x"], t["y"], t["w"], t["h"]))
                if r.get("scoreboard"):
                    print("  scoreboard_h=%.0f ballGrid_h=%.0f"
                          % (r["scoreboard"]["h"], (r.get("ballGrid") or {}).get("h", 0)))
                if r["issues"]:
                    for m in r["issues"]:
                        print("  NG %s" % m)
                    bad.append((tag, r["issues"]))
                else:
                    print("  OK")
                print("  shot: %s" % shot)
                pg.close()
        br.close()
    print("\n===== %d combos, %d NG =====" % (len(VIEWS) * len(CLOCKS), len(bad)))
    for tag, iss in bad:
        print("  %s: %s" % (tag, " / ".join(iss)))
    sys.exit(1 if bad else 0)


main()
