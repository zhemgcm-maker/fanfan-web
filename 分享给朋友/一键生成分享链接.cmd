@echo off
chcp 65001 >nul
title Meal Agent Share Link
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
echo.
echo (window can be closed)
pause >nul
