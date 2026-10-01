@echo off
REM Color Brawl adb wrapper.
REM
REM PowerShell's argument binder strips tokens that collide with its own parameter
REM names, so "monkey -p pkg" loses its -p and even adb's -s serial. cmd.exe has no
REM such binder, so every adb call in this project goes through this shim.
REM
REM Usage:  cb-adb.cmd logcat -d -v time
REM         cb-adb.cmd shell input tap 1200 540

"D:\Android SDK\platform-tools\adb.exe" -s emulator-5554 %*
exit /b %ERRORLEVEL%
