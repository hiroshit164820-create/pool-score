# -*- coding: utf-8 -*-
"""stage4_test.py — 段階4（見た目）の指示

本人の指示（2026-08-21・26件のうち段階4）:
  1. プレーヤー選択時の名前の枠線に色（Aは青、Bは赤）
  2. ハンデあり・勝利条件選択（JPA含む）でも、A側は青、B側は赤の枠線
  3. ホーム画面のカードと中の色を、もう少しギミックらしく
  4. アイコンのボールをアラミスブラックにする

実行: python _test/stage4_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/index.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
if not os.path.isdir(SHOTS):
    os.makedirs(SHOTS)

# style.css の配色トークン
BLUE = "rgb(11, 99, 214)"    # --side-a
RED = "rgb(212, 59, 18)"     # --side-b
GOLD = "rgb(251, 208, 0)"    # --block（ハテナブロックの金）

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


BORDER = """(sel) => {
  const e = document.querySelector(sel);
  if (!e) return null;
  return {border: getComputedStyle(e).borderTopColor};
}"""

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 390, "height": 844})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_timeout(600)

    # ================= 1. プレーヤーの名前欄 =================
    section("1. 名前の枠線（A=青／B=赤）")
    pg.click("#tabSetup")
    pg.wait_for_timeout(400)
    helpers.pick_game(pg, "9ball")
    pg.wait_for_timeout(500)
    a = pg.evaluate(BORDER, "#inNameA")
    b = pg.evaluate(BORDER, "#inNameB")
    check(a and a["border"] == BLUE, "A の名前欄が青枠", a)
    check(b and b["border"] == RED, "B の名前欄が赤枠", b)
    clsA = pg.eval_on_selector("#inNameA", "e => e.closest('.field').className")
    clsB = pg.eval_on_selector("#inNameB", "e => e.closest('.field').className")
    check("side-a" in clsA, "A の欄に side-a が付く", clsA)
    check("side-b" in clsB, "B の欄に side-b が付く", clsB)
    lab = pg.evaluate("""() => {
      const f = document.querySelector('.field.side-a');
      const g = document.querySelector('.field.side-b');
      return [getComputedStyle(f.querySelector('label')).color,
              getComputedStyle(g.querySelector('label')).color];
    }""")
    check(lab[0] == BLUE and lab[1] == RED, "見出しの字も左右の色", lab)

    # ================= 2. ハンデありの勝利条件 =================
    section("2. ハンデありの目標（A=青／B=赤）")
    pg.fill("#inNameA", "たいら")
    pg.fill("#inNameB", "あいて")
    pg.wait_for_timeout(200)
    helpers.set_handicap_mode(pg, True)
    pg.wait_for_timeout(500)
    sides = pg.evaluate("""() => {
      const out = [];
      ['a', 'b'].forEach(function (s) {
        const f = [...document.querySelectorAll('#goalArea .field.side-' + s)];
        f.forEach(function (x) {
          const chip = x.querySelector('.chip[aria-pressed="true"]');
          const sel = x.querySelector('select');
          out.push({side: s, label: (x.querySelector('label') || {}).textContent,
                    chip: chip ? getComputedStyle(chip).borderTopColor : null,
                    sel: sel ? getComputedStyle(sel).borderTopColor : null});
        });
      });
      return out;
    }""")
    print("   " + str(sides))
    aa = [x for x in sides if x["side"] == "a"]
    bb = [x for x in sides if x["side"] == "b"]
    check(len(aa) >= 1 and len(bb) >= 1, "左右別の欄が出ている", sides)
    check(all((x["chip"] in (None, BLUE)) and (x["sel"] in (None, BLUE)) for x in aa),
          "A側の枠が青", aa)
    check(all((x["chip"] in (None, RED)) and (x["sel"] in (None, RED)) for x in bb),
          "B側の枠が赤", bb)
    pg.screenshot(path=os.path.join(SHOTS, "stage4_goal.png"), full_page=True)

    # ================= 3. JPAのスキルレベル =================
    section("3. JPAのスキルレベル（A=青／B=赤）")
    helpers.pick_game(pg, "jpa_9ball")
    pg.wait_for_timeout(600)
    jpa = pg.evaluate("""() => {
      const f = [...document.querySelectorAll('#goalArea .field')];
      return f.map(function (x) {
        const chip = x.querySelector('.chip[aria-pressed="true"]');
        return {cls: x.className, label: (x.querySelector('label') || {}).textContent,
                chip: chip ? getComputedStyle(chip).borderTopColor : null};
      });
    }""")
    print("   " + str(jpa))
    sa = [x for x in jpa if "side-a" in x["cls"]]
    sb = [x for x in jpa if "side-b" in x["cls"]]
    check(len(sa) == 1 and len(sb) == 1, "SLの欄が左右に分かれている", jpa)
    check(sa and sa[0]["chip"] == BLUE, "A のSLが青枠", sa)
    check(sb and sb[0]["chip"] == RED, "B のSLが赤枠", sb)
    pg.screenshot(path=os.path.join(SHOTS, "stage4_jpa.png"), full_page=True)

    # ================= 4. ホーム画面 =================
    section("4. ホームのカード")
    pg.click("#tabPlayers")
    pg.wait_for_timeout(400)
    pg.click("#toggleSelfBtn")
    pg.wait_for_timeout(200)
    pg.fill("#newPlayerName", "たいら")
    pg.wait_for_timeout(120)
    pg.click("#addPlayerBtn")
    pg.wait_for_timeout(400)
    pg.click("#tabHome")
    pg.wait_for_timeout(600)
    home = pg.evaluate("""() => {
      const t = document.querySelector('#homeBody .hc-title');
      const s = document.querySelector('#homeBody .home-stat');
      const c = document.querySelector('#homeBody .home-card');
      const g = t ? getComputedStyle(t) : null;
      return {
        title: g ? {bg: g.backgroundColor, img: g.backgroundImage.slice(0, 20),
                    font: g.fontFamily, size: g.fontSize} : null,
        stat: s ? {bg: getComputedStyle(s).backgroundColor,
                   img: getComputedStyle(s).backgroundImage.slice(0, 20)} : null,
        card: c ? {bw: getComputedStyle(c).borderTopWidth,
                   sh: getComputedStyle(c).boxShadow} : null,
      };
    }""")
    print("   " + str(home))
    check(home["title"] and home["title"]["bg"] == GOLD,
          "見出しの帯が金ブロックの色", home["title"])
    check(home["title"] and "radial" in home["title"]["img"],
          "帯の四隅にリベットがある", home["title"])
    check(home["title"] and "DotGothic16" in home["title"]["font"],
          "帯の字はドット文字", home["title"])
    check(home["stat"] and home["stat"]["bg"] == GOLD, "数字の欄も金ブロック", home["stat"])
    check(home["card"] and home["card"]["bw"] == "4px", "カードの枠が太い", home["card"])
    # 見出しの帯がカードの幅いっぱいに出ているか（左右が枠に接している）
    fit = pg.evaluate("""() => {
      const c = document.querySelector('#homeBody .home-card');
      const t = c.querySelector('.hc-title');
      const a = c.getBoundingClientRect(), b = t.getBoundingClientRect();
      return Math.round(b.left - a.left) + '/' + Math.round(a.right - b.right);
    }""")
    check(fit == "4/4", "帯がカードの幅いっぱい（左右とも枠のぶんだけ）", fit)
    pg.screenshot(path=os.path.join(SHOTS, "stage4_home.png"), full_page=True)

    section("JSエラー")
    check(not errs, "ページのJSエラーなし", errs[:3])
    br.close()

# ================= 5. アイコン =================
section("5. アイコンがアラミスブラックの9番")
im = Image.open(os.path.join(ROOT, "icon-192.png")).convert("RGB")
W, H = im.size
check((W, H) == (192, 192), "192x192", (W, H))


def near(px, want, tol=28):
    return all(abs(px[i] - want[i]) <= tol for i in range(3))


# 図柄は中央80%に置いてある。球の上端寄り（黒地）と中央（黄の帯）を見る
cx = W // 2
top = im.getpixel((cx, int(H * 0.28)))       # 球の上のほう＝黒地
band = im.getpixel((int(W * 0.24), H // 2))  # 帯の左寄り＝黄
mid = im.getpixel((cx, H // 2))              # 中央＝白丸か数字の黒
print("   上=%s 帯=%s 中央=%s" % (top, band, mid))
check(near(top, (20, 20, 20)), "球の地が黒（アラミス ブラック）", top)
check(near(band, (240, 193, 27)), "帯が1番の黄", band)
check(near(mid, (255, 255, 255)) or near(mid, (26, 20, 8)),
      "中央は白丸か数字の黒", mid)
# 以前の図案（黄色い球）に戻っていないこと
check(not near(top, (251, 208, 0)), "以前の黄色い球ではない", top)

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
