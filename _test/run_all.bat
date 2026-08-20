@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証
echo ========================================
echo.
echo [1/22] スコア計算エンジン
node _test\engine.test.js
if errorlevel 1 goto failed
echo.
echo [2/22] 5-9/5-10 の点数計算
node _test\money_game.test.js
if errorlevel 1 goto failed
echo.
echo [3/22] ショットクロック
node _test\shotclock.test.js
if errorlevel 1 goto failed
echo.
echo [4/22] チェスクロック
node _test\chessclock.test.js
if errorlevel 1 goto failed
echo.
echo [5/22] 実ブラウザでの通し確認
python _test\browser_test.py
if errorlevel 1 goto failed
echo.
echo [6/22] 新機能（JPA・プレーヤー・成績・時計）
python _test\features_test.py
if errorlevel 1 goto failed
echo.
echo [7/22] デザイン刷新（8bit・SL登録・延長1ラック1回・ブレイク表示・種目選択）
python _test\redesign_test.py
if errorlevel 1 goto failed
echo.
echo [8/22] 選手一覧・ボールハンデ・アプリ化
python _test\roster_handicap_test.py
if errorlevel 1 goto failed
echo.
echo [9/22] 勝利条件UI・ローテーション
python _test\rotation_goal_test.py
if errorlevel 1 goto failed
echo.
echo [10/22] 中断と再開・戻る・ボールセット・ボウラード
python _test\session_test.py
if errorlevel 1 goto failed
echo.
echo [11/22] 表示の修正（選択の色・スコア表・数字の位置・点線・ルール説明）
python _test\slice1_test.py
if errorlevel 1 goto failed
echo.
echo [12/22] 1画面に収まっているか（種目8×画面4の全数）
python _test\layout_fit_test.py
if errorlevel 1 goto failed
echo.
echo [13/22] 先取点・マスワリ即記録
python _test\slice2_test.py
if errorlevel 1 goto failed
echo.
echo [14/22] 試合メモ
python _test\note_test.py
if errorlevel 1 goto failed
echo.
echo [15/22] カイルン（ハウスゲーム）
python _test\kailun_test.py
if errorlevel 1 goto failed
echo.
echo [16/22] 下部タブとホーム
python _test\tabbar_test.py
if errorlevel 1 goto failed
echo.
echo [17/22] 練習配置
python _test\layout_test.py
if errorlevel 1 goto failed
echo.
echo [18/22] 配置図の見た目と操作性
python _test\layout_touch_test.py
if errorlevel 1 goto failed
echo.
echo [19/22] 自分の登録
python _test\self_player_test.py
if errorlevel 1 goto failed
echo.
echo [20/22] 5-9/5-10 の画面
python _test\money_ui_test.py
if errorlevel 1 goto failed
echo.
echo [21/22] 配置図（ポケット・左右のボタン・メモ）
python _test\layout2_test.py
if errorlevel 1 goto failed
echo.
echo [22/22] 設定画面（種目カード・ゲスト・ハンデ・まとめ）
python _test\setup2_test.py
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
