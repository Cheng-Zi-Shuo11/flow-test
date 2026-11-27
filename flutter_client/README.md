# FlowTest Flutter 客户端

FlowTest 的桌面客户端：用 Flutter 提供界面，内嵌 Node.js 执行引擎，双击即可使用，无需手动启动 Web 服务。

## 项目定位与架构

```
┌─────────────────────────────────────────────┐
│ Flutter 桌面 UI（macOS / Windows）           │
│   流程编辑 / 运行控制 / 报告查看              │
└──────────────────┬──────────────────────────┘
                   │ HTTP  http://127.0.0.1:3777
┌──────────────────▼──────────────────────────┐
│ Node 引擎（bundled_engine/src/server.js）    │
│   解析 → 执行 → 报告（原生 http，无框架）     │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│ Playwright + Chromium / 系统 Chrome、Edge    │
└─────────────────────────────────────────────┘
```

- 客户端启动时 `EngineService.start()` 在后台拉起 Node 引擎，轮询 `GET /api/config` 健康检查（最多 15 秒），就绪后由 API 层调用引擎接口。
- 引擎目录定位优先级：构造参数 `engineDir` → 环境变量 `FLOWTEST_ENGINE_DIR` → 可执行文件同级的 `bundled_engine/` → 开发模式下主项目 `flow-test/`（Flutter 项目的上级目录）。
- 若端口上已有健康服务则直接复用，不重复启动进程。
- 引擎进程输出保留最近 20000 字符，可通过 `EngineService.output` 查看，便于排障。

## 开发模式运行

前置条件：Flutter SDK（桌面支持已启用）、Node.js >= 20、主项目已执行 `npm install`。

```bash
cd /Users/chengzishuo/work/fy/flow-test/flutter_client
flutter pub get

# macOS
flutter run -d macos

# Windows
flutter run -d windows
```

开发模式下引擎直接定位到上级 `flow-test/` 主项目，无需先打包引擎。也可显式指定：

```bash
export FLOWTEST_ENGINE_DIR=/Users/chengzishuo/work/fy/flow-test
export FLOWTEST_NODE_BIN=$(which node)
flutter run -d macos
```

## 引擎打包（构建前必做）

先把主项目的引擎与依赖复制到 `flutter_client/bundled_engine/`：

```bash
# macOS / Linux / Git Bash
cd /Users/chengzishuo/work/fy/flow-test/flutter_client
bash scripts/bundle_engine.sh

# Windows（CMD）
cd /Users/chengzishuo/work/fy/flow-test/flutter_client
scripts\bundle_engine.bat
```

脚本只复制 `src/`、`package.json`、`package-lock.json`、`node_modules/`，自动排除 `reports/`、`flows/`、`tests/`，并输出目录体积提示。`reports/` 与 `flows/` 由引擎首次运行时自动创建。

打包完成后，需要将 `bundled_engine/` 放到构建产物中**可执行文件同级目录**，客户端才能按约定找到引擎（macOS 为 `FlowTest.app/Contents/MacOS/bundled_engine/`）。

Windows 还需要单独的 `node.exe`（Node >= 20）。可选辅助脚本：

```bash
# 在 Git Bash / WSL 中，下载 Windows 版 Node 到 flutter_client/bundled_runtime/windows-x64/
bash ../scripts/bundle-node.sh windows-x64
# 设置 FLOWTEST_NODE_BIN 指向解压出的 node.exe，或把 node.exe 放到 bundled_engine/ 同级
```

手动下载方式见 `scripts/bundle_engine.bat` 顶部注释（nodejs.org/dist）。

## 构建桌面应用

```bash
# macOS
flutter build macos
# 产物：build/macos/Build/Products/Release/flow_test.app

# Windows
flutter build windows
# 产物：build\windows\x64\runner\Release\
```

构建后按上一节把 `bundled_engine/`（及 Windows 的 `node.exe`）放进产物对应位置，再分发。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `FLOWTEST_LLM_API_KEY` | LLM API Key；不设置则使用内置规则解析，功能不受影响 |
| `FLOWTEST_LLM_ENDPOINT` | LLM 接口地址，默认 `https://api.openai.com/v1/chat/completions` |
| `FLOWTEST_LLM_MODEL` | 模型名，默认 `gpt-4o-mini` |
| `FLOWTEST_ENGINE_DIR` | 强制指定引擎目录（含 `src/server.js`），覆盖自动定位 |
| `FLOWTEST_NODE_BIN` | 强制指定 Node 可执行文件，覆盖 PATH 查找 |

以上环境变量由引擎进程继承；客户端自身监听端口固定为 `3777`（由 `EngineService(port: ...)` 控制，默认 3777，会作为 `PORT` 传给引擎）。

## 浏览器依赖

引擎基于 Playwright 执行真实浏览器操作，二选一即可：

1. 系统已安装 Chrome 或 Edge（Web 界面默认可选系统 Chrome），无需额外下载；
2. 下载 Playwright 自带 Chromium：在主项目执行 `npx playwright install chromium`。打包分发时目标机器需能访问浏览器，建议预装 Chrome/Edge。

## 已知限制

- **包体积**：`node_modules/playwright` 与 Playwright Chromium 体积较大；若只使用系统 Chrome/Edge，可考虑在打包时裁剪浏览器缓存以减小体积。
- **首次启动白名单**：macOS Gatekeeper / Windows SmartScreen 可能拦截未签名的 `node` 可执行文件。首次运行需在系统设置中手动允许，或在终端执行 `xattr -cr <应用路径>` 去除隔离属性后再打开。
- 仅支持桌面端（macOS / Windows），`dart:io` 依赖使其无法在 Web 端运行。
- 引擎使用固定端口 3777；若被其他程序占用且该程序不响应 `/api/config`，启动会失败。
