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
    case "textExact":
      return page.getByText(value, { exact: true })
    case "testId":
      return page.getByTestId(value)
    case "css":
      return page.locator(value)
    default:
      throw new Error(`不支持的定位方式: ${target.by}`)
  }
}

/** 可点击元素的常见 role。菜单项、页签、树节点往往不是 button */
const CLICK_ROLES = [
  "button",
  "menuitem",
  "link",
  "tab",
  "treeitem",
  "option",
  "listitem",
  "menuitemradio"
]

/** 可输入元素的常见 role */
const FIELD_ROLES = ["textbox", "combobox", "searchbox", "spinbutton"]

/**
 * 生成候选定位链，从最精确到最宽松。
 *
 * 这是平台能适配"没有语义化标签的老系统"的关键：用户只写"点击站点实况"，
 * 平台先按 role=button 找，找不到就依次退化到 menuitem/link/tab、精确文本、包含文本、CSS。
 */
export function buildCandidates(target, kind = "click") {
  const raw = String(target?.value ?? "")
  const list = []
  const push = (by, value) => {
    if (!value) return
    if (!list.some(item => item.by === by && item.value === value)) list.push({ by, value })
  }

  if (target?.by === "role") {
    const [role, ...rest] = raw.split(":")
    const name = rest.join(":").trim()
    push("role", raw)
    if (name) {
      const roles = kind === "field" ? FIELD_ROLES : CLICK_ROLES
      for (const alt of roles) {
        if (alt !== role.trim()) push("role", `${alt}:${name}`)
      }
      push("textExact", name)
      push("text", name)
    }
    return list
  }

  if (kind === "field") {
    push(target?.by, raw)
    push("placeholder", raw)
    push("label", raw)
    push("css", `input[placeholder*="${raw}"], textarea[placeholder*="${raw}"]`)
    push("css", `input[name="${raw}"], select[name="${raw}"], textarea[name="${raw}"]`)
    return list
  }

  if (target?.by === "text") {
    push("textExact", raw)
    push("text", raw)
  } else {
    push(target?.by, raw)
    push("textExact", raw)
    push("text", raw)
  }
  push("css", `[title="${raw}"], [aria-label="${raw}"]`)
  return list
}

/** 在页面打开目标地址，支持相对路径与绝对 URL */
export async function navigate(page, url, baseUrl) {
  const fullUrl = /^(https?:)?\/\//.test(url) ? url : new URL(url, baseUrl || undefined).toString()
  await page.goto(fullUrl, { waitUntil: "domcontentloaded" })
  return fullUrl
}

/** count() 在页面跳转或 frame 卸载时会抛错，这里吞掉当 0 处理 */
async function countSafe(locator) {
  try {
    return await locator.count()
  } catch {
    return 0
  }
}

/** 在单个 frame 内按候选链尝试执行动作 */
async function attemptInFrame(frame, candidates, perform, timeout) {
  const probe = Math.min(1500, timeout)
  for (const candidate of candidates) {
    let locator
    try {
      locator = resolveLocator(frame, candidate)
    } catch {
      continue
    }
    if (!locator) continue
    if ((await countSafe(locator)) === 0) continue
    try {
      const node = locator.first()
      await node.waitFor({ state: "visible", timeout: probe })
      await perform(node)
      return { ok: true, used: candidate }
    } catch {
      // 该候选存在但不可交互（被遮挡、只读等），继续试下一个
    }
  }
  return { ok: false }
}

/** 定位失败时收集现场信息，给出可操作的诊断，而不是只抛一句 timeout */
async function collectDiagnostics(page, target) {
  const keyword = String(target?.value ?? "").replace(/^[a-zA-Z]+:/, "")
  const lines = []

  let info = null
  try {
    info = await page.evaluate(kw => {
      const matches = []
      for (const el of document.querySelectorAll("body *")) {
        const text = (el.textContent || "").trim()
        if (!text || text.length > 80 || !text.includes(kw)) continue
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        const visible =
          rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
        matches.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") || "",
          visible,
          text: text.slice(0, 40)
        })
        if (matches.length >= 10) break
      }
      return { matches, frames: window.frames.length, title: document.title, url: location.href }
    }, keyword)
  } catch (error) {
    lines.push(`页面诊断失败: ${error.message}`)
  }

  if (info) {
    const visible = info.matches.filter(m => m.visible)
    const hidden = info.matches.filter(m => !m.visible)
    lines.push(`当前页面: ${info.title || "(无标题)"} ${info.url}`)

    if (!info.matches.length) {
      lines.push(`页面上找不到任何包含「${keyword}」的元素`)
      if (info.frames > 0) {
        lines.push(`页面含 ${info.frames} 个内嵌框架，若内容在框架内且已尝试仍失败，说明该框架尚未加载完成`)
      }
      lines.push(`建议: 确认登录后菜单已展开；或在步骤前加一步「等待 2000」`)
    } else if (!visible.length) {
      lines.push(`找到 ${hidden.length} 个包含「${keyword}」的元素，但都不可见`)
      hidden.slice(0, 3).forEach(m => lines.push(`  - <${m.tag}${m.role ? ` role="${m.role}"` : ""}> ${m.text}`))
      lines.push(`建议: 菜单可能是折叠状态，先补一步点击展开菜单，或加「等待」`)
    } else {
      lines.push(`找到 ${visible.length} 个可见的候选元素（说明定位方式不匹配，元素本身存在）:`)
      visible
        .slice(0, 5)
        .forEach(m => lines.push(`  - <${m.tag}${m.role ? ` role="${m.role}"` : ""}> ${m.text}`))
      const nonButton = visible.find(m => !["button", "menuitem", "link", "tab"].includes(m.role))
      if (nonButton) {
        lines.push(`建议: 该元素是 <${nonButton.tag}>，没有按钮语义`)
        lines.push(`  把步骤改写成 {"by":"css","value":"#选择器"} 或 {"by":"text","value":"${keyword}"} 可稳定命中`)
      }
    }
  }

  return lines.join("\n")
}

