@echo off
cd /d "%~dp0"
echo.
echo  ============================================================
echo    Motor Simulasyonu  -  GitHub'a gonder
echo  ============================================================
echo.
echo  Depo : https://github.com/hexdevp/motorsimulasyon
echo.
echo  Ilk seferde GitHub giris penceresi acilacak.
echo  Tarayicidan giris yap, sonra bu pencere devam edecek.
echo.
pause
echo.

git push -u origin main
if errorlevel 1 goto :hata

echo.
echo  ============================================================
echo    GONDERILDI
echo  ============================================================
echo.
echo  SON ADIM - siteyi yayina almak icin:
echo.
echo    1. Su adrese git:
echo       https://github.com/hexdevp/motorsimulasyon/settings/pages
echo.
echo    2. "Source" kisminda  GitHub Actions  sec
echo.
echo    3. 2-3 dakika bekle
echo.
echo  Sitenin adresi:
echo    https://hexdevp.github.io/motorsimulasyon/
echo.
echo  Bundan sonra her degisiklikte GuncelleVeYayinla.bat yeter.
echo.
pause
exit /b 0

:hata
echo.
echo  ------------------------------------------------------------
echo   GONDERILEMEDI
echo  ------------------------------------------------------------
echo.
echo  Yukaridaki hata mesajini oku. Sik sebepler:
echo.
echo   * Giris yapilmadi veya iptal edildi
echo     -^> Bu dosyayi tekrar calistir
echo.
echo   * "Repository not found"
echo     -^> Depo adi motorsimulasyon mu, kontrol et
echo     -^> Depo hexdevp hesabinda mi, kontrol et
echo.
echo   * "non-fast-forward" veya "rejected"
echo     -^> Depo bos degil (README ile acilmis olabilir)
echo     -^> Depoyu silip bos olarak yeniden ac
echo.
pause
exit /b 1
