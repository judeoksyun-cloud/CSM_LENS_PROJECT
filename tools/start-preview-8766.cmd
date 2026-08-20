@echo off
setlocal
cd /d "%~dp0.."
set PORT=8766
if exist ".env" (
  node --env-file=.env tools\preview-server.mjs
) else (
  node tools\preview-server.mjs
)
