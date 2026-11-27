import assert from "node:assert/strict"
import test from "node:test"
import http from "node:http"
import { chromium } from "playwright"
import { buildCandidates, actWithFallback, runFlow } from "../src/executor.js"

/**
 * 降级定位测试。
 * 场景来源：真实系统里顶部菜单常是 <li>/<div>，没有 button 语义，
 * 若只按 role=button 定位会一直等到超时。
 */

test("buildCandidates：role=button 会补齐菜单类 role 与文本兜底", () => {
  const candidates = buildCandidates({ by: "role", value: "button:站点实况" }, "click")
  const roles = candidates.filter(c => c.by === "role").map(c => c.value)
  assert.ok(roles.includes("button:站点实况"))
  assert.ok(roles.includes("menuitem:站点实况"))
  assert.ok(roles.includes("link:站点实况"))
  assert.ok(roles.includes("tab:站点实况"))
  assert.ok(candidates.some(c => c.by === "textExact" && c.value === "站点实况"))
  assert.ok(candidates.some(c => c.by === "text" && c.value === "站点实况"))
  // 主定位必须排在最前，不改变原有精确路径
  assert.equal(candidates[0].value, "button:站点实况")
})

test("buildCandidates：文本定位优先精确匹配", () => {
  const candidates = buildCandidates({ by: "text", value: "站点实况" }, "click")
  assert.equal(candidates[0].by, "textExact")
})

test("buildCandidates：输入类定位补充 placeholder/label/name 兜底", () => {
  const candidates = buildCandidates({ by: "placeholder", value: "用户名" }, "field")
  assert.equal(candidates[0].by, "placeholder")
  assert.ok(candidates.some(c => c.by === "label"))
  assert.ok(candidates.some(c => c.by === "css" && c.value.includes("placeholder*=")))
  assert.ok(candidates.some(c => c.by === "css" && c.value.includes('[name="用户名"]')))
})

async function withPage(html, fn) {
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent(html)
    return await fn(page)
  } finally {
    await browser.close()
  }
}

test("点击：菜单项是 li 无 button 语义时，降级到文本定位后点击成功", async () => {
  const html = `
    <div id="result">未点击</div>
    <ul class="menu">
      <li onclick="document.getElementById('result').textContent='已点击站点实况'">站点实况</li>
    </ul>
  `
  await withPage(html, async page => {
    const { used, fallback } = await actWithFallback(
      page,
      { by: "role", value: "button:站点实况" },
      {
        kind: "click",
        timeout: 5000,
        actionLabel: "点击",
        perform: node => node.click({ timeout: 3000 })
      }
    )
    assert.equal(fallback, true)
    assert.notEqual(used.by, "role")
    assert.equal(await page.locator("#result").textContent(), "已点击站点实况")
  })
})

test("点击：元素在 iframe 内也能点到", async () => {
  const html = `
    <div id="result">未点击</div>
    <iframe srcdoc="<div id='in'>站点实况</div><script>document.getElementById('in').onclick=()=>parent.document.getElementById('result').textContent='框架内已点击'</script>"></iframe>
  `
  await withPage(html, async page => {
    await actWithFallback(
      page,
      { by: "text", value: "站点实况" },
      {
        kind: "click",
        timeout: 5000,
        actionLabel: "点击",
        perform: node => node.click({ timeout: 3000 })
      }
    )
    assert.equal(await page.locator("#result").textContent(), "框架内已点击")
  })
})

test("点击：完全找不到目标时，报错包含诊断信息与建议", async () => {
  await withPage(`<div><span>首页</span></div>`, async page => {
    await assert.rejects(
      () =>
        actWithFallback(
          page,
          { by: "role", value: "button:站点实况" },
          {
            kind: "click",
            timeout: 2000,
            actionLabel: "点击",
            perform: node => node.click({ timeout: 1000 })
          }
        ),
      error => {
        assert.match(error.message, /无法定位「站点实况」/)
        assert.match(error.message, /找不到任何包含「站点实况」的元素/)
        assert.match(error.message, /建议/)
        return true
      }
    )
  })
})

test("点击：目标存在但被隐藏时，诊断提示不可见", async () => {
  const html = `<div style="display:none">站点实况</div>`
  await withPage(html, async page => {
    await assert.rejects(
      () =>
        actWithFallback(
          page,
          { by: "text", value: "站点实况" },
          {
            kind: "click",
            timeout: 2000,
            actionLabel: "点击",
            perform: node => node.click({ timeout: 1000 })
          }
        ),
      error => {
        assert.match(error.message, /不可见|隐藏/)
        return true
      }
    )
  })
})

test("解析：菜单类匹配词不再把方位修饰吃进目标文本", async () => {
  const { parseWithRules } = await import("../src/parser.js")
  const cases = [
    ["点击顶部菜单的站点实况", "站点实况"],
    ["点击左侧导航栏中的预报制作", "预报制作"],
    ["选择顶部菜单 公报制作", "公报制作"],
    ["点击站点实况菜单", "站点实况"]
  ]
  for (const [line, expected] of cases) {
    const [step] = parseWithRules(line)
    assert.equal(step.action, "click", line)
    assert.equal(step.target.value, expected, `${line} → 期望 ${expected}`)
  }
})

test("解析：普通按钮仍用 role 定位，不受菜单规则影响", async () => {
  const { parseWithRules } = await import("../src/parser.js")
  const [step] = parseWithRules("点击登录按钮")
  assert.equal(step.target.by, "role")
  assert.equal(step.target.value, "button:登录")
})

test("断言：textContains 缺期望值时给出明确提示而非 undefined", async () => {
  const { runAssertion } = await import("../src/executor.js")
  await withPage(`<div>站点实况</div>`, async page => {
    const result = await runAssertion(page, { type: "textContains" }, { by: "css", value: "div" })
    assert.equal(result.passed, false)
    assert.match(result.detail, /缺少 value/)
    assert.doesNotMatch(result.detail, /undefined/)
  })
})

test("执行：点击打开新标签页后，后续步骤跟到新页面", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    if (req.url === "/panel") {
      res.end("<h1>面板已加载</h1>")
    } else {
      res.end('<a href="/panel" target="_blank">打开面板</a>')
    }
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  const flow = {
    name: "新窗口接管",
    config: { baseUrl, variables: {}, timeout: 15000, viewport: { width: 1024, height: 768 } },
    steps: [
      { name: "打开首页", action: "navigate", target: { by: "url", value: "/" } },
      { name: "点击打开面板", action: "click", target: { by: "text", value: "打开面板" } },
      {
        name: "验证新页面内容",
        action: "assert",
        target: { by: "text", value: "面板已加载" },
        assert: { type: "visible" }
      }
    ]
  }

  try {
    const report = await runFlow(flow, { chromium, channel: "chrome", headless: true, captureScreenshot: false })
    assert.equal(report.passed, true, JSON.stringify(report.steps, null, 2))
    assert.equal(report.passedCount, 3)
    assert.match(report.steps[1].detail, /切换到新打开的页面/)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
