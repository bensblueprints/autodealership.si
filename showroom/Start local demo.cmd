@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>&1 || (echo Install Python 3 to run the local demo. & pause & exit /b 1)
python serve.py
if errorlevel 1 pause
