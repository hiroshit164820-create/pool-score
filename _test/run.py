# -*- coding: utf-8 -*-
"""run.py — 検証をまとめて流す（本人の指示 2026-08-22）

本人の困りごと:
  「毎回50本もテストする必要があるの？
    一つ手直しするたびにものすごい時間がかかるのどうにかならない」

直列で1本ずつ流すと**実測で約32分**かかっていた（2026-08-22 04:38→05:10）。
このPCは論理24コアあるのに1本ずつしか動かしていなかったのが原因。

  ・既定で **並列** に流す（同時に走る本数は --jobs で変えられる）
  ・**名前で絞れる**（手直しの最中は関係するものだけ流す）
  ・**遅い順の所要時間**を出す（どこが重いか分かる）

一覧は tests.tsv の1か所で管理する。テストを足したらそこに1行足す。

使い方:
  python _test/run.py                  … 全部を並列で流す
  python _test/run.py --only layout    … 名前に layout を含むものだけ
  python _test/run.py --only paste share
  python _test/run.py --jobs 4         … 同時に走らせる本数
  python _test/run.py --serial         … 1本ずつ（並列で結果が変わるか確かめる用）

終了コード: 1本でも落ちたら 1
"""
import io
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LIST = os.path.join(HERE, "tests.tsv")


def load_tests():
    rows = []
    with io.open(LIST, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            runner, name = parts[0], parts[1]
            desc = parts[2] if len(parts) > 2 else ""
            rows.append({"runner": runner, "name": name, "desc": desc})
    return rows


def parse_args(argv):
    opts = {"only": [], "jobs": None, "serial": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--only":
            i += 1
            while i < len(argv) and not argv[i].startswith("--"):
                opts["only"].append(argv[i])
                i += 1
            continue
        if a == "--jobs":
            i += 1
            opts["jobs"] = int(argv[i])
        elif a == "--serial":
            opts["serial"] = True
        elif a in ("-h", "--help"):
            print(__doc__)
            sys.exit(0)
        else:
            # 素で渡された言葉は --only と同じ扱いにする
            opts["only"].append(a)
        i += 1
    return opts


def run_one(t):
    path = os.path.join("_test", t["name"])
    t0 = time.time()
    r = subprocess.run([t["runner"], path], cwd=ROOT, capture_output=True)
    t["sec"] = time.time() - t0
    t["code"] = r.returncode
    t["out"] = r.stdout.decode("utf-8", "replace")
    t["err"] = r.stderr.decode("utf-8", "replace")
    print(("OK  " if t["code"] == 0 else "NG  ")
          + "%-26s %5.1f秒  %s" % (t["name"], t["sec"], t["desc"]))
    return t


def main():
    opts = parse_args(sys.argv[1:])
    tests = load_tests()
    if opts["only"]:
        tests = [t for t in tests
                 if any(k.lower() in t["name"].lower() for k in opts["only"])]
        if not tests:
            print("その名前に当てはまる検証がありません: " + " ".join(opts["only"]))
            return 1

    # 同時に走らせる本数。ブラウザを立てるので、コア数より控えめにする
    cpu = os.cpu_count() or 4
    jobs = 1 if opts["serial"] else (opts["jobs"] or max(2, min(10, cpu - 2)))

    print("%d本を%s実行します（同時 %d本）" %
          (len(tests), "1本ずつ" if jobs == 1 else "並列で", jobs))
    print("-" * 60)

    t0 = time.time()
    if jobs == 1:
        done = [run_one(t) for t in tests]
    else:
        with ThreadPoolExecutor(max_workers=jobs) as ex:
            done = list(ex.map(run_one, tests))
    total = time.time() - t0

    ng = [t for t in done if t["code"] != 0]
    print("-" * 60)
    print("合計 %d本 / NG %d本 / %.1f秒（%.1f分）"
          % (len(done), len(ng), total, total / 60))

    slow = sorted(done, key=lambda t: -t["sec"])[:5]
    print("遅い順: " + " / ".join("%s %.0f秒" % (t["name"], t["sec"]) for t in slow))

    for t in ng:
        print("\n" + "=" * 60)
        print("NG " + t["name"] + "（" + t["desc"] + "）")
        print("=" * 60)
        # 落ちた項目だけを拾う。無ければ末尾を出す
        bad = [l for l in t["out"].split("\n") if l.startswith("NG ")]
        if bad:
            print("\n".join(bad[:20]))
        print(t["out"][-1500:])
        if t["err"].strip():
            print("--- 標準エラー ---")
            print(t["err"][-1000:])
    return 1 if ng else 0


if __name__ == "__main__":
    sys.exit(main())
