@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証
echo ========================================
echo.
echo [1/25] スコア計算エンジン
node _test\engine.test.js
if errorlevel 1 goto failed
echo.
echo [2/25] 5-9/5-10 の点数計算
node _test\money_game.test.js
if errorlevel 1 goto failed
echo.
echo [3/25] ショットクロック
node _test\shotclock.test.js
if errorlevel 1 goto failed
echo.
echo [4/25] チェスクロック
node _test\chessclock.test.js
if errorlevel 1 goto failed
echo.
echo [5/25] 実ブラウザでの通し確認
python _test\browser_test.py
if errorlevel 1 goto failed
echo.
echo [6/25] 新機能（JPA・プレーヤー・成績・時計）
python _test\features_test.py
if errorlevel 1 goto failed
echo.
echo [7/25] デザイン刷新（8bit・SL登録・延長1ラック1回・ブレイク表示・種目選択）
python _test\redesign_test.py
if errorlevel 1 goto failed
echo.
echo [8/25] 選手一覧・ボールハンデ・アプリ化
python _test\roster_handicap_test.py
if errorlevel 1 goto failed
echo.
echo [9/25] 勝利条件UI・ローテーション
python _test\rotation_goal_test.py
if errorlevel 1 goto failed
echo.
echo [10/25] 中断と再開・戻る・盤面の配色・ボウラード
python _test\session_test.py
if errorlevel 1 goto failed
echo.
echo [11/25] 表示の修正（選択の色・スコア表・数字の位置・点線・ルール説明）
python _test\slice1_test.py
if errorlevel 1 goto failed
echo.
echo [12/25] 1画面に収まっているか（種目8×画面4の全数）
python _test\layout_fit_test.py
if errorlevel 1 goto failed
echo.
echo [13/25] 先取点・マスワリ即記録
python _test\slice2_test.py
if errorlevel 1 goto failed
echo.
echo [14/25] 試合メモ
python _test\note_test.py
if errorlevel 1 goto failed
echo.
echo [15/25] カイルン（ハウスゲーム）
python _test\kailun_test.py
if errorlevel 1 goto failed
echo.
echo [16/25] 下部タブとホーム
python _test\tabbar_test.py
if errorlevel 1 goto failed
echo.
echo [17/25] 練習配置
python _test\layout_test.py
if errorlevel 1 goto failed
echo.
echo [18/25] 配置図の見た目と操作性
python _test\layout_touch_test.py
if errorlevel 1 goto failed
echo.
echo [19/25] 自分の登録
python _test\self_player_test.py
if errorlevel 1 goto failed
echo.
echo [20/25] 5-9/5-10 の画面
python _test\money_ui_test.py
if errorlevel 1 goto failed
echo.
echo [21/25] 配置図（ポケット・左右のボタン・メモ）
python _test\layout2_test.py
if errorlevel 1 goto failed
echo.
echo [22/25] 設定画面（種目カード・ゲスト・ハンデ・まとめ）
python _test\setup2_test.py
if errorlevel 1 goto failed
echo.
echo [23/25] JPA・成績・履歴（イニング／マスワリ／絞り込み／CSV）
python _test\stats2_test.py
if errorlevel 1 goto failed
echo.
echo [24/25] 5-9/5-10のデザイン変更・JPA8ボールのポイント・通知の位置
python _test\money2_test.py
if errorlevel 1 goto failed
echo.
echo [25/25] 配置図の線・使うボール削除・通知の長さ・終了画面（第3便）
python _test\tune3_test.py
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
