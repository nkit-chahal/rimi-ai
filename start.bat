@echo off
title RIM AI - Starting Services
echo ==================================================
echo   RIM AI - Starting Backend + Frontend
echo ==================================================

:: Start Flask backend in conda env (new window)
start "RIM AI Backend" cmd /k "conda activate ankit && cd /d D:\RIMI_AI\backend && python server.py"

:: Wait a moment for backend to initialize
timeout /t 3 /nobreak >nul

:: Start Vite frontend (new window)
start "RIM AI Frontend" cmd /k "cd /d D:\RIMI_AI && npm run dev"

echo.
echo   Backend: http://localhost:3001
echo   Frontend: http://localhost:5173
echo ==================================================
