@echo off
setlocal EnableExtensions
title RIM AI - Starting Services

echo ==================================================
echo   RIM AI - Starting Backend + Frontend
echo ==================================================

:: Check if Redis is reachable on localhost:6379
echo [Redis] Checking localhost:6379 ...
python -c "import socket,sys; s=socket.socket(); s.settimeout(2); sys.exit(0 if s.connect_ex(('127.0.0.1',6379))==0 else 1)"
if errorlevel 1 (
    echo        Redis not detected on port 6379.
    echo        Start it with:  docker run -d --name rimi-redis -p 6379:6379 --restart unless-stopped redis:7-alpine
    echo        Or start your existing container. Jobs will fall back to in-process threads if Redis is down.
) else (
    echo        Redis is reachable on localhost:6379
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
