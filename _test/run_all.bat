@echo off
chcp 65001 > nul
cd /d "%~dp0\.."
echo ========================================
echo  ビリヤードスコア記録 検証（全数・並列）
echo ========================================
echo.
rem 一覧は _test\tests.tsv の1か所で管理する。
rem 1本ずつ順番に流すと実測で約32分かかっていたため、
rem run.py が並列で流すようにした（本人の指示 2026-08-22。実測12.3分）。
rem   手直しの最中は  python _test\run.py --only layout
rem   のように絞って流すほうが速い（数十秒）。
python _test\run.py %*
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
