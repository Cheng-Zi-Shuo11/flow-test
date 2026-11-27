# FlowTest - 通用 Web 自动化流程测试平台

写一遍操作流程，自动在真实浏览器里执行并出报告。与被测项目完全解耦——任何 Web 系统只要能打开页面，就能测。

## 核心能力

- **自然语言编写**：像写操作手册一样写步骤，AI 解析；没配 AI 时用内置规则解析，开箱即用。
- **通用不绑定项目**：所有项目差异（地址、账号、输入值）通过变量注入，一份流程可跑多个环境。
- **真实浏览器执行**：基于 Playwright，点击、输入、断言都在真实 Chromium 中进行。
- **失败定位到步骤**：每步记录状态、详情、耗时和截图，失败一眼看到哪一步。
- **三种使用形态**：Web 界面、CLI、Flutter 桌面客户端（Windows / macOS），共用同一套执行引擎。
- **LLM 可配置**：填自己的 API Key 即用 AI 解析任意表述；不填则降级为规则，功能不受影响。

## 四种形态

| 形态 | 入口 | 适用场景 |
|---|---|---|
| Web | `npm start` → http://localhost:3777 | 本机快速编写与查看 |
| CLI | `node src/cli.js run/batch/parse` | CI 自动执行 |
| 桌面客户端 | `flutter_client/` | 分发给非技术同事，双击即用，内置引擎无需装环境 |
| MCP Server | `npm run mcp` → stdio | 让 Claude Desktop / Cursor 等 AI 直接调用平台能力 |

桌面客户端的打包与分发见 [DISTRIBUTION.md](./DISTRIBUTION.md)，MCP 接入见 [MCP.md](./MCP.md)。

## 快速开始

```bash
cd /Users/chengzishuo/work/fy/flow-test
npm install
# 二选一：下载 Playwright 自带 Chromium，或直接用本机已装的 Chrome
npx playwright install chromium
# 本机已有 Chrome 时可不下载，运行时加 --channel chrome（Web 界面默认已选系统 Chrome）

# 启动 Web 界面
npm start
# 打开 http://localhost:3777
```

启用 AI 解析（可选）：

```bash
export FLOWTEST_LLM_API_KEY="你的密钥"
export FLOWTEST_LLM_ENDPOINT="https://api.openai.com/v1/chat/completions"
export FLOWTEST_LLM_MODEL="gpt-4o-mini"
npm start
```

## 使用方式

### 方式一：Web 界面

1. 打开 http://localhost:3777
2. 填写流程名称、被测地址（baseUrl）
3. 在"操作步骤"里写自然语言，例如：

```
打开 /login
在用户名输入框输入 ${username}
在密码输入框输入 ${password}
点击登录按钮
验证页面出现 欢迎
```

4. 点"解析为结构化步骤"查看生成的 JSON，可手动微调
5. 点"运行测试"，查看每步结果和历史报告

### 方式二：CLI

自然语言先转流程文件：

```bash
node src/cli.js parse steps.txt --out my.flow.json
```

执行流程：

```bash
node src/cli.js run my.flow.json \
  --base-url http://localhost:8888 \
  --var username=admin \
  --var password=123456
```

批量执行多个流程（适合一次回归多个项目）：

```bash
node src/cli.js batch examples/demo.flow.json examples/assertions.flow.json \
  --channel chrome --no-screenshot
# 加 --stop-on-failure 可在第一个失败流程处中止
```

CI 中退出码：`0` 全部通过，`1` 有步骤失败，`2` 参数或流程错误。

## 示例流程

`examples/` 下提供开箱即用的样例，详见 `examples/README.md`：

| 文件 | 演示内容 |
|---|---|
| `demo.flow.json` | 基础登录流程 |
| `assertions.flow.json` | 9 种断言类型（14 步） |
| `variables.flow.json` | 变量注入与多环境切换 |
| `natural-language.txt` | 自然语言步骤样例 |

配合示例站点运行：

```bash
cd examples/test-app && python3 -m http.server 8899
cd ../.. && node src/cli.js run examples/assertions.flow.json --channel chrome --no-screenshot
```

## 流程文件格式

```json
{
  "name": "登录流程",
  "config": {
    "baseUrl": "http://localhost:8888",
    "variables": { "username": "admin", "password": "123456" },
    "timeout": 30000,
    "viewport": { "width": 1280, "height": 720 }
  },
  "steps": [
    { "name": "打开登录页", "action": "navigate", "target": { "by": "url", "value": "/login" } },
    { "name": "输入用户名", "action": "fill", "target": { "by": "placeholder", "value": "用户名" }, "value": "${username}" },
    { "name": "点击登录", "action": "click", "target": { "by": "role", "value": "button:登录" } },
    { "name": "验证成功", "action": "assert", "target": { "by": "text", "value": "登录成功" }, "assert": { "type": "visible" } }
  ]
}
```

