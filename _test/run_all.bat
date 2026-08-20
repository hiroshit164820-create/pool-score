@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証
echo ========================================
echo.
echo [1/17] スコア計算エンジン
node _test\engine.test.js
if errorlevel 1 goto failed
echo.
echo [2/17] ショットクロック
node _test\shotclock.test.js
if errorlevel 1 goto failed
echo.
echo [3/17] チェスクロック
node _test\chessclock.test.js
if errorlevel 1 goto failed
echo.
echo [4/17] 実ブラウザでの通し確認
python _test\browser_test.py
if errorlevel 1 goto failed
echo.
echo [5/17] 新機能（JPA・プレーヤー・成績・時計）
python _test\features_test.py
if errorlevel 1 goto failed
echo.
echo [6/17] デザイン刷新（8bit・SL登録・延長1ラック1回・ブレイク表示・種目選択）
python _test\redesign_test.py
if errorlevel 1 goto failed
echo.
echo [7/17] 選手一覧・ボールハンデ・アプリ化
python _test\roster_handicap_test.py
if errorlevel 1 goto failed
echo.
echo [8/17] 勝利条件UI・ローテーション
python _test\rotation_goal_test.py
if errorlevel 1 goto failed
echo.
echo [9/17] 中断と再開・戻る・ボールセット・ボウラード
python _test\session_test.py
if errorlevel 1 goto failed
echo.
echo [10/17] 表示の修正（選択の色・スコア表・数字の位置・点線・ルール説明）
python _test\slice1_test.py
if errorlevel 1 goto failed
echo.
echo [11/17] 1画面に収まっているか（種目8×画面4の全数）
python _test\layout_fit_test.py
if errorlevel 1 goto failed
echo.
echo [12/17] 先取点・マスワリ即記録
python _test\slice2_test.py
if errorlevel 1 goto failed
echo.
echo [13/17] 試合メモ
python _test
ote_test.py
if errorlevel 1 goto failed
echo.
echo [14/17] カイルン（ハウスゲーム）
python _test\kailun_test.py
if errorlevel 1 goto failed
echo.
echo [15/17] 下部タブとホーム
python _test	abbar_test.py
if errorlevel 1 goto failed
echo.
echo [16/17] 練習配置
python _test\layout_test.py
if errorlevel 1 goto failed
echo.
echo [17/17] 配置図の見た目と操作性
python _test\layout_touch_test.py
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
