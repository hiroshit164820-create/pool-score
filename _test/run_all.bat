@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証
echo ========================================
echo.
echo [1/11] スコア計算エンジン
node _test\engine.test.js
if errorlevel 1 goto failed
echo.
echo [2/11] ショットクロック
node _test\shotclock.test.js
if errorlevel 1 goto failed
echo.
echo [3/11] チェスクロック
node _test\chessclock.test.js
if errorlevel 1 goto failed
echo.
echo [4/11] 実ブラウザでの通し確認
python _test\browser_test.py
if errorlevel 1 goto failed
echo.
echo [5/11] 新機能（JPA・プレーヤー・成績・時計）
python _test\features_test.py
if errorlevel 1 goto failed
echo.
echo [6/11] デザイン刷新（8bit・SL登録・延長1ラック1回・ブレイク表示・種目選択）
python _test\redesign_test.py
if errorlevel 1 goto failed
echo.
echo [7/11] 選手一覧・ボールハンデ・アプリ化
python _test\roster_handicap_test.py
if errorlevel 1 goto failed
echo.
echo [8/11] 勝利条件UI・ローテーション
python _test\rotation_goal_test.py
if errorlevel 1 goto failed
echo.
echo [9/11] 中断と再開・戻る・ボールセット・ボウラード
python _test\session_test.py
if errorlevel 1 goto failed
echo.
echo [10/11] 表示の修正（選択の色・スコア表・数字の位置・点線・ルール説明）
python _test\slice1_test.py
if errorlevel 1 goto failed
echo.
echo [11/11] 1画面に収まっているか（種目8×画面4の全数）
python _test\layout_fit_test.py
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
