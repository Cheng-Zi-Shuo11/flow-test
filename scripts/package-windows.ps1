# FlowTest Windows 打包脚本
#
# 前置：已执行 flutter build windows --release
# 产物：dist\FlowTest-Windows-x64.zip（解压后双击 FlowTest.exe 即可运行）
#
# 与 macOS 脚本对应，做四件事：
#   1. 组装 Node 引擎（src + node_modules）
#   2. 内置 node.exe，接收方无需安装 Node
#   3. 复制到构建产物 exe 同级目录的 bundled_engine
#   4. 打包为 zip

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Client = Join-Path $Root "flutter_client"
$Release = Join-Path $Client "build\windows\x64\runner\Release"
$Bundle = Join-Path $Client "bundled_engine"
$Dist = Join-Path $Root "dist"

Write-Host "==> 项目根目录: $Root"

if (-not (Test-Path $Release)) {
    Write-Error "未找到 Windows 构建产物，请先执行：cd flutter_client; flutter build windows --release"
    exit 1
}

# ---------- 1. 组装引擎 ----------
Write-Host "==> 组装 Node 引擎..."
if (Test-Path $Bundle) { Remove-Item $Bundle -Recurse -Force }
New-Item -ItemType Directory -Path $Bundle | Out-Null

Copy-Item (Join-Path $Root "src") -Destination $Bundle -Recurse
Copy-Item (Join-Path $Root "package.json") -Destination $Bundle
if (Test-Path (Join-Path $Root "package-lock.json")) {
    Copy-Item (Join-Path $Root "package-lock.json") -Destination $Bundle
}
Copy-Item (Join-Path $Root "node_modules") -Destination $Bundle -Recurse

# ---------- 2. 内置 Node 运行时 ----------
if ($env:FLOWTEST_NODE_BIN -and (Test-Path $env:FLOWTEST_NODE_BIN)) {
    $NodeBin = $env:FLOWTEST_NODE_BIN
} else {
    $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $NodeCmd) {
        Write-Error "未找到 node，可通过环境变量 FLOWTEST_NODE_BIN 指定 node.exe 路径"
        exit 1
    }
    $NodeBin = $NodeCmd.Source
}
Write-Host "==> 内置 Node: $NodeBin"
Copy-Item $NodeBin (Join-Path $Bundle "node.exe")

# ---------- 3. 放入构建产物 ----------
Write-Host "==> 复制引擎到应用目录..."
$TargetBundle = Join-Path $Release "bundled_engine"
if (Test-Path $TargetBundle) { Remove-Item $TargetBundle -Recurse -Force }
Copy-Item $Bundle -Destination $TargetBundle -Recurse

# ---------- 4. 打包 zip ----------
Write-Host "==> 生成压缩包..."
if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Path $Dist | Out-Null

$ZipPath = Join-Path $Dist "FlowTest-Windows-x64.zip"
Compress-Archive -Path (Join-Path $Release "*") -DestinationPath $ZipPath -CompressionLevel Optimal

$SizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "==> 打包完成"
Write-Host "    产物: $ZipPath"
Write-Host "    体积: ${SizeMb} MB"
Write-Host ""
Write-Host "分发提示：解压后双击 FlowTest.exe。"
Write-Host "若 SmartScreen 拦截，点「更多信息」→「仍要运行」。"
