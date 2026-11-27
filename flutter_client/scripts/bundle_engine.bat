@echo off
REM FlowTest Flutter 客户端 —— Windows 引擎打包脚本
REM 把 Node 引擎运行时复制到 flutter_client\bundled_engine\。
REM 与 macOS 版一致：只复制 src/、package.json、package-lock.json、node_modules/，
REM 排除 reports/flows/tests/web（Flutter UI 已取代 web 界面）。
REM
REM Windows 版 node.exe 准备指引：
REM   1. 访问 https://nodejs.org/dist/ 选择 LTS 版本（需 Node >= 20）；
REM   2. 下载 node-vXX.XX.XX-win-x64.zip 并解压，取出 node.exe；
REM   3. 将 node.exe 放到本脚本生成的 bundled_engine\ 目录，
REM      并设置环境变量 FLOWTEST_NODE_BIN=<路径>\bundled_engine\node.exe；
REM   4. 也可把 node.exe 放到应用可执行文件同级目录，引擎服务会自动尝试。
REM   可用主项目的 scripts\bundle-node.sh windows 自动下载（需 Git Bash / WSL）。
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%"
set "CLIENT_DIR=%CD%"
popd
pushd "%CLIENT_DIR%\.."
set "SOURCE_ROOT=%CD%"
popd
set "TARGET=%CLIENT_DIR%\bundled_engine"

echo === Source: %SOURCE_ROOT%
echo === Target: %TARGET%

if not exist "%SOURCE_ROOT%\src\server.js" (
  echo ERROR: src\server.js not found. Run this script inside flow-test project.
  exit /b 1
)
if not exist "%SOURCE_ROOT%\node_modules\playwright" (
  echo ERROR: playwright not found. Run "npm install" in the main project first.
  exit /b 1
)

REM 仅清理生成目录，不涉及用户数据。
if exist "%TARGET%" rd /s /q "%TARGET%"
md "%TARGET%"

echo === Copying src/ ...
robocopy "%SOURCE_ROOT%\src" "%TARGET%\src" /E /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% GEQ 8 goto :failed

echo === Copying package.json / package-lock.json ...
copy /Y "%SOURCE_ROOT%\package.json" "%TARGET%\package.json" >nul
if errorlevel 1 goto :failed
if exist "%SOURCE_ROOT%\package-lock.json" (
  copy /Y "%SOURCE_ROOT%\package-lock.json" "%TARGET%\package-lock.json" >nul
)

echo === Copying node_modules/ ...
robocopy "%SOURCE_ROOT%\node_modules" "%TARGET%\node_modules" /E /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% GEQ 8 goto :failed

echo === Done: %TARGET%
powershell -NoProfile -Command "$p='%TARGET%'; $s=(Get-ChildItem -LiteralPath $p -Recurse -File | Measure-Object -Property Length -Sum).Sum; Write-Host ('=== Engine size: {0:N1} MB' -f ($s/1MB))"
echo === Next: copy bundled_engine\ next to the built executable, then run "flutter build windows".
exit /b 0

:failed
echo ERROR: bundling failed (robocopy errorlevel %ERRORLEVEL%).
exit /b 1
