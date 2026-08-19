@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証
echo ========================================
echo.
echo [1/7] スコア計算エンジン
node _test\engine.test.js
if errorlevel 1 goto failed
echo.
echo [2/7] ショットクロック
node _test\shotclock.test.js
if errorlevel 1 goto failed
echo.
echo [3/7] チェスクロック
node _test\chessclock.test.js
if errorlevel 1 goto failed
echo.
echo [4/7] 実ブラウザでの通し確認
python _test\browser_test.py
if errorlevel 1 goto failed
echo.
echo [5/7] 新機能（JPA・プレーヤー・成績・時計）
python _test\features_test.py
if errorlevel 1 goto failed
echo.
echo [6/7] デザイン刷新（8bit・SL登録・延長1ラック1回・ブレイク表示・種目選択）
python _test\redesign_test.py
if errorlevel 1 goto failed
echo.
echo [7/7] 選手一覧・ボールハンデ・アプリ化
python _test\roster_handicap_test.py
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