/**
 * 带降级的元素动作：主定位失败时自动尝试其他 role / 文本 / CSS，并在页面各 iframe 中查找。
 * 这样"点击顶部菜单站点实况"这类自然语言步骤，不必要求被测系统有语义化标签。
 */
export async function actWithFallback(page, target, options) {
  const { kind = "click", timeout = 30000, perform, actionLabel = "操作" } = options
  const candidates = buildCandidates(target, kind)
  if (!candidates.length) throw new Error(`缺少可用的定位描述: ${JSON.stringify(target)}`)

  for (const frame of page.frames()) {
    const result = await attemptInFrame(frame, candidates, perform, Math.min(timeout, 8000))
    if (result.ok) {
      return { used: result.used, fallback: result.used.by !== target.by || result.used.value !== target.value }
    }
  }

  // 元素可能还在渲染（SPA 路由切换后菜单才挂载），给主定位一次完整等待
  const primary = candidates[0]
  try {
    const locator = resolveLocator(page, primary)
    if (locator) {
      await locator.first().waitFor({ state: "visible", timeout: Math.min(timeout, 10000) })
      await perform(locator.first())
      return { used: primary, fallback: false }
    }
  } catch {
    // 落到诊断
  }

  const diagnostics = await collectDiagnostics(page, target)
  const display = String(target.value ?? "").replace(/^[a-zA-Z]+:/, "")
  throw new Error(`无法定位「${display}」（${actionLabel}失败）\n${diagnostics}`)
}

/** 执行单个断言，返回 { passed, detail } */
export async function runAssertion(page, assertion, target) {
  const type = assertion.type
  const expected = assertion.value
  const locator = target ? resolveLocator(page, target) : null

  // 需要期望值的断言类型；漏填时给出明确提示，而不是拼出 "包含 undefined"
  const needsValue = ["text", "textContains", "url", "urlContains", "count", "value", "title"]
  if (needsValue.includes(type) && (expected === undefined || expected === null || expected === "")) {
    return { passed: false, detail: `断言 ${type} 缺少 value（期望值），请补全后重试` }
  }

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
      case "click": {
        const { used, fallback } = await actWithFallback(page, step.target, {
          kind: "click",
          timeout,
          actionLabel: "点击",
          perform: node => node.click({ timeout: Math.min(timeout, 10000) })
        })
        result.detail = `已点击 ${step.target.value}${fallback ? `（降级定位: ${used.by}=${used.value}）` : ""}`
        break
      }
      case "fill": {
        const text = String(step.value ?? "")
        const { used, fallback } = await actWithFallback(page, step.target, {
          kind: "field",
          timeout,
          actionLabel: "输入",
          perform: node => node.fill(text, { timeout: Math.min(timeout, 10000) })
        })
        result.detail = `已输入 ${text}${fallback ? `（降级定位: ${used.by}=${used.value}）` : ""}`
        break
      }
      case "select": {
        const text = String(step.value ?? "")
        const { used, fallback } = await actWithFallback(page, step.target, {
          kind: "field",
          timeout,
          actionLabel: "选择",
          perform: node => node.selectOption(text, { timeout: Math.min(timeout, 10000) })
        })
        result.detail = `已选择 ${text}${fallback ? `（降级定位: ${used.by}=${used.value}）` : ""}`
        break
      }
      case "hover":
        await actWithFallback(page, step.target, {
          kind: "click",
          timeout,
          actionLabel: "悬停",
          perform: node => node.hover({ timeout: Math.min(timeout, 10000) })
        })
        result.detail = `已悬停 ${step.target.value}`
        break
      case "press":
        await actWithFallback(page, step.target, {
          kind: "field",
          timeout,
          actionLabel: "按键",
          perform: node => node.press(String(step.value ?? "Enter"), { timeout: Math.min(timeout, 10000) })
        })
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

/** 点击后若系统打开了新标签页或新窗口，返回新页面；否则返回 null */
async function adoptNewPage(context, page, before, timeout = 800) {
  const deadline = Date.now() + timeout
  do {
    const opened = context.pages().filter(item => !before.has(item) && item !== page)
    if (opened.length) return opened[opened.length - 1]
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  return null
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
  let page = await context.newPage()

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
      const pagesBefore = new Set(context.pages())
      const result = await executeStep(page, step, resolved)

      // 点击菜单/链接后系统可能打开新标签页，后续步骤必须跟到新页面，
      // 否则会一直在旧页面上找不到元素（气象系统常见：菜单在新窗口打开）
      if (step.action === "click" && result.passed) {
        const next = await adoptNewPage(context, page, pagesBefore)
        if (next) {
          await next.waitForLoadState("domcontentloaded").catch(() => {})
          page = next
          result.detail = `${result.detail}；已切换到新打开的页面`
        }
      }

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
