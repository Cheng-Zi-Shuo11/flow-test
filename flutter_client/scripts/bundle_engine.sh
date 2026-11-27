#!/usr/bin/env bash
# FlowTest Flutter 客户端 —— macOS 引擎打包脚本
#
# 把 Node 引擎运行时（src/、依赖）复制到 flutter_client/bundled_engine/。
# 运行时 EngineService 会优先在该目录查找 src/server.js。
# 注意：reports/flows/tests/web 不会被复制（Flutter UI 已取代 web 界面，
# flows/reports 由引擎在首次启动时自动创建）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_ROOT="$(cd "$CLIENT_DIR/.." && pwd)"
TARGET="$CLIENT_DIR/bundled_engine"

echo "==> 源项目: $SOURCE_ROOT"
echo "==> 目标目录: $TARGET"

if [ ! -f "$SOURCE_ROOT/src/server.js" ]; then
  echo "错误: 未找到 $SOURCE_ROOT/src/server.js，请在 flow-test 主项目内运行本脚本。" >&2
  exit 1
fi
if [ ! -d "$SOURCE_ROOT/node_modules/playwright" ]; then
  echo "错误: 未找到 playwright 依赖，请先在主项目执行 npm install。" >&2
  exit 1
fi

# 重建目标目录，避免旧文件残留（仅清理生成目录，不涉及用户数据）。
rm -rf "$TARGET"
mkdir -p "$TARGET"

echo "==> 复制 src/ ..."
cp -R "$SOURCE_ROOT/src" "$TARGET/src"

echo "==> 复制 package.json / package-lock.json ..."
cp "$SOURCE_ROOT/package.json" "$TARGET/package.json"
if [ -f "$SOURCE_ROOT/package-lock.json" ]; then
  cp "$SOURCE_ROOT/package-lock.json" "$TARGET/package-lock.json"
fi

echo "==> 复制 node_modules/ ..."
cp -R "$SOURCE_ROOT/node_modules" "$TARGET/node_modules"

# 体积提示
if command -v du >/dev/null 2>&1; then
  TOTAL_SIZE="$(du -sh "$TARGET" | cut -f1)"
else
  TOTAL_SIZE="未知"
fi
echo "==> 打包完成: $TARGET"
echo "==> 引擎目录体积: $TOTAL_SIZE"
echo "==> 下一步: 将 bundled_engine/ 放到构建产物中可执行文件同级目录后，再执行 flutter build macos。"
