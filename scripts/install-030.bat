@echo off
set SRC=D:\download\wbAI\save\test\refcollector\build-out-030\RefCollector Setup 0.3.0.exe
echo Installing %SRC%
"%SRC%" /S /D=D:\Apps\RefCollector
echo EXITCODE=%ERRORLEVEL%
