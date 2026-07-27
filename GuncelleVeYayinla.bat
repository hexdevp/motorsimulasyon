@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ============================================================
echo    Degisiklikleri GitHub'a gonder ve yayinla
echo  ============================================================
echo.

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo  Bu klasor bir git deposu degil.
  echo  Once "GitHubaYukle.bat" dosyasini calistir.
  pause
  exit /b 1
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  echo  Uzak depo bagli degil.
  echo  Once "GitHubaYukle.bat" dosyasini calistir.
  pause
  exit /b 1
)

echo  Degisen dosyalar:
echo.
git status --short
echo.

git diff --quiet && git diff --cached --quiet
if not errorlevel 1 (
  echo  Degisiklik yok, gonderilecek bir sey bulunmuyor.
  pause
  exit /b 0
)

set "MSG="
set /p MSG="  Bu degisiklik neydi? (kisa aciklama): "
if "!MSG!"=="" set "MSG=Guncelleme"

echo.
echo  Gonderiliyor...
git add -A
git commit -q -m "!MSG!"
if errorlevel 1 goto :hata

git push
if errorlevel 1 goto :hata

for /f "delims=" %%u in ('git remote get-url origin') do set "URL=%%u"

echo.
echo  ============================================================
echo    GONDERILDI
echo  ============================================================
echo.
echo  GitHub once testleri calistiracak, gecerse yayinlayacak.
echo  Durumu buradan izleyebilirsin:
echo    !URL:~0,-4!/actions
echo.
echo  Genelde 1-2 dakika surer.
echo.
pause
exit /b 0

:hata
echo.
echo  Bir hata olustu. Yukaridaki mesaji kontrol et.
pause
exit /b 1
