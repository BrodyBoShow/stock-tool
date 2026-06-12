@echo off
REM Double-click to run StockBud locally and open it in your browser.
REM Two small terminal windows open (the API + the web server). Closing
REM those windows stops the site. Nothing runs in the background otherwise.
cd /d "%~dp0"
start "StockBud API" ".venv\Scripts\python.exe" -m uvicorn api.main:app --port 8000
start "StockBud Web" cmd /c "npm --prefix frontend run dev"
echo Starting StockBud... the browser will open in a few seconds.
timeout /t 5 >nul
start "" http://localhost:5173
