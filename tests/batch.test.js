import assert from "node:assert/strict"
import test from "node:test"
import { runBatch } from "../src/batch.js"

/** 构造一个通过 validateFlow 的最小合法流程 */
function makeFlow(name) {
  return {
    name,
    config: { baseUrl: "http://localhost" },
    steps: [{ action: "navigate", target: { by: "url", value: "/" } }]
  }
}

/** 构造 runFlow 风格的报告，overrides 可覆盖通过/失败状态 */
function makeReport(name, overrides = {}) {
  return {
    name,
    passed: true,
    steps: [],
    passedCount: 1,
    failedCount: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ...overrides
  }
}

test("runBatch：聚合统计正确并回传各流程报告", async () => {
  const calls = []
  const result = await runBatch([makeFlow("A"), makeFlow("B"), makeFlow("C")], {
    runFlowImpl: async flow => {
      calls.push(flow.name)
      return makeReport(
        flow.name,
        flow.name === "B" ? { passed: false, passedCount: 0, failedCount: 2 } : {}
      )
    }
  })

  assert.equal(result.passed, false)
  assert.equal(result.total, 3)
  assert.equal(result.successCount, 2)
  assert.equal(result.failureCount, 1)
  assert.equal(result.results.length, 3)
  assert.deepEqual(calls, ["A", "B", "C"])
  assert.equal(result.results[0].report.name, "A")
  assert.equal(result.results[1].passed, false)
  assert.equal(result.results[1].failedCount, 2)
  assert.ok(result.duration >= 0)
})

test("runBatch：全部通过时批次 passed 为 true", async () => {
  const result = await runBatch([makeFlow("A"), makeFlow("B")], {
    runFlowImpl: async flow => makeReport(flow.name)
  })

  assert.equal(result.passed, true)
  assert.equal(result.total, 2)
  assert.equal(result.successCount, 2)
  assert.equal(result.failureCount, 0)
})

test("runBatch：continueOnFailure=true 时失败后继续执行后续流程", async () => {
  const calls = []
  const result = await runBatch([makeFlow("A"), makeFlow("B"), makeFlow("C")], {
    continueOnFailure: true,
    runFlowImpl: async flow => {
      calls.push(flow.name)
      const failed = flow.name === "A"
      return makeReport(flow.name, {
        passed: !failed,
        passedCount: failed ? 0 : 1,
        failedCount: failed ? 1 : 0
      })
    }
  })

  assert.deepEqual(calls, ["A", "B", "C"])
  assert.equal(result.total, 3)
  assert.equal(result.successCount, 2)
  assert.equal(result.failureCount, 1)
})

test("runBatch：continueOnFailure=false 时首个失败后立即中断", async () => {
  const calls = []
  const result = await runBatch([makeFlow("A"), makeFlow("B"), makeFlow("C")], {
    continueOnFailure: false,
    runFlowImpl: async flow => {
      calls.push(flow.name)
      return makeReport(flow.name, { passed: false, passedCount: 0, failedCount: 1 })
    }
  })

  assert.deepEqual(calls, ["A"])
  assert.equal(result.total, 1)
  assert.equal(result.successCount, 0)
  assert.equal(result.failureCount, 1)
  assert.equal(result.passed, false)
})

test("runBatch：单个流程抛异常被捕获，默认不中断批次", async () => {
  const calls = []
  const result = await runBatch([makeFlow("A"), makeFlow("B"), makeFlow("C")], {
    runFlowImpl: async flow => {
      calls.push(flow.name)
      if (flow.name === "B") throw new Error("浏览器崩了")
      return makeReport(flow.name)
    }
  })

  assert.deepEqual(calls, ["A", "B", "C"])
  assert.equal(result.total, 3)
  assert.equal(result.successCount, 2)
  assert.equal(result.failureCount, 1)
  assert.equal(result.results[1].passed, false)
  assert.equal(result.results[1].report, null)
  assert.match(result.results[1].error, /浏览器崩了/)
})

test("runBatch：continueOnFailure=false 时异常同样中断批次", async () => {
  const calls = []
  const result = await runBatch([makeFlow("A"), makeFlow("B")], {
    continueOnFailure: false,
    runFlowImpl: async flow => {
      calls.push(flow.name)
      throw new Error("启动失败")
    }
  })

  assert.deepEqual(calls, ["A"])
  assert.equal(result.total, 1)
  assert.equal(result.failureCount, 1)
  assert.match(result.results[0].error, /启动失败/)
})

test("runBatch：非法流程被标记失败且不进入执行器", async () => {
  const badFlow = {
    name: "坏流程",
    steps: [{ action: "fly", target: { by: "text", value: "x" } }]
  }
  const calls = []
  const result = await runBatch([makeFlow("A"), badFlow, makeFlow("C")], {
    runFlowImpl: async flow => {
      calls.push(flow.name)
      return makeReport(flow.name)
    }
  })

  assert.deepEqual(calls, ["A", "C"])
  assert.equal(result.total, 3)
  assert.equal(result.successCount, 2)
  assert.equal(result.failureCount, 1)
  assert.equal(result.results[1].passed, false)
  assert.equal(result.results[1].report, null)
  assert.match(result.results[1].error, /校验失败/)
  assert.match(result.results[1].error, /fly/)
})

test("runBatch：将 channel/headless/reportDir 等选项透传给执行器", async () => {
  let received
  await runBatch([makeFlow("A")], {
    channel: "chrome",
    headless: false,
    reportDir: "/tmp/flowtest-reports",
    variables: { user: "admin" },
    stopOnFailure: true,
    runFlowImpl: async (flow, opts) => {
      received = opts
      return makeReport(flow.name)
    }
  })

  assert.equal(received.channel, "chrome")
  assert.equal(received.headless, false)
  assert.equal(received.reportDir, "/tmp/flowtest-reports")
  assert.deepEqual(received.variables, { user: "admin" })
  assert.equal(received.stopOnFailure, true)
  assert.ok(received.chromium, "应把 playwright 的 chromium 透传给执行器")
})
