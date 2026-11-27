/**
 * 批量执行：按顺序运行多个流程，聚合为一份批次报告。
 *
 * 单个流程失败（步骤失败、抛异常或校验不通过）只影响该流程本身；
 * 默认 continueOnFailure=true，批次会继续执行后续流程。
 */

import { chromium } from "playwright"
import { runFlow as defaultRunFlow } from "./executor.js"
import { validateFlow } from "./flow.js"

/**
 * 批量运行流程。
 *
 * @param {object[]} flows 流程定义数组
 * @param {object} options 选项
 * @param {string} [options.channel="chrome"] 浏览器通道，直接复用系统已装浏览器
 * @param {string} [options.reportDir] 报告目录（透传给 runFlow）
 * @param {boolean} [options.continueOnFailure=true] 单个流程失败后是否继续
 * @param {boolean} [options.headless=true] 是否无头运行
 * @param {object} [options.variables={}] 额外注入变量
 * @param {boolean} [options.captureScreenshot=true] 是否逐步截图
 * @param {boolean} [options.stopOnFailure=false] 单个流程内是否遇错即停
 * @param {boolean} [options.validate=true] 执行前是否校验流程定义
 * @param {Function} [options.runFlowImpl=runFlow] 依赖注入点：单流程执行器，签名为 (flow, runOptions) => report
 * @returns {Promise<{passed: boolean, total: number, successCount: number, failureCount: number, results: object[], duration: number}>}
 */
export async function runBatch(flows, options = {}) {
  const {
    channel = "chrome",
    reportDir,
    continueOnFailure = true,
    headless = true,
    variables = {},
    captureScreenshot = true,
    stopOnFailure = false,
    validate = true,
    runFlowImpl = defaultRunFlow
  } = options

  const startedAt = Date.now()
  const results = []
  const list = Array.isArray(flows) ? flows : []

  for (const flow of list) {
    const name = flow?.name || "未命名流程"

    // 校验不通过直接标记失败，不进入浏览器执行
    const problems = validate ? validateFlow(flow) : []
    if (problems.length) {
      results.push({
        name,
        passed: false,
        passedCount: 0,
        failedCount: 0,
        report: null,
        error: `流程校验失败: ${problems.join("; ")}`
      })
      if (!continueOnFailure) break
      continue
    }

    try {
      const report = await runFlowImpl(flow, {
        chromium,
        variables,
        reportDir,
        captureScreenshot,
        headless,
        stopOnFailure,
        channel
      })
      results.push({
        name: report?.name || name,
        passed: !!report?.passed,
        passedCount: report?.passedCount || 0,
        failedCount: report?.failedCount || 0,
        report
      })
      if (!report?.passed && !continueOnFailure) break
    } catch (error) {
      results.push({
        name,
        passed: false,
        passedCount: 0,
        failedCount: 0,
        report: null,
        error: error?.message || String(error)
      })
      if (!continueOnFailure) break
    }
  }

  const successCount = results.filter(r => r.passed).length
  const failureCount = results.length - successCount

  return {
    passed: failureCount === 0,
    total: results.length,
    successCount,
    failureCount,
    results,
    duration: Date.now() - startedAt
  }
}
