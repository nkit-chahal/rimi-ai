@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "PY=C:\Users\Pc\miniconda3\envs\ankit\python.exe"
set "RQ_EXE=C:\Users\Pc\miniconda3\envs\ankit\Scripts\rq.exe"

if not exist "%PY%" set "PY=%USERPROFILE%\miniconda3\envs\ankit\python.exe"
if not exist "%RQ_EXE%" set "RQ_EXE=%USERPROFILE%\miniconda3\envs\ankit\Scripts\rq.exe"
if not exist "%PY%" (
    echo ERROR: ankit conda env python not found.
    echo Expected: C:\Users\Pc\miniconda3\envs\ankit\python.exe
    pause
    exit /b 1
)

cd /d "%ROOT%\backend"
if errorlevel 1 (
    echo ERROR: backend folder not found at %ROOT%\backend
    pause
    exit /b 1
)

set "REDIS_URL=redis://localhost:6379/0"
set "RQ_QUEUE_NAME=rimi-ai"

echo Running RQ SimpleWorker (no conda activate — uses ankit env directly)
echo Python: %PY%
echo Redis:  %REDIS_URL%
echo Queue:  %RQ_QUEUE_NAME%
echo.

if exist "%RQ_EXE%" (
    "%RQ_EXE%" worker --url %REDIS_URL% --worker-class rq.worker.SimpleWorker %RQ_QUEUE_NAME%
) else (
    "%PY%" -m rq.cli.cli worker --url %REDIS_URL% --worker-class rq.worker.SimpleWorker %RQ_QUEUE_NAME%
)

if errorlevel 1 (
    echo.
    echo Worker exited with an error. Is Redis running on localhost:6379?
    echo Start it with:  docker run -d --name rimi-redis -p 6379:6379 --restart unless-stopped redis:7-alpine
    pause
)
