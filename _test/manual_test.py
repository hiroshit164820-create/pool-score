# -*- coding: utf-8 -*-
"""manual_test.py — 説明書（manual.html）の体裁

本人の指示（2026-08-21）:
  「このアプリ、システムの説明書を作成してください。
    デザインの世界観はアプリと揃えてください」

対象:
  1. 狭い画面（360px）でもページ本体が横スクロールしない
     （表だけは .table-scroll の中で横に流す）
  2. 本文が15pxを下回らない（非IT利用者も読むため）
  3. 目次のリンク先が全部ある
  4. 見た目がアプリと揃っている（空色の地・ドット書体の見出し・
     金ブロックの看板・レンガのヘッダ）
  5. アプリへ戻るリンクがある
  6. JSエラーが無い

実行: python _test/manual_test.py
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file:///" + ROOT.replace(chr(92), "/") + "/manual.html"
SHOTS = os.path.join(ROOT, "_test", "shots")
if not os.path.isdir(SHOTS):
    os.makedirs(SHOTS)

# style.css の配色トークンと同じであること
SKY = "rgb(92, 148, 252)"
GOLD = "rgb(251, 208, 0)"
BRICK = "rgb(200, 76, 12)"

results = []


def check(cond, label, detail=""):
    results.append((bool(cond), label, detail))
    print(("OK  " if cond else "NG  ") + label
          + (("  -> " + str(detail)) if detail and not cond else ""))


def section(name):
    print("\n-- " + name + " --")


PROBE = """() => {
  const de = document.documentElement;
  // 補足（.hint）は小さくてよい。本文は15pxを下回らせない
  const small = [...document.querySelectorAll('p, li, td, th')]
    .filter(e => e.textContent.trim() && !e.classList.contains('hint'))
    .filter(e => parseFloat(getComputedStyle(e).fontSize) < 15)
    .map(e => e.tagName + ':' + Math.round(parseFloat(getComputedStyle(e).fontSize)));
  // 表とコード例は箱の中で横に流す作りなので、その中身は数えない
  const over = [...document.querySelectorAll('.wrap *')]
    .filter(e => !e.closest('.table-scroll') && !e.closest('pre'))
    .filter(e => e.getBoundingClientRect().right > de.clientWidth + 1)
    .map(e => e.tagName + '.' + e.className);
  const h2 = document.querySelector('h2');
  const header = document.querySelector('header');
  return {
    docW: de.scrollWidth, cliW: de.clientWidth,
    small: small.slice(0, 6), over: over.slice(0, 6),
    heads: [...document.querySelectorAll('h2')].map(e => e.textContent.trim()),
    links: [...document.querySelectorAll('.toc a')].map(a => a.getAttribute('href')),
    ids: [...document.querySelectorAll('[id]')].map(e => e.id),
    h2font: getComputedStyle(h2).fontFamily,
    h2bg: getComputedStyle(h2).backgroundColor,
    h2rivet: getComputedStyle(h2).backgroundImage.slice(0, 8),
    headerBg: getComputedStyle(header).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    tables: [...document.querySelectorAll('table')]
      .filter(t => !t.closest('.table-scroll')).length,
    backLinks: [...document.querySelectorAll('a')]
      .filter(a => (a.getAttribute('href') || '') === './').length,
  };
}"""

with sync_playwright() as p:
    br = p.chromium.launch()

    section("1. 画面の幅に収まる")
    for w, h in [(390, 844), (360, 640), (320, 568), (1280, 900)]:
        pg = br.new_page(viewport={"width": w, "height": h})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL)
        pg.wait_for_timeout(1200)
        r = pg.evaluate(PROBE)
        check(r["docW"] <= r["cliW"] + 1, "%dpx 横スクロールしない" % w,
              (r["docW"], r["cliW"]))
        check(not r["over"], "%dpx はみ出す要素が無い（表の中は除く）" % w, r["over"])
        check(not errs, "%dpx JSエラーなし" % w, errs[:2])

        if w == 390:
            section("2. 読みやすさ")
            check(not r["small"], "本文が15px以上", r["small"])

            section("3. 中身がそろっている")
            check(len(r["heads"]) == 11, "見出しが11個", r["heads"])
            missing = [l[1:] for l in r["links"] if l[1:] not in r["ids"]]
            check(not missing, "目次のリンク先がすべてある", missing)
            check(len(r["links"]) == len(r["heads"]),
                  "目次の数と見出しの数が合う", (len(r["links"]), len(r["heads"])))
            check(r["backLinks"] >= 1, "アプリへ戻るリンクがある", r["backLinks"])
            check(r["tables"] == 0, "表はすべて横スクロールの箱に入っている", r["tables"])

            section("4. 見た目がアプリと揃っている")
            check(r["bodyBg"] == SKY, "地が空色（--sky）", r["bodyBg"])
            check(r["h2bg"] == GOLD, "見出しが金ブロック（--block）", r["h2bg"])
            check("radial" in r["h2rivet"], "見出しの四隅にリベット", r["h2rivet"])
            check("DotGothic16" in r["h2font"], "見出しがドット書体", r["h2font"])
            check(r["headerBg"] == BRICK, "ヘッダがレンガ色（--brick）", r["headerBg"])
            pg.screenshot(path=os.path.join(SHOTS, "manual.png"), full_page=True)
        pg.close()

    br.close()

ng = [r for r in results if not r[0]]
print("\n合計 %d 件 / NG %d 件" % (len(results), len(ng)))
for r in ng:
    print("  NG: " + r[1] + ("  -> " + str(r[2]) if r[2] else ""))
sys.exit(1 if ng else 0)
