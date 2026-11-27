#!/usr/bin/env bash
# FlowTest Flutter 客户端初始化
#
# 在安装好 Flutter SDK 后运行一次，完成：
#   1. 生成 macos/ 与 windows/ 平台工程目录
#   2. 修补 macOS 沙盒配置（允许启动内嵌 Node 引擎并访问本地端口）
#   3. 拉取依赖
#   4. 静态检查
#
# 用法：bash scripts/setup-flutter.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT="$ROOT/flutter_client"

echo "==> 检查 Flutter..."
if ! command -v flutter >/dev/null 2>&1; then
  echo "错误: 未找到 flutter 命令。" >&2
  echo "请先安装 Flutter SDK 并加入 PATH，参考 DISTRIBUTION.md。" >&2
  exit 1
fi
flutter --version | head -n 2

cd "$CLIENT"

# flutter create 可能重写 pubspec.yaml，先备份再恢复
echo "==> 备份 pubspec.yaml..."
cp pubspec.yaml pubspec.yaml.bak

echo "==> 生成平台工程目录..."
flutter create --platforms=macos,windows .

echo "==> 恢复 pubspec.yaml..."
mv pubspec.yaml.bak pubspec.yaml

# flutter create 会生成引用模板 MyApp 的 widget_test.dart，本项目有自己的测试文件，
# 保留模板测试会导致 analyze 直接报错。
if [ -f test/widget_test.dart ]; then
  rm -f test/widget_test.dart
  echo "==> 已移除模板测试 test/widget_test.dart"
fi

# ---------- 修补 macOS entitlements ----------
# Flutter macOS 默认开启 App Sandbox，沙盒内无法启动外部进程（内嵌 Node 引擎），
# 且默认未授予出站网络权限。这里显式关闭沙盒并放开网络。
#
# 直接写完整 XML：不要用 plistlib 往返读写，一旦写入中途失败会清空文件。
echo "==> 修补 macOS entitlements..."
ENTITLEMENTS_CONTENT='<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.app-sandbox</key>
	<false/>
	<key>com.apple.security.cs.allow-jit</key>
	<true/>
	<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
	<true/>
	<key>com.apple.security.cs.disable-library-validation</key>
	<true/>
	<key>com.apple.security.network.client</key>
	<true/>
	<key>com.apple.security.network.server</key>
	<true/>
</dict>
</plist>
'

if [ -d macos/Runner ]; then
  for name in DebugProfile.entitlements Release.entitlements; do
    printf '%s' "$ENTITLEMENTS_CONTENT" > "macos/Runner/$name"
    echo "  已写入 macos/Runner/$name"
  done
else
  echo "  [跳过] macos/Runner 不存在（请先生成平台工程）"
fi

echo "==> 拉取 Flutter 依赖..."
flutter pub get

echo "==> 静态检查..."
flutter analyze || echo "警告: analyze 有告警，请查看上方输出"

echo ""
echo "==> 初始化完成"
echo "    开发运行: cd flutter_client && flutter run -d macos"
echo "    打包:     bash scripts/package-macos.sh"
