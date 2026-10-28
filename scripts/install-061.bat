@echo off
set SRC=%~dp0..\build-out-061\RefCollector Setup 0.6.1.exe
"%SRC%" /S /D=D:\Apps\RefCollector
echo EXITCODE=%ERRORLEVEL%
