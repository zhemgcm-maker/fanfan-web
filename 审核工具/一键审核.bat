@echo off
chcp 65001 >nul
title Fanfan - review a submitted menu
cd /d "%~dp0.."

set "SCRIPT="
for %%F in ("%~dp0*.mjs") do set "SCRIPT=%%~fF"
if not defined SCRIPT goto noscript

node "%SCRIPT%" %*
echo.
echo ============================================
echo  Finished.
echo ============================================
pause >nul
exit /b 0

:noscript
echo [ERROR] review script not found in this folder.
pause >nul
