@echo off
set SRC=%~dp0..\build-out-060\RefCollector Setup 0.6.0.exe
"%SRC%" /S /D=D:\Apps\RefCollector
echo EXITCODE=%ERRORLEVEL%
