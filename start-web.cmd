@echo off
cd /d "%~dp0"
set PYTHONUTF8=1
where uv >nul 2>nul
if errorlevel 1 (
  echo Install uv: https://docs.astral.sh/uv/getting-started/installation/
  pause
  exit /b 1
)
uv sync --locked
if errorlevel 1 (
  pause
  exit /b 1
)
uv run --locked python -m sandbox_bot --web
pause
