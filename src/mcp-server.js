#!/usr/bin/env node
/**
 * FlowTest MCP（Model Context Protocol）服务端。
 *
 * 让 Claude Desktop / Cursor / 其他支持 MCP 的 AI 直接调用本平台的解析、
 * 校验、执行与报告能力，无需自己写 Playwright。
 *
 * 传输：stdio（每行一条 JSON-RPC 2.0 消息），日志一律走 stderr，不污染协议流。
 * 依赖：仅 Node 内置模块 + playwright（与主服务保持一致，不引入 MCP SDK）。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { join, resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { chromium } from "playwright"
import { validateFlow } from "./flow.js"
import { parseSteps } from "./parser.js"
import { runFlow } from "./executor.js"
import { writeReport } from "./reporter.js"
import { resolveDataDir, ensureDataDirs, migrateLegacyData } from "./datadir.js"
import { runtimeLlmConfig } from "./config.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VERSION = "0.2.0"
const PROTOCOL_VERSION = "2025-06-18"

/** 用户数据目录：与桌面客户端、Web 服务共用，可用 FLOWTEST_DATA_DIR 覆盖。 */
export function dataDir() {
  return resolveDataDir()
}

const flowsDir = () => join(dataDir(), "flows")
const reportsDir = () => join(dataDir(), "reports")

/** 建目录并把旧版（程序目录内）的 flows/reports 迁移过来，与主服务共用同一套逻辑。 */
function ensureDirs() {
  ensureDataDirs(dataDir())
  migrateLegacyData(dataDir(), [
    { flowsDir: join(root, "flows"), reportsDir: join(root, "reports") }
  ])
}

/** LLM 配置：数据目录 config.json 为主，环境变量兜底（与 Web 服务同一口径）。 */
function llmConfig() {
  const runtime = runtimeLlmConfig(dataDir())
  return {
    apiKey: runtime.apiKey || process.env.FLOWTEST_LLM_API_KEY,
    endpoint: runtime.endpoint || process.env.FLOWTEST_LLM_ENDPOINT,
    model: runtime.model || process.env.FLOWTEST_LLM_MODEL
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`文件不是合法 JSON: ${path} (${error.message})`)
  }
}

function summarizeReport(report, jsonPath, htmlPath) {
  const id = basename(jsonPath).replace(/\.json$/, "")
  return {
    id,
    name: report.name,
    passed: report.passed,
    passedCount: report.passedCount,
    failedCount: report.failedCount,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    htmlPath,
    steps: report.steps.map((step, index) => ({
      index: index + 1,
      name: step.name,
      action: step.action,
      passed: step.passed,
      detail: step.detail,
      durationMs: step.durationMs
    }))
  }
}

const TOOLS = [
  {
    name: "flowtest_parse_steps",
    description: "把自然语言操作步骤解析为结构化 flow.json steps。配置了 LLM 时用 AI 解析，否则用内置规则解析。",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "自然语言步骤，一行一步，例如：打开 /login\\n在用户名输入框输入 ${username}\\n点击登录按钮"
        },
        preferRules: {
          type: "boolean",
          description: "true 时强制使用规则解析，不调用 LLM。默认 false。"
        }
      },
      required: ["text"]
    }
  },
  {
    name: "flowtest_validate_flow",
    description: "校验 flow 结构是否合法，返回问题列表（空数组表示可用）。",
    inputSchema: {
      type: "object",
      properties: {
        flow: { type: "object", description: "完整 flow 对象" }
      },
      required: ["flow"]
    }
  },
  {
    name: "flowtest_run_flow",
    description: "在真实浏览器中执行流程并返回每步结果。支持直接传 flow 对象或读取已保存的 flow 文件。截图与 HTML 报告落盘到数据目录。",
    inputSchema: {
      type: "object",
      properties: {
        flow: { type: "object", description: "完整 flow 对象，与 flowFile 二选一" },
        flowFile: { type: "string", description: "已保存流程的文件名（flows 目录下）或绝对路径" },
        baseUrl: { type: "string", description: "覆盖流程里的 config.baseUrl" },
        variables: { type: "object", description: "运行时变量，优先级高于流程内 config.variables" },
        channel: {
          type: "string",
          description: "浏览器通道：chrome / msedge。默认取环境变量 FLOWTEST_BROWSER_CHANNEL，未设置时用 chrome。"
        },
        headless: { type: "boolean", description: "是否无头运行，默认 true。" },
        stopOnFailure: { type: "boolean", description: "首个失败即中止，默认 false。" },
        captureScreenshot: { type: "boolean", description: "是否每步截图，默认 true。" }
      }
    }
  },
  {
    name: "flowtest_save_flow",
    description: "把 flow 保存到数据目录的 flows/，便于复用与回归。",
    inputSchema: {
      type: "object",
      properties: {
        flow: { type: "object", description: "完整 flow 对象" },
        file: { type: "string", description: "保存文件名，不传则用 名称-时间戳.json" }
      },
      required: ["flow"]
    }
  },
  {
    name: "flowtest_list_flows",
    description: "列出已保存的流程（名称、步骤数、文件名）。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "flowtest_list_reports",
    description: "列出最近的执行报告（通过率、失败数、时间）。",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "返回条数上限，默认 20，最多 100。" }
      }
    }
  },
  {
    name: "flowtest_get_report",
    description: "读取某次执行报告的完整步骤详情。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "报告 id，来自 flowtest_list_reports 或 flowtest_run_flow" }
      },
      required: ["id"]
    }
  }
]

