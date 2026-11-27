#!/usr/bin/env node
/**
 * FlowTest CLI：在终端或 CI 中执行流程。
 *
 * 用法：
 *   flowtest run <流程文件> [--base-url URL] [--var key=value] [--channel chrome] [--no-screenshot] [--headed]
 *   flowtest batch <流程文件1> <流程文件2> ... [--stop-on-failure] [--channel chrome]
 *   flowtest parse <自然语言文件> [--out 流程文件]
 *
 * 退出码：0 全部通过，1 有步骤失败，2 参数或流程错误。
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { chromium } from "playwright"
import { validateFlow, createEmptyFlow } from "./flow.js"
import { parseSteps } from "./parser.js"
import { runFlow } from "./executor.js"
import { writeReport } from "./reporter.js"
import { runBatch } from "./batch.js"

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  const targets = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      if (["no-screenshot", "headed", "stop-on-failure", "rules"].includes(key)) {
        options[key] = true
      } else {
        options[key] = rest[++i]
      }
    } else {
      targets.push(arg)
    }
  }
  return { command, target: targets[0], targets, options }
}

function loadFlow(target) {
  const absolute = resolve(target)
  const text = readFileSync(absolute, "utf8")
  if (target.endsWith(".json")) return JSON.parse(text)
  throw new Error("流程文件需为 .json 格式；自然语言请用 parse 命令先转换")
}

function applyOptions(flow, options) {
  if (options["base-url"]) flow.config.baseUrl = options["base-url"]
  for (const item of options.var ? [options.var] : []) {
    const [key, ...rest] = item.split("=")
    flow.config.variables[key] = rest.join("=")
  }
  return flow
}

async function cmdParse(target, options) {
  const text = readFileSync(resolve(target), "utf8")
  const llmConfig = {
    apiKey: process.env.FLOWTEST_LLM_API_KEY,
    endpoint: process.env.FLOWTEST_LLM_ENDPOINT,
    model: process.env.FLOWTEST_LLM_MODEL
  }
  const result = await parseSteps(text, llmConfig, { preferRules: !!options.rules })
  const flow = createEmptyFlow("自然语言生成流程")
  flow.steps = result.steps
  const output = options.out || "generated.flow.json"
  writeFileSync(resolve(output), JSON.stringify(flow, null, 2), "utf8")
  console.log(`已生成 ${output}（解析引擎: ${result.engine}）`)
  if (result.warning) console.warn(result.warning)
}

async function cmdRun(target, options) {
  const flow = applyOptions(loadFlow(target), options)
  const problems = validateFlow(flow)
  if (problems.length) {
    console.error("流程校验失败:")
    problems.forEach(p => console.error(`  - ${p}`))
    process.exitCode = 2
    return
  }

  const reportDir = resolve(options["report-dir"] || "reports")
  const report = await runFlow(flow, {
    chromium,
    variables: {},
    reportDir,
    captureScreenshot: !options["no-screenshot"],
    headless: !options.headed,
    stopOnFailure: !!options["stop-on-failure"],
    channel: options.channel
  })

  const { htmlPath } = writeReport(report, flow, reportDir)
  console.log(`\n结果: ${report.passed ? "通过" : "失败"} (${report.passedCount}/${report.steps.length})`)
  report.steps.forEach((step, i) => {
    console.log(`  ${step.passed ? "✓" : "✗"} ${i + 1}. ${step.name} — ${step.detail}`)
  })
  console.log(`\n报告: ${htmlPath}`)

  process.exitCode = report.passed ? 0 : 1
}

async function cmdBatch(targets, options) {
  if (!targets.length) {
    console.error("请提供至少一个流程文件")
    process.exitCode = 2
    return
  }
  const flows = targets.map(target => applyOptions(loadFlow(target), options))
  const result = await runBatch(flows, {
    channel: options.channel,
    reportDir: resolve(options["report-dir"] || "reports"),
    continueOnFailure: !options["stop-on-failure"],
    captureScreenshot: !options["no-screenshot"],
    headless: !options.headed
  })

  console.log(`\n批量结果: ${result.passed ? "全部通过" : "存在失败"} (${result.successCount}/${result.total})`)
  result.results.forEach((item, i) => {
    console.log(`  ${item.passed ? "✓" : "✗"} ${i + 1}. ${item.name} — ${item.error || `${item.passedCount}/${item.passedCount + item.failedCount}`}`)
  })
  console.log(`\n耗时: ${result.duration}ms`)

  process.exitCode = result.passed ? 0 : 1
}

async function main() {
  const { command, target, targets, options } = parseArgs(process.argv.slice(2))
  try {
    if (command === "parse") await cmdParse(target, options)
    else if (command === "run") await cmdRun(target, options)
    else if (command === "batch") await cmdBatch(targets, options)
    else {
      console.log(`FlowTest - 通用 Web 自动化流程测试

用法:
  flowtest run <流程.json> [--base-url URL] [--var key=value] [--channel chrome] [--headed] [--no-screenshot]
  flowtest batch <流程1.json> <流程2.json> ... [--stop-on-failure] [--channel chrome]
  flowtest parse <自然语言.txt> [--out 流程.json] [--rules]

环境变量:
  FLOWTEST_LLM_API_KEY     LLM 密钥（留空则使用规则解析）
  FLOWTEST_LLM_ENDPOINT    OpenAI 兼容接口地址
  FLOWTEST_LLM_MODEL       模型名`)
    }
  } catch (error) {
    console.error(`错误: ${error.message}`)
    process.exitCode = 2
  }
}

main()
