@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証
echo ========================================
echo.
echo [1/31] スコア計算エンジン
node _test\engine.test.js
if errorlevel 1 goto failed
echo.
echo [2/31] 5-9/5-10 の点数計算
node _test\money_game.test.js
if errorlevel 1 goto failed
echo.
echo [3/31] ショットクロック
node _test\shotclock.test.js
if errorlevel 1 goto failed
echo.
echo [4/31] チェスクロック
node _test\chessclock.test.js
if errorlevel 1 goto failed
echo.
echo [5/31] 実ブラウザでの通し確認
python _test\browser_test.py
if errorlevel 1 goto failed
echo.
echo [6/31] 新機能（JPA・プレーヤー・成績・時計）
python _test\features_test.py
if errorlevel 1 goto failed
echo.
echo [7/31] デザイン刷新（8bit・SL登録・延長1ラック1回・ブレイク表示・種目選択）
python _test\redesign_test.py
if errorlevel 1 goto failed
echo.
echo [8/31] 選手一覧・ボールハンデ・アプリ化
python _test\roster_handicap_test.py
if errorlevel 1 goto failed
echo.
echo [9/31] 勝利条件UI・ローテーション
python _test\rotation_goal_test.py
if errorlevel 1 goto failed
echo.
echo [10/31] 中断と再開・戻る・盤面の配色・ボウラード
python _test\session_test.py
if errorlevel 1 goto failed
echo.
echo [11/31] 表示の修正（選択の色・スコア表・数字の位置・点線・ルール説明）
python _test\slice1_test.py
if errorlevel 1 goto failed
echo.
echo [12/31] 1画面に収まっているか（種目8×画面4の全数）
python _test\layout_fit_test.py
if errorlevel 1 goto failed
echo.
echo [13/31] 先取点・マスワリ即記録
python _test\slice2_test.py
if errorlevel 1 goto failed
echo.
echo [14/31] 試合メモ
python _test\note_test.py
if errorlevel 1 goto failed
echo.
echo [15/31] カイルン（複数人・専用画面）
python _test\kailun_test.py
if errorlevel 1 goto failed
echo.
echo [16/31] 下部タブとホーム
python _test\tabbar_test.py
if errorlevel 1 goto failed
echo.
echo [17/31] 練習配置
python _test\layout_test.py
if errorlevel 1 goto failed
echo.
echo [18/31] 配置図の見た目と操作性
python _test\layout_touch_test.py
if errorlevel 1 goto failed
echo.
echo [19/31] 自分の登録
python _test\self_player_test.py
if errorlevel 1 goto failed
echo.
echo [20/31] 5-9/5-10 の画面
python _test\money_ui_test.py
if errorlevel 1 goto failed
echo.
echo [21/31] 配置図（ポケット・左右のボタン・メモ）
python _test\layout2_test.py
if errorlevel 1 goto failed
echo.
echo [22/31] 設定画面（種目カード・ゲスト・ハンデ・まとめ）
python _test\setup2_test.py
if errorlevel 1 goto failed
echo.
echo [23/31] JPA・成績・履歴（イニング／マスワリ／絞り込み／CSV）
python _test\stats2_test.py
if errorlevel 1 goto failed
echo.
echo [24/31] 5-9/5-10のデザイン変更・JPA8ボールのポイント・通知の位置
python _test\money2_test.py
if errorlevel 1 goto failed
echo.
echo [25/31] 配置図の線・使うボール削除・通知の長さ・終了画面（第3便）
python _test\tune3_test.py
if errorlevel 1 goto failed
echo.
echo [26/31] 台の潰れ・ローテのスコア・番号・セット数・横向き（08-21）
python _test\tune4_test.py
if errorlevel 1 goto failed
echo.
echo [27/31] カイルンの人選び・JPAダブルス表・履歴の作り直し（08-21 2便目）
python _test\tune5_test.py
if errorlevel 1 goto failed
echo.
echo [28/31] 履歴の絞り込みにハウスゲーム（08-21 3便目）
python _test\tune6_test.py
if errorlevel 1 goto failed
echo.
echo [29/31] 配置図に直線を引く（08-21 3便目）
python _test\line_test.py
if errorlevel 1 goto failed
echo.
echo [30/31] 横向きのスコアボード・記録ボタンの置き場（08-21 3便目）
python _test\land_test.py
if errorlevel 1 goto failed
echo.
echo [31/31] 一般種目とJPAの内訳・パートナー別（08-21 3便目）
python _test\stats3_test.py
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
