#!/usr/bin/env bash
# FlowTest macOS 打包脚本
#
# 前置：已执行 flutter build macos --release
# 产物：dist/FlowTest-macOS-<arch>.dmg
#
# 做四件事：
#   1. 把 Node 引擎（src + node_modules）和 Node 运行时打进 bundled_engine/
#   2. 复制到 .app/Contents/MacOS/bundled_engine（EngineService 会在此查找）
#   3. ad-hoc 签名，避免完全未签名导致的启动拦截
#   4. 生成带首次打开说明的 DMG

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLIENT="$ROOT/flutter_client"
BUILD_DIR="$CLIENT/build/macos/Build/Products/Release"
DIST="$ROOT/dist"
BUNDLE="$CLIENT/bundled_engine"
APP_NAME="FlowTest"
ARCH="$(uname -m)"

echo "==> 项目根目录: $ROOT"

if [ ! -d "$BUILD_DIR" ]; then
  echo "错误: 未找到 macOS 构建产物，请先执行：cd flutter_client && flutter build macos --release" >&2
  exit 1
fi

APP_PATH="$(find "$BUILD_DIR" -maxdepth 1 -name "*.app" | head -n 1)"
if [ -z "$APP_PATH" ]; then
  echo "错误: 在 $BUILD_DIR 中未找到 .app" >&2
  exit 1
fi
echo "==> 应用: $APP_PATH"

# ---------- 1. 组装引擎目录 ----------
echo "==> 组装 Node 引擎..."
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"

cp -R "$ROOT/src" "$BUNDLE/src"
cp "$ROOT/package.json" "$BUNDLE/package.json"
[ -f "$ROOT/package-lock.json" ] && cp "$ROOT/package-lock.json" "$BUNDLE/package-lock.json"
cp -R "$ROOT/node_modules" "$BUNDLE/node_modules"

# ---------- 2. 内置 Node 运行时 ----------
NODE_BIN="${FLOWTEST_NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ] || [ ! -f "$NODE_BIN" ]; then
  echo "错误: 未找到 node，可通过 FLOWTEST_NODE_BIN 指定" >&2
  exit 1
fi
echo "==> 内置 Node: $NODE_BIN"
cp "$NODE_BIN" "$BUNDLE/node"
chmod +x "$BUNDLE/node"

# ---------- 3. 放入 App Bundle ----------
echo "==> 复制引擎到 App Bundle..."
mkdir -p "$APP_PATH/Contents/MacOS"
rm -rf "$APP_PATH/Contents/MacOS/bundled_engine"
cp -R "$BUNDLE" "$APP_PATH/Contents/MacOS/bundled_engine"

# ---------- 4. ad-hoc 签名 ----------
echo "==> ad-hoc 签名..."
codesign --force --deep --sign - "$APP_PATH" 2>/dev/null || {
  echo "警告: ad-hoc 签名失败，应用仍可运行但首次打开需手动放行" >&2
}

# ---------- 5. 生成 DMG ----------
echo "==> 生成 DMG..."
rm -rf "$DIST"
mkdir -p "$DIST"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP_PATH" "$STAGE/"
cp "$ROOT/scripts/MACOS-首次打开说明.txt" "$STAGE/" 2>/dev/null || true

DMG_PATH="$DIST/FlowTest-macOS-${ARCH}.dmg"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG_PATH" >/dev/null

echo ""
echo "==> 打包完成"
echo "    产物: $DMG_PATH"
echo "    体积: $(du -sh "$DMG_PATH" | cut -f1)"
echo ""
echo "分发提示：接收方首次打开若提示「无法验证开发者」，"
echo "按住 Control 点击应用 → 打开，或在终端执行："
echo "  xattr -dr com.apple.quarantine /Applications/FlowTest.app"
