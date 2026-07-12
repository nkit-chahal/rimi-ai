@echo off
setlocal EnableExtensions
title RIM AI - Starting Services

cd /d "%~dp0"

echo ==================================================
echo   RIM AI - Starting Backend + Frontend
echo ==================================================

set "REDIS_EXE=Redis-x64-5.0.14.1\redis-server.exe"
set "REDIS_CONF=Redis-x64-5.0.14.1\redis.windows.conf"

:: Check if Redis is reachable on localhost:6379
echo [Redis] Checking localhost:6379 ...
python -c "import socket,sys; s=socket.socket(); s.settimeout(2); sys.exit(0 if s.connect_ex(('127.0.0.1',6379))==0 else 1)"
if errorlevel 1 (
    if exist "%REDIS_EXE%" (
        echo        Redis not detected — starting local Redis...
        if exist "%REDIS_CONF%" (
            start "RIM AI Redis" /D "%~dp0Redis-x64-5.0.14.1" redis-server.exe redis.windows.conf
        ) else (
            start "RIM AI Redis" /D "%~dp0Redis-x64-5.0.14.1" redis-server.exe
        )
        timeout /t 2 /nobreak >nul
        python -c "import socket,sys; s=socket.socket(); s.settimeout(2); sys.exit(0 if s.connect_ex(('127.0.0.1',6379))==0 else 1)"
        if errorlevel 1 (
            echo        Redis still not reachable on 6379. Jobs will fall back to in-process threads if Redis is down.
        ) else (
            echo        Redis started and reachable on localhost:6379
        )
    ) else (
        echo        Redis not detected on port 6379.
        echo        Local binary missing: %REDIS_EXE%
        echo        Jobs will fall back to in-process threads if Redis is down.
    )
) else (
    echo        Redis is already reachable on localhost:6379
)

:: Start Flask backend in conda env (new window)
echo [Backend] Launching backend (new window)...
start "RIM AI Backend" cmd /k "conda activate ankit && cd /d D:\RIMI_AI\backend && python server.py"

:: Start RQ worker in conda env (new window)
echo [Worker] Launching RQ worker (new window)...
start "RIM AI Worker" cmd /k "%~dp0scripts\start-worker.bat"

:: Wait a moment for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Vite frontend (new window)
echo [Frontend] Launching frontend (new window)...
start "RIM AI Frontend" cmd /k "cd /d D:\RIMI_AI && npm run dev"

echo.
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:5173
echo   Redis:    localhost:6379
echo ==================================================
echo.
echo Keep all windows open while developing.
echo.
