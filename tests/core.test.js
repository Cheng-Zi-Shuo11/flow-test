import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { validateFlow, interpolate, resolveFlow } from "../src/flow.js"
import { parseWithRules, parseSteps } from "../src/parser.js"

test("流程校验：合法流程返回空问题列表", () => {
  const flow = JSON.parse(readFileSync(new URL("../examples/demo.flow.json", import.meta.url), "utf8"))
  assert.deepEqual(validateFlow(flow), [])
})

test("流程校验：捕获非法动作与缺失 target", () => {
  const problems = validateFlow({
    name: "bad",
    steps: [
      { action: "fly", target: { by: "text", value: "x" } },
      { action: "click" }
    ]
  })
  assert.ok(problems.some(p => p.includes("fly")))
  assert.ok(problems.some(p => p.includes("缺少 target")))
})

test("变量注入：${var} 被替换，未定义变量保留原样", () => {
  assert.equal(interpolate("用户 ${username}", { username: "admin" }), "用户 admin")
  assert.equal(interpolate("${missing}", {}), "${missing}")
})

test("流程解析：变量在嵌套结构中生效", () => {
  const flow = {
    name: "${name}",
    config: { baseUrl: "${url}", variables: { name: "测试" } },
    steps: [{ action: "fill", target: { by: "placeholder", value: "${field}" }, value: "${value}" }]
  }
  const result = resolveFlow(flow, { url: "http://x", field: "用户名", value: "admin" })
  assert.equal(result.name, "测试")
  assert.equal(result.config.baseUrl, "http://x")
  assert.equal(result.steps[0].target.value, "用户名")
  assert.equal(result.steps[0].value, "admin")
})

test("规则解析：识别打开、输入、点击、验证四类核心动作", () => {
  const steps = parseWithRules(`打开 /login
在用户名输入框输入 admin
点击登录按钮
验证页面出现登录成功`)
  assert.equal(steps.length, 4)
  assert.equal(steps[0].action, "navigate")
  assert.deepEqual(steps[0].target, { by: "url", value: "/login" })
  assert.equal(steps[1].action, "fill")
  assert.equal(steps[1].value, "admin")
  assert.equal(steps[2].action, "click")
  assert.equal(steps[3].action, "assert")
  assert.equal(steps[3].assert.type, "visible")
})

test("规则解析：等待秒数转换为毫秒", () => {
  const [step] = parseWithRules("等待 2 秒")
  assert.equal(step.action, "wait")
  assert.equal(step.value, 2000)
})

test("统一解析入口：无 LLM 配置时走规则引擎", async () => {
  const result = await parseSteps("打开 /home", undefined)
  assert.equal(result.engine, "rules")
  assert.equal(result.steps[0].action, "navigate")
})

test("统一解析入口：LLM 失败自动降级为规则", async () => {
  const badConfig = {
    apiKey: "invalid",
    endpoint: "http://127.0.0.1:1/unreachable"
  }
  const result = await parseSteps("点击登录按钮", badConfig)
  assert.equal(result.engine, "rules")
  assert.ok(result.warning.includes("降级"))
  assert.equal(result.steps[0].action, "click")
})
