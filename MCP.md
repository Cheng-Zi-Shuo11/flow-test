# FlowTest MCP Server

把 FlowTest 的解析、校验、执行、报告能力暴露成 **MCP（Model Context Protocol）** 工具，任何支持 MCP 的 AI 客户端都能直接调用——AI 不用自己写 Playwright，就能在真实浏览器里跑流程测试。

传输方式：**stdio**（每行一条 JSON-RPC 2.0 消息）。零额外依赖，只用 Node 内置模块 + 项目已有的 playwright。

## 5 分钟接入

### Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`（Windows 是 `%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "flowtest": {
      "command": "node",
      "args": ["/Users/chengzishuo/work/fy/flow-test/src/mcp-server.js"],
      "env": {
        "FLOWTEST_BROWSER_CHANNEL": "chrome"
      }
    }
  }
}
```

完全退出 Claude Desktop 再重开（不是关窗口），在输入框旁能看到 flowtest 的工具。

### Cursor

编辑 `~/.cursor/mcp.json`，格式同上。可以在 Settings → MCP 里确认状态是绿色。

### 其他客户端（任意 stdio 型 MCP）

只要它能启动子进程并向 stdin 写 JSON-RPC：

```
command: node
args:    <项目绝对路径>/src/mcp-server.js
```

## 工具清单

| 工具 | 作用 | 关键参数 |
|---|---|---|
| `flowtest_parse_steps` | 自然语言步骤 → 结构化 steps | `text`、`preferRules` |
| `flowtest_validate_flow` | 校验流程结构，返回问题列表 | `flow` |
| `flowtest_run_flow` | 真实浏览器执行并出报告 | `flow` 或 `flowFile`、`baseUrl`、`variables`、`headless`、`channel` |
| `flowtest_save_flow` | 保存流程到数据目录 | `flow`、`file` |
| `flowtest_list_flows` | 列出已保存流程 | — |
| `flowtest_list_reports` | 列出最近报告 | `limit` |
| `flowtest_get_report` | 读取某次报告的全部步骤详情 | `id` |

另外提供一个 prompt 模板 `write_flowtest_flow`（给系统名和目标，让 AI 按「解析 → 校验 → 执行 → 反馈失败详情」的顺序干活），以及报告资源 `flowtest://reports/<id>`（MCP 客户端可直接读 HTML）。

## 典型对话

> **你**：帮我验证一下 http://localhost:8899 的登录功能，账号 admin / 123456。
>
> **AI**：调用 `flowtest_parse_steps` 把步骤转成结构 → `flowtest_validate_flow` 校验 → `flowtest_run_flow` 执行 → 回报「5/5 通过，点击登录耗时 120ms」。

失败时 AI 拿到的是可操作的定位诊断（比如「找到 2 个包含『站点实况』的元素，但都不可见，建议先点开菜单」），而不是一句 timeout，它能据此自动改流程重跑。

## 数据与配置

- 数据目录：`~/Library/Application Support/FlowTest`（macOS）、`%APPDATA%\FlowTest`（Windows）、`~/.local/share/FlowTest`（Linux），可用 `FLOWTEST_DATA_DIR` 覆盖。
- 流程在 `flows/`，报告（JSON + HTML + 截图）在 `reports/`，与 Web 界面、桌面客户端共用同一份数据。
- AI 解析用的模型配置读同一目录下的 `config.json` 的 `llm` 字段，读不到则回退到 `FLOWTEST_LLM_API_KEY / _ENDPOINT / _MODEL` 环境变量。

## 排错

| 现象 | 原因与处理 |
|---|---|
| 客户端里看不到工具 | 改了配置后要完全退出客户端重启；`node` 用绝对路径（GUI 客户端拿不到你 shell 的 PATH） |
| 执行报「Executable doesn't exist」 | 没装 Chromium。装 `npx playwright install chromium`，或设 `FLOWTEST_BROWSER_CHANNEL=chrome`（Windows 可设 `msedge`） |
| 想看服务端日志 | MCP 日志全在 stderr，启动时打印数据目录；客户端一般在 MCP 日志面板里能看到 |
| 报告目录空 | 检查 `config.json` 与 `FLOWTEST_DATA_DIR` 是否指向了同一个位置 |

## 自测

```bash
npm run mcp                                  # 前台启动，手工粘 JSON 调试
node --test tests/mcp.test.js                # 协议层单测（8 个用例）
```
