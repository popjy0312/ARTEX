@echo off
rem Use UTF-8 so console output renders consistently.
chcp 65001 >nul 2>&1
rem ARTEX supervisor startup script (Windows)
rem
rem Usage:
rem   start.bat                  Run in the foreground (Ctrl-C to stop)
rem   start.bat -addr :9000      Pass extra arguments through to artex
rem
rem Start artex.exe and restart it according to the process exit code.
rem
rem   0      Normal exit       -> stop the loop
rem   other  Crash              -> retry with backoff (1->2->4... up to 60s)

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "BIN=artex.exe"
if not exist "%BIN%" (
	echo [artex] executable not found: %BIN% 1>&2
	exit /b 1
)

set "MAX_DELAY=60"
set /a delay=1

:loop
"%BIN%" %*
set "code=!ERRORLEVEL!"

if "!code!"=="0" (
	echo [artex] exited normally
	exit /b 0
)

echo [artex] exited unexpectedly ^(code=!code!^); restarting in !delay!s 1>&2
rem timeout can fail when the console is redirected; use ping as a fallback.
set /a pings=!delay!+1
ping -n !pings! 127.0.0.1 >nul 2>&1
set /a delay=!delay!*2
if !delay! gtr %MAX_DELAY% set /a delay=%MAX_DELAY%
goto loop
