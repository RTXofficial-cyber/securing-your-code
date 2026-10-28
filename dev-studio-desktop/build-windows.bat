@echo off
REM ============================================================
REM  Dev Studio - one-click Windows build
REM  Double-click this file. It installs, tests, builds and packs
REM  the Windows installers into the "release" folder.
REM
REM  Needs: Node.js 18+ (https://nodejs.org) and internet access
REM  the first time (to download Electron).
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo [1/5] Checking Node.js...
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & goto :err)
node -v

echo.
echo [2/5] Installing dependencies (first run takes a few minutes)...
call npm ci || call npm install --no-audit --no-fund || goto :err

echo.
echo [3/5] Running the test suite...
call npm run test:logic || goto :err
call npm run test:ui || goto :err

echo.
echo [4/5] Building the renderer...
call npm run build || goto :err

echo.
echo [5/5] Packaging the Windows .exe (installer + portable)...
call npm run dist:win || goto :err

echo.
echo ============================================================
echo  DONE. Your files are in:  %cd%\release
echo    Dev Studio Setup x.x.x.exe   - installer
echo    Dev Studio x.x.x.exe         - portable, no install
echo ============================================================
explorer "%cd%\release"
exit /b 0

:err
echo.
echo BUILD FAILED - read the message above, fix it, then run this file again.
pause
exit /b 1
