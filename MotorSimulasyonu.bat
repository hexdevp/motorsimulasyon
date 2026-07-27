@echo off
REM Motor Simulasyonu - baslatici
REM Derlenmis tek dosyayi varsayilan tarayicida acar.
REM Kurulum, internet baglantisi veya sunucu gerekmez.

cd /d "%~dp0"

if exist "dist\index.html" (
    start "" "dist\index.html"
    exit /b 0
)

echo.
echo   dist\index.html bulunamadi.
echo.
echo   Once uygulamayi derlemeniz gerekiyor:
echo.
echo     npm install
echo     npm run build
echo.
echo   Node.js kurulu degilse: https://nodejs.org
echo.
pause
