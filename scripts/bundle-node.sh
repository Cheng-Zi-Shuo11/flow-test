#!/usr/bin/env bash
# FlowTest —— 为 Flutter 客户端准备独立 Node 运行时（可选辅助脚本）
#
# 用法：
#   ./scripts/bundle-node.sh [平台] [输出目录]
#   平台: macos-arm64 | macos-x64 | windows-x64 （默认按当前机器推断）
#   输出目录默认: flutter_client/bundled_runtime/<平台>
#
# 产物可直接作为 FLOWTEST_NODE_BIN 使用；Windows 打包时把 node.exe
# 放到 bundled_engine/ 或应用可执行文件同级目录亦可。
# 可通过环境变量 NODE_VERSION 覆盖默认版本（需 >= 20）。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_VERSION="${NODE_VERSION:-v20.19.0}"

detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin)
      [ "$arch" = "arm64" ] && echo "macos-arm64" || echo "macos-x64"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "windows-x64"
      ;;
    Linux)
      echo "windows-x64" # Linux 下常用于交叉准备 Windows 的 node.exe
      ;;
    *)
      echo "macos-arm64"
      ;;
  esac
}

PLATFORM="${1:-$(detect_platform)}"
OUT_DIR="${2:-$PROJECT_ROOT/flutter_client/bundled_runtime/$PLATFORM}"

case "$PLATFORM" in
  macos-arm64)
    PKG="node-${NODE_VERSION}-darwin-arm64"
    ARCHIVE="${PKG}.tar.gz"
    BIN_REL="${PKG}/bin/node"
    ;;
  macos-x64)
    PKG="node-${NODE_VERSION}-darwin-x64"
    ARCHIVE="${PKG}.tar.gz"
    BIN_REL="${PKG}/bin/node"
    ;;
  windows-x64)
    PKG="node-${NODE_VERSION}-win-x64"
    ARCHIVE="${PKG}.zip"
    BIN_REL="${PKG}/node.exe"
    ;;
  *)
    echo "未知平台: $PLATFORM（可选 macos-arm64 / macos-x64 / windows-x64）" >&2
    exit 1
    ;;
esac

BASE_URL="https://nodejs.org/dist/${NODE_VERSION}"
DOWNLOAD_URL="${BASE_URL}/${ARCHIVE}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> 下载 Node ${NODE_VERSION} (${PLATFORM})"
echo "==> ${DOWNLOAD_URL}"
curl -fL --retry 3 -o "$TMP_DIR/$ARCHIVE" "$DOWNLOAD_URL"

mkdir -p "$OUT_DIR"
echo "==> 解压到 $OUT_DIR"
if [[ "$ARCHIVE" == *.zip ]]; then
  command -v unzip >/dev/null 2>&1 || {
    echo "错误: 解压 zip 需要 unzip，请先安装或用 Windows 版 bundle_engine.bat 指引手动下载。" >&2
    exit 1
  }
  unzip -q -o "$TMP_DIR/$ARCHIVE" -d "$OUT_DIR"
else
  tar -xzf "$TMP_DIR/$ARCHIVE" -C "$OUT_DIR"
fi

BIN_PATH="$OUT_DIR/$BIN_REL"
if [ ! -f "$BIN_PATH" ]; then
  echo "错误: 未找到解压后的可执行文件 $BIN_PATH" >&2
  exit 1
fi
chmod +x "$BIN_PATH" 2>/dev/null || true

echo "==> 完成: $BIN_PATH"
echo "==> 启动时设置: export FLOWTEST_NODE_BIN=\"$BIN_PATH\""