### 支持的动作

| action | 说明 | 需要的字段 |
|---|---|---|
| `navigate` | 打开地址 | `target.value`（相对路径基于 baseUrl） |
| `click` | 点击元素 | `target` |
| `fill` | 输入文本 | `target`, `value` |
| `select` | 下拉选择 | `target`, `value` |
| `hover` | 悬停 | `target` |
| `press` | 按键 | `target`, `value`（默认 Enter） |
| `wait` | 等待 | `value`（毫秒） |
| `screenshot` | 截图 | `value`（可选路径） |
| `assert` | 断言 | `target`, `assert` |

### 支持的定位方式

| by | 说明 | 示例 |
|---|---|---|
| `role` | 语义角色，最抗改版 | `button:登录` |
| `label` | 表单标签 | `用户名` |
| `placeholder` | 输入提示 | `用户名` |
| `text` | 可见文本（包含匹配） | `登录成功` |
| `textExact` | 可见文本（完全相等） | `站点实况` |
| `testId` | 测试标识 | `submit-btn` |
| `css` | CSS 选择器（兜底） | `#loginBtn` |

### 定位降级与失败诊断

老系统经常没有语义化标签：顶部菜单可能是 `<li>`、`<div>`，不是 `<button>`。平台不会因为一次定位失败就判死，而是按**候选链**依次尝试：

| 原定位 | 降级顺序 |
|---|---|
| `role: button:X` | `button` → `menuitem` → `link` → `tab` → `treeitem` → `option` → `listitem` → 精确文本 → 文本包含 |
| `text: X` | 精确文本 → 文本包含 → `[title]`/`[aria-label]` |
| `placeholder: X` | `placeholder` → `label` → `name` 属性 → `placeholder*=` CSS |

同时会在页面的各个 iframe 中查找（气象系统常用 iframe 嵌子页面）。命中降级定位时，步骤详情会写明 `（降级定位: textExact=站点实况）`，便于你之后把流程改成更稳的写法。

点击后如果系统打开了新标签页，后续步骤会自动切换到新页面。

真的找不到时，报错不是一句 timeout，而是给出可操作的现场信息：

```
无法定位「站点实况」（点击失败）
当前页面: M5 综合业务平台 http://xxx/home
找到 2 个包含「站点实况」的元素，但都不可见
  - <li> 站点实况
建议: 菜单可能是折叠状态，先补一步点击展开菜单，或加「等待」
```

### 支持的断言类型

`visible`、`hidden`、`text`、`textContains`、`url`、`urlContains`、`count`、`value`、`title`、`enabled`、`disabled`

需要期望值的断言（`text`/`textContains`/`url`/`urlContains`/`count`/`value`/`title`）漏填 `value` 时，会直接提示「缺少 value」，不会拼出 `包含 undefined`。

## 变量机制

任何字符串字段都支持 `${变量名}` 占位符。变量来源有两处：

1. 流程内 `config.variables`
2. 运行时通过 CLI `--var` 或 Web 界面的"变量"框注入（运行时优先）

这让同一份流程可切换不同地址、账号、测试数据，无需改步骤。

## 目录结构

```
flow-test/
├── src/
│   ├── flow.js       流程结构、校验、变量注入
│   ├── parser.js     自然语言解析（LLM + 规则降级）
│   ├── executor.js   Playwright 执行与断言
│   ├── reporter.js   JSON/HTML 报告
│   ├── server.js     Web 服务
│   └── cli.js        CLI 入口
├── web/              前端界面
├── src/batch.js      批量流程执行
├── examples/         示例流程与测试站点
├── flows/            保存的流程（运行时生成）
├── reports/          执行报告（运行时生成）
└── tests/            单元测试 + 断言边界 + 流程边界 + 批量执行
```

## 测试

```bash
npm test
```

当前 61 个测试覆盖：

| 测试文件 | 覆盖内容 |
|---|---|
| `core.test.js` | 流程校验、变量注入、核心动作解析、LLM 降级 |
| `assertions.test.js` | 可见性断言边界（隐藏元素不误判） |
| `boundary.test.js` | 流程/变量/解析器/定位器的边界输入 |
| `batch.test.js` | 批量聚合、失败继续/中断、异常隔离 |
| `fallback.test.js` | 定位降级链、iframe 查找、新窗口接管、失败诊断信息 |

## 设计取舍

- **不写死任何业务元素**：流程只描述"点哪个文字/占位符"，不依赖 DOM 结构，界面改版后大概率仍可用。
- **LLM 是增强不是依赖**：没 Key 也能跑，避免 AI 服务不可用导致测试全停。
- **Web 服务零框架**：只用 Node 原生模块，部署简单，不会因依赖升级破坏。
- **报告落盘**：JSON 供 CI 解析，HTML 供人工查看，截图按步骤序号命名。
