# 打包与分发指南

本文说明如何从 macOS 开发机产出可分发的安装包，以及接收方如何安装。

## 分发包里有什么

每个安装包都是自包含的，接收方**不需要安装 Node.js、不需要装开发环境**：

```
FlowTest.app (或 FlowTest.exe)
└── Contents/MacOS/
    ├── FlowTest            Flutter 界面
    └── bundled_engine/
        ├── node            Node 运行时（约 90MB）
        ├── src/            测试引擎
        └── node_modules/   Playwright 等依赖
```

唯一外部依赖是浏览器：需要有 Chrome 或 Edge。Windows 自带 Edge，macOS 需要用户自己装一个。

## 关键限制

| | macOS | Windows |
|---|---|---|
| 在本机 Mac 构建 | ✅ 可以 | ❌ 不可以 |
| 需要 Apple 账号 | 不需要（手动放行） | — |
| 构建环境 | 当前 Mac | Windows 机器或 GitHub Actions |

Flutter 不支持在 macOS 上交叉编译 Windows 桌面应用。要在 Mac 上产出 Windows 包，只能走 CI。

---

## 方式一：本机打包 macOS

### 1. 装 Flutter

```bash
cd ~/work/fy
curl -L -o flutter_macos.zip \
  "https://storage.flutter-io.cn/flutter_infra_release/releases/stable/macos/flutter_macos_arm64_3.50.1-stable.zip"
unzip -q flutter_macos.zip && mv flutter flutter-sdk

echo 'export PATH="$HOME/work/fy/flutter-sdk/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
flutter doctor
```

### 2. 生成平台工程目录（首次）

```bash
cd ~/work/fy/flow-test/flutter_client
flutter create --platforms=macos --project-name flowtest_client .
flutter pub get
```

### 3. 构建并打包

```bash
cd ~/work/fy/flow-test
cd flutter_client && flutter build macos --release && cd ..
bash scripts/package-macos.sh
```

产物：`dist/FlowTest-macOS-arm64.dmg`

### 4. 发给别人

直接发 DMG。对方打开后把 App 拖进「应用程序」，首次启动按住 Control 点击 → 打开。

DMG 里已附带 `MACOS-首次打开说明.txt`。

---

## 方式二：GitHub Actions 出双平台包

### 1. 推代码到 GitHub

```bash
cd ~/work/fy/flow-test
git init
git add .
git commit -m "feat: FlowTest desktop client"
git branch -M main
git remote add origin https://github.com/<你的账号>/flow-test.git
git push -u origin main
```

### 2. 打 tag 触发构建

```bash
git tag v0.1.0
git push origin v0.1.0
```

构建完成后：
- Actions 页面的 Artifacts 里有 `FlowTest-macOS` 和 `FlowTest-Windows`
- 同时自动创建 Release，两个包都挂在里面，可直接分享下载链接

也可以不打包，在 Actions 页面点 `Run workflow` 手动触发，产物只在 Artifacts 里（保留 90 天）。

### 3. 构建耗时

首次约 10–15 分钟（要下载 Flutter SDK 和依赖），之后有缓存约 5 分钟。

---

## 方式三：Windows 机器本地构建

如果手边有 Windows 电脑：

```powershell
# 1. 装 Flutter（同版本）
#    下载 https://storage.flutter-io.cn/flutter_infra_release/releases/stable/windows/flutter_windows_3.50.1-stable.zip
#    解压到 C:\flutter，把 C:\flutter\bin 加入 PATH

# 2. 装 Node.js 20（用于内置运行时）
#    https://nodejs.org/dist/v20.19.0/node-v20.19.0-win-x64.zip

# 3. 构建
cd flow-test
npm ci
cd flutter_client
flutter create --platforms=windows --project-name flowtest_client .
flutter pub get
flutter build windows --release
cd ..
powershell -ExecutionPolicy Bypass -File scripts/package-windows.ps1
```

产物：`dist\FlowTest-Windows-x64.zip`

---

## 接收方安装说明

### macOS

1. 双击 DMG，把 FlowTest 拖进「应用程序」
2. 首次打开：按住 Control 点击应用 → 打开 → 再点「打开」
3. 若提示「已损坏」：终端执行 `xattr -dr com.apple.quarantine /Applications/FlowTest.app`
4. 确保已安装 Chrome 或 Edge

### Windows

1. 解压 zip 到任意目录（不要只解压 exe，`bundled_engine` 目录必须和 exe 在一起）
2. 双击 `FlowTest.exe`
3. SmartScreen 拦截时点「更多信息」→「仍要运行」
4. 系统自带 Edge，无需额外安装浏览器

---

## 常见问题

**Q：为什么包这么大？**
Node 运行时约 90MB，Playwright 依赖约 20MB，Flutter 引擎约 20MB。合计 150–200MB 是正常的。想减小体积可以改用单文件打包工具（如 `pkg`）压缩 Node 部分，但会增加构建复杂度。

**Q：接收方需要装 Chrome 吗？**
macOS 需要（系统只有 Safari）。Windows 不需要，自带 Edge。

**Q：能不能只发一个 exe？**
可以，但需要用 NSIS 或 Inno Setup 做安装器，把整个目录打进去。当前是先给 zip，解压即用。

**Q：Intel Mac 能用吗？**
当前构建是 arm64，Intel Mac 不能直接用。需要额外构建 x64 版本，或在 CI 里同时产出两个架构。

**Q：以后改了引擎代码怎么更新？**
重新跑一遍打包脚本即可。`bundled_engine` 每次都会从 `src/` 和 `node_modules/` 重新复制。
