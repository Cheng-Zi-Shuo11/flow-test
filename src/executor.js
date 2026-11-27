/**
 * 执行引擎：用 Playwright 驱动真实浏览器，逐步骤执行动作与断言。
 * 与被测项目无任何耦合——只依赖流程定义中的地址和元素描述。
 */

import { resolveFlow } from "./flow.js"

/** 把 {by, value} 定位描述转成 Playwright Locator */
export function resolveLocator(page, target) {
  if (!target) throw new Error("缺少 target")
  const value = String(target.value ?? "")

  switch (target.by) {
    case "url":
      return null // navigate 专用
    case "role": {
      const [role, ...nameParts] = value.split(":")
      const name = nameParts.join(":").trim()
      return name
        ? page.getByRole(role.trim(), { name })
        : page.getByRole(role.trim())
    }
    case "label":
      return page.getByLabel(value)
    case "placeholder":
      return page.getByPlaceholder(value)
    case "text":
      return page.getByText(value)
    case "testId":
      return page.getByTestId(value)
    case "css":
      return page.locator(value)
    default:
      throw new Error(`不支持的定位方式: ${target.by}`)
  }
}

/** 在页面打开目标地址，支持相对路径与绝对 URL */
export async function navigate(page, url, baseUrl) {
  const fullUrl = /^(https?:)?\/\//.test(url) ? url : new URL(url, baseUrl || undefined).toString()
  await page.goto(fullUrl, { waitUntil: "domcontentloaded" })
  return fullUrl
}

/** 执行单个断言，返回 { passed, detail } */
export async function runAssertion(page, assertion, target) {
  const type = assertion.type
  const expected = assertion.value
  const locator = target ? resolveLocator(page, target) : null

  try {
    switch (type) {
      case "visible": {
        await locator.first().waitFor({ state: "visible", timeout: 5000 })
        return { passed: true, detail: "元素可见" }
      }
      case "hidden": {
        const count = await locator.count()
        if (count === 0) return { passed: true, detail: "元素不存在" }
        await locator.first().waitFor({ state: "hidden", timeout: 5000 })
        return { passed: true, detail: "元素隐藏" }
      }
      case "text": {
        const node = locator.first()
        const isVisible = await node.isVisible().catch(() => false)
        const actual = (await node.textContent())?.trim() || ""
        const passed = isVisible && actual === expected
        return { passed, detail: `期望可见文本 "${expected}"，实际 "${actual}"${isVisible ? "" : "（元素不可见）"}` }
      }
      case "textContains": {
        const scope = locator || page.locator("body")
        const node = scope.first()
        // 元素必须真实可见，避免命中 display:none 的隐藏文本导致误判
        const isVisible = await node.isVisible().catch(() => false)
        if (!isVisible) {
          return { passed: false, detail: `未找到可见的 "${expected}"（可能元素隐藏或不存在）` }
        }
        const actual = (await node.textContent()) || ""
        const passed = actual.includes(expected)
        return { passed, detail: passed ? `可见且包含 "${expected}"` : `可见但不包含 "${expected}"` }
      }
      case "url": {
        const actual = page.url()
        return { passed: actual === expected, detail: `期望 "${expected}"，实际 "${actual}"` }
      }
      case "urlContains": {
        const actual = page.url()
        return { passed: actual.includes(expected), detail: `实际 URL: ${actual}` }
      }
      case "count": {
        const actual = await locator.count()
        return { passed: actual === Number(expected), detail: `期望 ${expected} 个，实际 ${actual} 个` }
      }
      case "value": {
        const actual = await locator.first().inputValue()
        return { passed: actual === expected, detail: `期望 "${expected}"，实际 "${actual}"` }
      }
      case "title": {
        const actual = await page.title()
        return { passed: actual === expected, detail: `期望 "${expected}"，实际 "${actual}"` }
      }
      case "enabled": {
        const disabled = await locator.first().isDisabled()
        return { passed: !disabled, detail: disabled ? "元素被禁用" : "元素可用" }
      }
      case "disabled": {
        const disabled = await locator.first().isDisabled()
        return { passed: disabled, detail: disabled ? "元素被禁用" : "元素可用" }
      }
      default:
        return { passed: false, detail: `不支持的断言类型: ${type}` }
    }
  } catch (error) {
    return { passed: false, detail: `断言执行失败: ${error.message}` }
  }
}

