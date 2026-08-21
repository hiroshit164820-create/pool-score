@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証
echo ========================================
echo.
echo [1/45] スコア計算エンジン
node _test\engine.test.js
if errorlevel 1 goto failed
echo.
echo [2/45] 5-9/5-10 の点数計算
node _test\money_game.test.js
if errorlevel 1 goto failed
echo.
echo [3/45] ショットクロック
node _test\shotclock.test.js
if errorlevel 1 goto failed
echo.
echo [4/45] チェスクロック
node _test\chessclock.test.js
if errorlevel 1 goto failed
echo.
echo [5/45] 実ブラウザでの通し確認
python _test\browser_test.py
if errorlevel 1 goto failed
echo.
echo [6/45] 新機能（JPA・プレーヤー・成績・時計）
python _test\features_test.py
if errorlevel 1 goto failed
echo.
echo [7/45] デザイン刷新（8bit・SL登録・延長1ラック1回・ブレイク表示・種目選択）
python _test\redesign_test.py
if errorlevel 1 goto failed
echo.
echo [8/45] 選手一覧・ボールハンデ・アプリ化
python _test\roster_handicap_test.py
if errorlevel 1 goto failed
echo.
echo [9/45] 勝利条件UI・ローテーション
python _test\rotation_goal_test.py
if errorlevel 1 goto failed
echo.
echo [10/45] 中断と再開・戻る・盤面の配色・ボウラード
python _test\session_test.py
if errorlevel 1 goto failed
echo.
echo [11/45] 表示の修正（選択の色・スコア表・数字の位置・点線・ルール説明）
python _test\slice1_test.py
if errorlevel 1 goto failed
echo.
echo [12/45] 1画面に収まっているか（種目8×画面4の全数）
python _test\layout_fit_test.py
if errorlevel 1 goto failed
echo.
echo [13/45] 先取点・マスワリ即記録
python _test\slice2_test.py
if errorlevel 1 goto failed
echo.
echo [14/45] 試合メモ
python _test\note_test.py
if errorlevel 1 goto failed
echo.
echo [15/45] カイルン（複数人・専用画面）
python _test\kailun_test.py
if errorlevel 1 goto failed
echo.
echo [16/45] 下部タブとホーム
python _test\tabbar_test.py
if errorlevel 1 goto failed
echo.
echo [17/45] 練習配置
python _test\layout_test.py
if errorlevel 1 goto failed
echo.
echo [18/45] 配置図の見た目と操作性
python _test\layout_touch_test.py
if errorlevel 1 goto failed
echo.
echo [19/45] 自分の登録
python _test\self_player_test.py
if errorlevel 1 goto failed
echo.
echo [20/45] 5-9/5-10 の画面
python _test\money_ui_test.py
if errorlevel 1 goto failed
echo.
echo [21/45] 配置図（ポケット・左右のボタン・メモ）
python _test\layout2_test.py
if errorlevel 1 goto failed
echo.
echo [22/45] 設定画面（種目カード・ゲスト・ハンデ・まとめ）
python _test\setup2_test.py
if errorlevel 1 goto failed
echo.
echo [23/45] JPA・成績・履歴（イニング／マスワリ／絞り込み／CSV）
python _test\stats2_test.py
if errorlevel 1 goto failed
echo.
echo [24/45] 5-9/5-10のデザイン変更・JPA8ボールのポイント・通知の位置
python _test\money2_test.py
if errorlevel 1 goto failed
echo.
echo [25/45] 配置図の線・使うボール削除・通知の長さ・終了画面（第3便）
python _test\tune3_test.py
if errorlevel 1 goto failed
echo.
echo [26/45] 台の潰れ・ローテのスコア・番号・セット数・横向き（08-21）
python _test\tune4_test.py
if errorlevel 1 goto failed
echo.
echo [27/45] カイルンの人選び・JPAダブルス表・履歴の作り直し（08-21 2便目）
python _test\tune5_test.py
if errorlevel 1 goto failed
echo.
echo [28/45] 履歴の絞り込みにハウスゲーム（08-21 3便目）
python _test\tune6_test.py
if errorlevel 1 goto failed
echo.
echo [29/45] 配置図に直線を引く（08-21 3便目）
python _test\line_test.py
if errorlevel 1 goto failed
echo.
echo [30/45] 横向きのスコアボード・記録ボタンの置き場（08-21 3便目）
python _test\land_test.py
if errorlevel 1 goto failed
echo.
echo [31/45] 一般種目とJPAの内訳・パートナー別（08-21 3便目）
python _test\stats3_test.py
if errorlevel 1 goto failed
echo.
echo [32/45] 配置図の描画（なぞった通りの線・08-20 追加）
python _test\draw_test.py
if errorlevel 1 goto failed
echo.
echo [33/45] 種目別でさらに詳しくカード（08-21 段階7）
python _test\detail_test.py
if errorlevel 1 goto failed
echo.
echo [34/45] 長い名前とW-Lの重なり・中断中カードの×の幅（08-21）
python _test\fix2_test.py
if errorlevel 1 goto failed
echo.
echo [35/45] 番号1px・JPAポイント率・5-9マスワリ・試合画面の作り直し（08-21 4便目）
python _test\tune7_test.py
if errorlevel 1 goto failed
echo.
echo [36/45] 縦向きの試合画面の作り直し（08-21 B: 交代とブレイクを1行・帯を上へ）
python _test\tune8_test.py
if errorlevel 1 goto failed
echo.
echo [37/45] 選手のクラス・プロフィール編集（08-21 C）
python _test\class_test.py
if errorlevel 1 goto failed
echo.
echo [38/45] 成績管理の作り直し・ホーム5件（08-21 D/E）
python _test\stats4_test.py
if errorlevel 1 goto failed
echo.
echo [39/45] 履歴の件数切り替え・ダブルス2段・SLの位置（08-21 F）
python _test\hist2_test.py
if errorlevel 1 goto failed
echo.
echo [40/45] 球単位の種目のマスワリ・ブレイクエース（08-21 不具合）
python _test\flag_jpa_test.py
if errorlevel 1 goto failed
echo.
echo [41/45] 試合画面の作り直し（08-21 下の帯・無効球・イニング自動）
python _test\match2_test.py
if errorlevel 1 goto failed
echo.
echo [42/45] 選手・成績（08-21 段階3 種目別成績の削除・自分の扱い）
python _test\stage3_test.py
if errorlevel 1 goto failed
echo.
echo [43/45] 見た目（08-21 段階4 左右の色・ホームのカード・アイコン）
python _test\stage4_test.py
if errorlevel 1 goto failed
echo.
echo [44/45] イニングを数えるかの選択（08-21 一般種目）
python _test\innings_opt_test.py
if errorlevel 1 goto failed
echo.
echo [45/45] 説明書の体裁（08-21 manual.html）
python _test\manual_test.py
if errorlevel 1 goto failed
echo.
echo ========================================
echo  すべて成功しました
echo ========================================
pause
exit /b 0

:failed
echo.
echo ========================================
echo  失敗した項目があります（上の NG を確認してください）
echo ========================================
pause
exit /b 1
