/**
 * FlowTest Web 服务：流程编排、运行、报告查看。
 * 仅用 Node 原生模块，避免额外依赖。
 */

import http from "node:http"
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { join, resolve, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { validateFlow, createEmptyFlow } from "./flow.js"
import { parseSteps } from "./parser.js"
import { runFlow } from "./executor.js"
import { writeReport } from "./reporter.js"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const webDir = join(root, "web")
const flowsDir = join(root, "flows")
const reportsDir = join(root, "reports")
const port = Number(process.env.PORT || 3777)

mkdirSync(flowsDir, { recursive: true })
mkdirSync(reportsDir, { recursive: true })

const llmConfig = () => ({
  apiKey: process.env.FLOWTEST_LLM_API_KEY,
  endpoint: process.env.FLOWTEST_LLM_ENDPOINT,
  model: process.env.FLOWTEST_LLM_MODEL
})

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = ""
    req.on("data", chunk => (body += chunk))
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error("请求体不是合法 JSON"))
      }
    })
  })
}

function serveStatic(res, pathname) {
  const safe = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  const filePath = join(webDir, safe)
  if (!filePath.startsWith(webDir) || !existsSync(filePath)) {
    res.writeHead(404)
    res.end("Not found")
    return
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }
  res.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" })
  res.end(readFileSync(filePath))
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)

  try {
    // 静态页面
    if (req.method === "GET" && (pathname === "/" || /\.(html|js|css)$/.test(pathname))) {
      return serveStatic(res, pathname)
    }

    // 流程列表
    if (req.method === "GET" && pathname === "/api/flows") {
      const files = readdirSync(flowsDir).filter(f => f.endsWith(".json"))
      return sendJson(res, 200, {
        flows: files.map(file => {
          const flow = JSON.parse(readFileSync(join(flowsDir, file), "utf8"))
          return { file, name: flow.name, steps: flow.steps?.length || 0 }
        })
      })
    }

    // 读取单个流程
    if (req.method === "GET" && pathname.startsWith("/api/flows/")) {
      const file = pathname.slice("/api/flows/".length)
      const filePath = join(flowsDir, file)
      if (!filePath.startsWith(flowsDir) || !existsSync(filePath)) {
        return sendJson(res, 404, { error: "流程不存在" })
      }
      return sendJson(res, 200, JSON.parse(readFileSync(filePath, "utf8")))
    }

    // 保存流程
    if (req.method === "POST" && pathname === "/api/flows") {
      const { file, flow } = await readBody(req)
      const problems = validateFlow(flow)
      if (problems.length) return sendJson(res, 400, { error: problems.join("; ") })
      const fileName = file?.endsWith(".json") ? file : `${Date.now()}.json`
      writeFileSync(join(flowsDir, fileName), JSON.stringify(flow, null, 2), "utf8")
      return sendJson(res, 200, { file: fileName })
    }

    // 自然语言解析为步骤
    if (req.method === "POST" && pathname === "/api/parse") {
      const { text, useRules } = await readBody(req)
      const result = await parseSteps(text, llmConfig(), { preferRules: !!useRules })
      return sendJson(res, 200, result)
    }

    // 执行流程
    if (req.method === "POST" && pathname === "/api/run") {
      const { flow, variables, stopOnFailure, channel } = await readBody(req)
      const problems = validateFlow(flow)
      if (problems.length) return sendJson(res, 400, { error: problems.join("; ") })
      const report = await runFlow(flow, {
        chromium,
        variables: variables || {},
        reportDir: reportsDir,
        captureScreenshot: true,
        stopOnFailure: !!stopOnFailure,
        channel
      })
      const { htmlPath } = writeReport(report, flow, reportsDir)
      return sendJson(res, 200, { report, htmlPath: htmlPath.replace(root + "/", "") })
    }

    // 报告列表
    if (req.method === "GET" && pathname === "/api/reports") {
      const files = readdirSync(reportsDir).filter(f => f.endsWith(".json")).sort().reverse()
      const reports = files.slice(0, 30).map(file => {
        const report = JSON.parse(readFileSync(join(reportsDir, file), "utf8"))
        return {
          id: file.replace(/\.json$/, ""),
          name: report.name,
          passed: report.passed,
          passedCount: report.passedCount,
          failedCount: report.failedCount,
          startedAt: report.startedAt
        }
      })
      return sendJson(res, 200, { reports })
    }

    // 报告详情（HTML 直接返回）
    if (req.method === "GET" && pathname.startsWith("/api/reports/")) {
      const id = pathname.slice("/api/reports/".length)
      const filePath = join(reportsDir, `${id}.html`)
      if (!filePath.startsWith(reportsDir) || !existsSync(filePath)) {
        return sendJson(res, 404, { error: "报告不存在" })
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      return res.end(readFileSync(filePath))
    }

    // LLM 配置状态
    if (req.method === "GET" && pathname === "/api/config") {
      return sendJson(res, 200, {
        llmConfigured: !!llmConfig().apiKey,
        model: llmConfig().model || "gpt-4o-mini",
        endpoint: llmConfig().endpoint || "https://api.openai.com/v1/chat/completions"
      })
    }

    return sendJson(res, 404, { error: "未知接口" })
  } catch (error) {
    return sendJson(res, 500, { error: error.message })
  }
})

server.listen(port, () => {
  console.log(`FlowTest 已启动: http://localhost:${port}`)
  console.log(`LLM 状态: ${llmConfig().apiKey ? "已配置" : "未配置（使用规则解析）"}`)
})
