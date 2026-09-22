@echo off
chcp 65001 >nul
title 饭饭web 上传到 GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0上传到GitHub.ps1"
