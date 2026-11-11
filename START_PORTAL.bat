@echo off
chcp 65001 >nul
title نبض الملاعب AI - تشغيل المنصة بضغطة واحدة
cd /d "%~dp0"

echo ========================================================
echo   ⚽ جاري تشغيل موقع الأخبار الرياضي الأوتوماتيكي...
echo ========================================================

:: فتح المتصفح تلقائياً على رابط المنصة بعد ثانيتين
start "" http://localhost:8000

:: إذا كان Python مثبتاً يعمل عبر FastAPI، وإلا يعمل تلقائياً عبر الخادم المدمج السريع
where python >nul 2>nul
if %errorlevel%==0 (
    python -c "import fastapi, uvicorn" >nul 2>nul
    if %errorlevel%==0 (
        uvicorn main:app --host 127.0.0.1 --port 8000
        goto :eof
    )
)

node server.js
pause
