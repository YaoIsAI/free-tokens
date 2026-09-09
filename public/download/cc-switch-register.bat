@echo off
title FreeAPIs - Register ccswitch:// protocol (portable fix)
echo ============================================================
echo   FreeAPIs Token Station - Register ccswitch:// protocol
echo   For portable/green CC Switch builds.
echo   The official installer already registers it - no need.
echo ============================================================
echo.
setlocal
set "EXE="

REM 1) Try the running cc-switch.exe first (works for portable builds)
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Process -Name 'cc-switch' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"') do set "EXE=%%i"

REM 2) Fallback: common install directories
if not defined EXE (
  for %%p in ("%LOCALAPPDATA%\Programs\com.ccswitch.desktop\cc-switch.exe" "%LOCALAPPDATA%\Programs\CC Switch\cc-switch.exe" "%LOCALAPPDATA%\Programs\cc-switch\cc-switch.exe" "%ProgramFiles%\CC Switch\cc-switch.exe" "%ProgramFiles%\cc-switch\cc-switch.exe") do if exist "%%~p" set "EXE=%%~p"
)

if not defined EXE (
  echo [ERROR] cc-switch.exe not found.
  echo Please start CC Switch first, then run this script again.
  echo.
  pause
  exit /b 1
)

echo Found CC Switch: %EXE%
echo.
reg add "HKCU\Software\Classes\ccswitch" /ve /d "URL:ccswitch Protocol" /f >nul
reg add "HKCU\Software\Classes\ccswitch" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\ccswitch\DefaultIcon" /ve /d "\"%EXE%\",0" /f >nul
reg add "HKCU\Software\Classes\ccswitch\shell\open\command" /ve /d "\"%EXE%\" \"%%1\"" /f >nul

echo.
echo Registration done! Go back to the website and click
echo "Import to CC Switch" - it should open the import dialog now.
echo (Writes only to the current user registry HKCU, no admin needed.)
echo.
pause