/** 执行单个步骤 */
export async function executeStep(page, step, flow) {
  const started = Date.now()
  const result = {
    name: step.name || step.action,
    action: step.action,
    passed: true,
    detail: "",
    duration: 0
  }

  try {
    const baseUrl = flow.config?.baseUrl || ""
    const timeout = flow.config?.timeout || 30000

    switch (step.action) {
      case "navigate":
        result.detail = await navigate(page, step.target.value, baseUrl)
        break
      case "click":
        await resolveLocator(page, step.target).first().click({ timeout })
        result.detail = `已点击 ${step.target.value}`
        break
      case "fill":
        await resolveLocator(page, step.target).first().fill(String(step.value ?? ""), { timeout })
        result.detail = `已输入 ${step.value ?? ""}`
        break
      case "select":
        await resolveLocator(page, step.target).first().selectOption(String(step.value ?? ""), { timeout })
        result.detail = `已选择 ${step.value ?? ""}`
        break
      case "hover":
        await resolveLocator(page, step.target).first().hover({ timeout })
        result.detail = `已悬停 ${step.target.value}`
        break
      case "press":
        await resolveLocator(page, step.target).first().press(String(step.value ?? "Enter"), { timeout })
        result.detail = `已按键 ${step.value ?? "Enter"}`
        break
      case "wait": {
        const ms = Number(step.value) || 1000
        await page.waitForTimeout(ms)
        result.detail = `等待 ${ms}ms`
        break
      }
      case "screenshot": {
        const path = step.value || undefined
        await page.screenshot({ path, fullPage: true })
        result.detail = path ? `截图已保存: ${path}` : "截图完成"
        break
      }
      case "assert":
        break
      default:
        throw new Error(`不支持的动作: ${step.action}`)
    }

    // 步骤自带断言
    if (step.assert) {
      const assertion = await runAssertion(page, step.assert, step.target)
      result.passed = assertion.passed
      result.detail = `${result.detail} | 断言: ${assertion.detail}`.trim()
    }

    // 纯断言步骤
    if (step.action === "assert") {
      const assertion = await runAssertion(page, step.assert || { type: "visible" }, step.target)
      result.passed = assertion.passed
      result.detail = assertion.detail
    }
  } catch (error) {
    result.passed = false
    result.detail = error.message
  }

  result.duration = Date.now() - started
  return result
}

/**
 * 运行完整流程。
 * @param {object} flow 流程定义
 * @param {object} options { chromium, variables, reportDir, captureScreenshot }
 * @returns {object} 执行报告
 */
export async function runFlow(flow, options = {}) {
  const { chromium, variables = {}, reportDir, captureScreenshot = true } = options
  const resolved = resolveFlow(flow, variables)
  // channel 支持 "chrome" / "msedge"，直接用系统已装浏览器，无需下载 Chromium
  const browser = await chromium.launch({
    headless: options.headless !== false,
    ...(options.channel ? { channel: options.channel } : {})
  })
  const context = await browser.newContext({
    viewport: resolved.config?.viewport || { width: 1280, height: 720 }
  })
  const page = await context.newPage()

  const report = {
    name: resolved.name,
    startedAt: new Date().toISOString(),
    passed: true,
    steps: [],
    passedCount: 0,
    failedCount: 0
  }

  try {
    for (const step of resolved.steps) {
      const result = await executeStep(page, step, resolved)
      report.steps.push(result)
      if (result.passed) report.passedCount++
      else {
        report.failedCount++
        report.passed = false
      }

      if (captureScreenshot && reportDir) {
        const safeName = `${String(report.steps.length).padStart(2, "0")}-${step.action}`
        await page.screenshot({ path: `${reportDir}/${safeName}.png` }).catch(() => {})
      }

      if (!result.passed && options.stopOnFailure) break
    }
  } finally {
    await browser.close()
    report.finishedAt = new Date().toISOString()
  }

  return report
}