function resolveFlowInput(args) {
  if (args.flow && typeof args.flow === "object") return args.flow
  if (args.flowFile) {
    const candidates = [
      args.flowFile,
      join(flowsDir(), args.flowFile),
      join(root, "flows", args.flowFile),
      join(root, "examples", args.flowFile)
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return readJsonFile(candidate)
    }
    throw new Error(`找不到流程文件: ${args.flowFile}`)
  }
  throw new Error("必须提供 flow 或 flowFile")
}

function pickChannel(args) {
  return args.channel || process.env.FLOWTEST_BROWSER_CHANNEL || "chrome"
}

async function callTool(name, args) {
  ensureDirs()

  switch (name) {
    case "flowtest_parse_steps": {
      if (typeof args.text !== "string" || !args.text.trim()) throw new Error("text 不能为空")
      const result = await parseSteps(args.text, llmConfig(), { preferRules: !!args.preferRules })
      return { steps: result.steps, engine: result.engine, warning: result.warning }
    }

    case "flowtest_validate_flow": {
      const flow = args.flow
      if (!flow || typeof flow !== "object") throw new Error("flow 不能为空")
      const problems = validateFlow(flow)
      return { valid: problems.length === 0, problems }
    }

    case "flowtest_run_flow": {
      const baseFlow = resolveFlowInput(args)
      const flow = args.baseUrl
        ? { ...baseFlow, config: { ...(baseFlow.config || {}), baseUrl: args.baseUrl } }
        : baseFlow

      const problems = validateFlow(flow)
      if (problems.length) throw new Error(`流程不合法: ${problems.join("; ")}`)

      const report = await runFlow(flow, {
        chromium,
        variables: args.variables || {},
        reportDir: reportsDir(),
        captureScreenshot: args.captureScreenshot !== false,
        stopOnFailure: !!args.stopOnFailure,
        headless: args.headless !== false,
        channel: pickChannel(args)
      })
      const { jsonPath, htmlPath } = writeReport(report, flow, reportsDir())
      return summarizeReport(report, jsonPath, htmlPath)
    }

    case "flowtest_save_flow": {
      const flow = args.flow
      if (!flow || typeof flow !== "object") throw new Error("flow 不能为空")
      const problems = validateFlow(flow)
      if (problems.length) throw new Error(`流程不合法: ${problems.join("; ")}`)
      const safe = (args.file || `${(flow.name || "flow").replace(/[\\/:*?"<>|]/g, "_")}-${Date.now()}.json`)
        .replace(/\.json$/, "") + ".json"
      const target = join(flowsDir(), safe)
      writeFileSync(target, JSON.stringify(flow, null, 2), "utf8")
      return { file: safe, path: target }
    }

    case "flowtest_list_flows": {
      const files = readdirSync(flowsDir()).filter(file => file.endsWith(".json"))
      return {
        flows: files.map(file => {
          try {
            const flow = readJsonFile(join(flowsDir(), file))
            return { file, name: flow.name, steps: flow.steps?.length || 0 }
          } catch {
            return { file, name: "(损坏)", steps: 0 }
          }
        })
      }
    }

    case "flowtest_list_reports": {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
      const files = readdirSync(reportsDir())
        .filter(file => file.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, limit)
      return {
        reports: files.map(file => {
          const report = readJsonFile(join(reportsDir(), file))
          return {
            id: basename(file).replace(/\.json$/, ""),
            name: report.name,
            passed: report.passed,
            passedCount: report.passedCount,
            failedCount: report.failedCount,
            startedAt: report.startedAt
          }
        })
      }
    }

    case "flowtest_get_report": {
      const id = String(args.id || "").replace(/\.json$/, "")
      if (!id || /[\\/]/.test(id)) throw new Error("id 不合法")
      const jsonPath = join(reportsDir(), `${id}.json`)
      if (!existsSync(jsonPath)) throw new Error(`报告不存在: ${id}`)
      const report = readJsonFile(jsonPath)
      return summarizeReport(report, jsonPath, join(reportsDir(), `${id}.html`))
    }

    default:
      throw new Error(`未知工具: ${name}`)
  }
}

