@echo off
setlocal
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo ERROR: msedge.exe not found. Open the .html file manually.
  pause
  exit /b 1
)
for %%F in ("%~dp0*.html") do start "" "%EDGE%" "%%~fF"
exit /b 0
