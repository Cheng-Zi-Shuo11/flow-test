import { test } from "node:test"
import assert from "node:assert/strict"
import { handleMessage } from "../src/mcp-server.js"

const call = (method, params, id = 1) => handleMessage({ jsonrpc: "2.0", id, method, params })

test("initialize 返回协议版本与服务信息", async () => {
  const res = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
  assert.equal(res.jsonrpc, "2.0")
  assert.equal(res.id, 1)
  assert.equal(res.result.serverInfo.name, "flowtest")
  assert.ok(res.result.protocolVersion)
  assert.deepEqual(res.result.capabilities.tools, {})
})

test("初始化通知不产生响应", async () => {
  const res = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })
  assert.equal(res, null)
})

test("tools/list 暴露全部工具且带 schema", async () => {
  const res = await call("tools/list", {})
  const names = res.result.tools.map(tool => tool.name)
  assert.equal(names.length, 7)
  for (const expected of [
    "flowtest_parse_steps",
    "flowtest_validate_flow",
    "flowtest_run_flow",
    "flowtest_save_flow",
    "flowtest_list_flows",
    "flowtest_list_reports",
    "flowtest_get_report"
  ]) {
    assert.ok(names.includes(expected), `缺少工具 ${expected}`)
  }
  for (const tool of res.result.tools) {
    assert.equal(tool.inputSchema.type, "object")
    assert.ok(tool.description && tool.description.length > 0, `${tool.name} 缺少描述`)
  }
})

test("parse_steps 规则解析出结构化步骤", async () => {
  const res = await call("tools/call", {
    name: "flowtest_parse_steps",
    arguments: { text: "打开 /login\n在用户名输入框输入 admin\n点击登录按钮", preferRules: true }
  })
  const payload = JSON.parse(res.result.content[0].text)
  assert.equal(payload.engine, "rules")
  assert.equal(payload.steps.length, 3)
  assert.equal(payload.steps[0].action, "navigate")
})

test("validate_flow 对空流程给出问题", async () => {
  const res = await call("tools/call", {
    name: "flowtest_validate_flow",
    arguments: { flow: { name: "", steps: [] } }
  })
  const payload = JSON.parse(res.result.content[0].text)
  assert.equal(payload.valid, false)
  assert.ok(payload.problems.length > 0)
})

test("非法工具名返回 JSON-RPC 错误而不是崩溃", async () => {
  const res = await call("tools/call", { name: "not_exists", arguments: {} })
  assert.ok(res.error)
  assert.equal(res.error.code, -32603)
})

test("未知方法返回 -32601", async () => {
  const res = await call("unknown/method", {})
  assert.equal(res.error.code, -32601)
})

test("非法 JSON 之外的畸形请求返回 Invalid Request", async () => {
  const res = await handleMessage(null)
  assert.equal(res.error.code, -32600)
})
