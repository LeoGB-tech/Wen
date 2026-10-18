@echo off
title Ancre
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est necessaire : https://nodejs.org  ^(version 20 ou plus^)
  pause
  exit /b
)
if not exist node_modules (
  echo Installation des dependances...
  call npm install --omit=dev
)
node server.js --open
pause
