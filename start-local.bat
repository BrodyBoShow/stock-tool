@echo off
REM ── StockBud local dev launcher ──────────────────────────────────────────
REM Double-click to bring the API (:8000) and web app (:5173) up in their own
REM minimized windows. They keep running after you close this launcher, and
REM after the Claude session ends. %~dp0 = this file's folder, so it's portable.
set "ROOT=%~dp0"

REM Backend — FastAPI on :8000. No --reload here: the auto-reloader spawns a
REM child process that fails in a detached window, which is why it wouldn't stay
REM up. For active backend dev, run uvicorn with --reload in a normal terminal.
start "StockBud API" /min /d "%ROOT%" "%ROOT%.venv\Scripts\python.exe" -m uvicorn api.main:app --host 127.0.0.1 --port 8000

REM Frontend — Vite on :5173 (strict, to match the CORS allow-list).
start "StockBud Web" /min /d "%ROOT%frontend" cmd /c "npm run dev -- --port 5173 --strictPort"

echo Starting StockBud:  API http://localhost:8000   Web http://localhost:5173
echo You can close THIS window; the servers keep running in the background.
timeout /t 3 >nul
