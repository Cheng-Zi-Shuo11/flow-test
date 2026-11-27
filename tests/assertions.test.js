import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { runAssertion } from "../src/executor.js"

/**
 * 断言边界测试：用真实浏览器验证隐藏元素不会被误判为可见。
 * 使用系统 Chrome，避免依赖 Chromium 下载。
 */
async function withPage(fn) {
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent(`
      <div id="visible">登录成功</div>
      <div id="hidden" style="display:none">登录成功</div>
    `)
    return await fn(page)
  } finally {
    await browser.close()
  }
}

test("textContains：可见元素匹配成功", async () => {
  await withPage(async page => {
    const result = await runAssertion(
      page,
      { type: "textContains", value: "登录成功" },
      { by: "css", value: "#visible" }
    )
    assert.equal(result.passed, true)
    assert.match(result.detail, /可见且包含/)
  })
})

test("textContains：隐藏元素不得判定成功", async () => {
  await withPage(async page => {
    const result = await runAssertion(
      page,
      { type: "textContains", value: "登录成功" },
      { by: "css", value: "#hidden" }
    )
    assert.equal(result.passed, false)
    assert.match(result.detail, /不可见|隐藏/)
  })
})

test("text：隐藏元素不得判定成功", async () => {
  await withPage(async page => {
    const result = await runAssertion(
      page,
      { type: "text", value: "登录成功" },
      { by: "css", value: "#hidden" }
    )
    assert.equal(result.passed, false)
  })
})

test("visible：隐藏元素超时后判定失败", async () => {
  await withPage(async page => {
    const result = await runAssertion(
      page,
      { type: "visible" },
      { by: "css", value: "#hidden" }
    )
    assert.equal(result.passed, false)
  })
})

test("count：统计匹配元素数量", async () => {
  await withPage(async page => {
    const result = await runAssertion(
      page,
      { type: "count", value: "2" },
      { by: "text", value: "登录成功" }
    )
    assert.equal(result.passed, true)
    assert.match(result.detail, /实际 2 个/)
  })
})