/** 处理单条 JSON-RPC 消息，返回响应对象（通知类消息返回 null）。外部可直接调用，便于测试。 */
export async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }
  }
  const { id, method, params } = message
  const isNotification = id === undefined || id === null

  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: "flowtest", version: VERSION },
            instructions:
              "FlowTest 是通用 Web 自动化测试平台。先用 flowtest_parse_steps 把自然语言步骤转成结构化步骤，再 flowtest_validate_flow 校验，最后 flowtest_run_flow 在真实浏览器中执行。"
          }
        }

      case "notifications/initialized":
      case "notifications/cancelled":
        return null

      case "ping":
        return { jsonrpc: "2.0", id, result: {} }

      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS } }

      case "tools/call": {
        const toolName = params?.name
        if (!toolName) throw new Error("缺少工具名")
        const payload = await callTool(toolName, params?.arguments || {})
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            isError: false
          }
        }
      }

      case "resources/list":
        return { jsonrpc: "2.0", id, result: { resources: [] } }

      case "resources/read": {
        const uri = String(params?.uri || "")
        const match = uri.match(/flowtest:\/\/reports\/(.+?)(\.html)?$/)
        if (!match) throw new Error(`未知资源: ${uri}`)
        const id = match[1].replace(/\.json$/, "")
        if (/[\\/.]/.test(id)) throw new Error("id 不合法")
        const htmlPath = join(reportsDir(), `${id}.html`)
        if (!existsSync(htmlPath)) throw new Error(`报告不存在: ${id}`)
        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [{ uri, mimeType: "text/html", text: readFileSync(htmlPath, "utf8") }]
          }
        }
      }

      case "prompts/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            prompts: [
              {
                name: "write_flowtest_flow",
                description: "根据被测系统的操作说明，写一份可直接执行的 FlowTest 流程",
                arguments: [
                  { name: "system", description: "被测系统名称与地址", required: true },
                  { name: "goal", description: "要验证的业务目标", required: true }
                ]
              }
            ]
          }
        }

      case "prompts/get": {
        const name = params?.name
        if (name !== "write_flowtest_flow") throw new Error(`未知 prompt: ${name}`)
        const system = params?.arguments?.system || "被测系统"
        const goal = params?.arguments?.goal || "核心业务可用"
        return {
          jsonrpc: "2.0",
          id,
          result: {
            description: "生成 FlowTest 流程",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: [
                    `为「${system}」编写一份 FlowTest 流程，目标是验证：${goal}。`,
                    "",
                    "要求：",
                    "1. 先用一句话说明前置条件（账号、数据、入口地址）。",
                    "2. 用自然语言写操作步骤，一行一步，然后调用 flowtest_parse_steps 转成结构化步骤。",
                    "3. 调用 flowtest_validate_flow 校验，修正所有问题。",
                    "4. 调用 flowtest_run_flow 在真实浏览器执行，把失败步骤的 detail 原样反馈。",
                    "5. 定位优先用 placeholder / label / role，最后才用 css。"
                  ].join("\n")
                }
              }
            ]
          }
        }
      }

      default:
        if (isNotification) return null
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` }
        }
    }
  } catch (error) {
    if (isNotification) return null
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: error.message }
    }
  }
}

/** stdio 传输：一行一条消息。 */
function startStdioServer() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let pending = 0
  let inputClosed = false

  const exitIfDrained = () => {
    if (inputClosed && pending === 0) process.exit(0)
  }

  rl.on("line", async line => {
    const trimmed = line.trim()
    if (!trimmed) return
    let message
    try {
      message = JSON.parse(trimmed)
    } catch {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" }
      }) + "\n")
      return
    }
    // 跟踪未完成请求：stdin 提前关闭时（管道调用）不能吞掉还在跑的工具调用
    pending++
    try {
      const response = await handleMessage(message)
      if (response) process.stdout.write(JSON.stringify(response) + "\n")
    } finally {
      pending--
      exitIfDrained()
    }
  })
  rl.on("close", () => {
    inputClosed = true
    exitIfDrained()
  })
  process.stderr.write(`[flowtest-mcp] 已启动，数据目录: ${dataDir()}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  ensureDirs()
  startStdioServer()
}
