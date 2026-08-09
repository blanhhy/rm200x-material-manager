@echo off
setlocal
cd /d "%~dp0"

echo Launching RMM...
echo.

REM --- Check npm ---
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm not found. Please install Node.js first:
    echo         https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('npm --version') do set npm_version=%%v
echo [OK] npm found, version %npm_version%
echo.

REM --- Check dependencies ---
if not exist "node_modules" (
    echo [INFO] node_modules not found, installing dependencies...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] npm install failed. Check your network and retry.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed.
) else (
    echo [OK] Dependencies already installed.
)
echo.

REM --- Start dev server ---
echo Starting dev server... 
echo Ctrl+C to stop
echo.
call npm run dev

echo.
echo Dev server exited.
pause
