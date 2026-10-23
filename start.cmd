@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 某些终端会继承 ELECTRON_RUN_AS_NODE，会导致 Electron 退化成纯 Node，这里强制清掉
set ELECTRON_RUN_AS_NODE=

if not exist "dist\index.html" (
  echo [RefCollector] 首次启动，正在构建前端...
  call npm run build
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [RefCollector] 依赖未安装，正在安装...
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  call npm install
)

echo [RefCollector] 启动中...
start "" "node_modules\electron\dist\electron.exe" .
