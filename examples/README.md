# FlowTest 示例集

本目录存放可直接运行的流程样例和一个自带的静态测试站点。所有命令默认在**项目根目录**执行：

```bash
cd /Users/chengzishuo/work/fy/flow-test
```

## 先启动测试站点

`test-app/` 是零依赖的静态页面，用 Python 自带 HTTP 服务即可打开：

```bash
cd examples/test-app
python3 -m http.server 8899
```

浏览器访问 <http://localhost:8899/advanced.html> 能看到示例页面。保持该终端运行，再在项目根目录执行下面的 CLI 命令。

> 若本机已安装 Chrome，命令中加 `--channel chrome` 可直接使用系统浏览器，无需 `npx playwright install chromium`。

## 文件一览

| 文件 | 用途 |
|---|---|
| `demo.flow.json` | 基础登录流程，演示最简的 navigate → fill → click → assert |
| `assertions.flow.json` | 断言类型大全，覆盖 9 种断言 |
| `variables.flow.json` | 变量注入与多环境切换 |
| `natural-language.txt` | 自然语言步骤样例，供 `parse` 命令演示 |
| `test-app/index.html` | 基础登录页（配合 `demo.flow.json`） |
| `test-app/advanced.html` | 增强测试页，供断言与变量示例使用 |

## 1. 基础流程：demo.flow.json

演示变量化账号密码 + 登录成功校验，指向 `test-app/index.html`。

```bash
node src/cli.js run examples/demo.flow.json --channel chrome --base-url http://localhost:8899
```

## 2. 断言大全：assertions.flow.json

步骤全部指向 `advanced.html`，依次演示：

- `title`：页面标题完全匹配
- `urlContains`：URL 包含关键字
- `visible`：元素真实可见
- `hidden`：`display:none` 元素被判为隐藏
- `text`：可见文本完全匹配（`#status` 的“准备就绪”）
- `count`：匹配元素个数（3 个 `.action-btn`）
- `enabled`：按钮可用
- `value`：输入框当前值
- `textContains`：可见且包含关键字（登录后的“登录成功”）

注意：`text` 与 `textContains` 要求元素**真实可见**，命中 `display:none` 的隐藏文本会判失败；`hidden` 断言则相反。

```bash
node src/cli.js run examples/assertions.flow.json \
  --channel chrome --base-url http://localhost:8899
```

## 3. 变量注入：variables.flow.json

地址、账号、密码、角色、期望文案都写成 `${变量名}`。默认值在 `config.variables` 中，运行时用 `--var` 覆盖即可切换环境，步骤无需修改。

```bash
# 默认环境（本机 8899）
node src/cli.js run examples/variables.flow.json --channel chrome

# 切换到另一套环境：只改变量，不改流程
node src/cli.js run examples/variables.flow.json --channel chrome \
  --var baseUrl=http://localhost:8899 \
  --var username=admin \
  --var password=123456 \
  --var role=admin \
  --var expectedWelcome=登录成功
```

`config.baseUrl` 本身也支持 `${baseUrl}`，因此同一份流程可整体指向不同站点。变量来源优先级：`--var` 运行时注入 > `config.variables` 默认值。

## 4. 自然语言转流程：natural-language.txt

文件含 10 步贴近真实业务的描述：打开页面 → 输入账号密码 → 点击登录 → 等待 → 验证 → 输入搜索词 → 点击搜索 → 验证结果 → 截图。

先解析成结构化 JSON，再执行：

```bash
# 用规则解析（无需 LLM Key），加 --rules 强制走内置规则
node src/cli.js parse examples/natural-language.txt \
  --out flows/from-natural.flow.json --rules

# 执行生成的流程（生成文件的 baseUrl 为空，需用 --base-url 指定）
node src/cli.js run flows/from-natural.flow.json \
  --channel chrome --base-url http://localhost:8899
```

规则解析器会按关键词映射动作：

| 自然语言写法 | 得到的 action |
|---|---|
| 打开 /访问 /进入 /跳转到 xxx | `navigate` |
| 在「xxx」输入框输入 yyy | `fill` |
| 点击 /单击 /按下 xxx | `click`（优先 `button` 角色） |
| 悬停在 xxx | `hover` |
| 等待 1 秒 / 500 ms | `wait` |
| 验证 /确认 /出现 xxx | `assert`（默认 `visible`） |
| 截图 | `screenshot` |

自然语言中的输入值也可以直接写变量，例如 `在用户名输入框输入 ${username}`，解析后在执行时由 `--var username=xxx` 注入，实现“一份描述跑多个环境”。配置 `FLOWTEST_LLM_API_KEY` 后会优先用大模型解析任意表述，失败自动降级到上述规则。

## 运行提示

- 断言失败会定位到具体步骤并输出实际值/期望值，HTML 报告在 `reports/` 下。
- CLI 退出码：`0` 全部通过，`1` 有步骤失败，`2` 参数或流程错误。
- 截图步骤默认不指定路径时由执行引擎按步骤序号自动落盘到报告目录。
