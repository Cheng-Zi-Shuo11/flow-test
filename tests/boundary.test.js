import assert from "node:assert/strict"
import test from "node:test"
import { validateFlow, interpolate, resolveFlow } from "../src/flow.js"
import { parseWithRules } from "../src/parser.js"
import { resolveLocator } from "../src/executor.js"

/** 构造假 page：只记录定位方法调用，不启动浏览器（避免与其他测试并发冲突） */
function createFakePage() {
  const calls = []
  const make = method => (...args) => {
    const locator = { method, args }
    calls.push({ method, args, locator })
    return locator
  }
  return {
    calls,
    getByRole: make("getByRole"),
    getByLabel: make("getByLabel"),
    getByPlaceholder: make("getByPlaceholder"),
    getByText: make("getByText"),
    getByTestId: make("getByTestId"),
    locator: make("locator")
  }
}

// ---------- validateFlow ----------

test("流程校验：空对象同时报缺失 name 与 steps", () => {
  assert.deepEqual(validateFlow({}), ["流程缺少 name", "流程缺少 steps 数组"])
})

test("流程校验：缺少 name", () => {
  assert.deepEqual(validateFlow({ steps: [] }), ["流程缺少 name"])
})

test("流程校验：steps 非数组", () => {
  assert.deepEqual(validateFlow({ name: "x", steps: "no" }), ["流程缺少 steps 数组"])
  assert.deepEqual(validateFlow({ name: "x", steps: {} }), ["流程缺少 steps 数组"])
  assert.deepEqual(validateFlow({ name: "x", steps: null }), ["流程缺少 steps 数组"])
})

test("流程校验：非对象输入", () => {
  for (const input of [null, undefined, "x", 42]) {
    assert.deepEqual(validateFlow(input), ["流程必须是对象"])
  }
})

test("流程校验：非法 action", () => {
  const problems = validateFlow({ name: "x", steps: [{ action: "fly", target: {} }] })
  assert.ok(problems.some(p => p.includes("fly") && p.includes("不支持")))
  // 非法 action 不在需要 target 的动作列表中，不应额外报缺 target
  assert.ok(!problems.some(p => p.includes("缺少 target")))
})

test("流程校验：非法断言 type", () => {
  const problems = validateFlow({
    name: "x",
    steps: [{ action: "click", target: { by: "text", value: "x" }, assert: { type: "bogus" } }]
  })
  assert.ok(problems.some(p => p.includes("bogus") && p.includes("断言类型")))
  assert.equal(problems.length, 1)
})

test("流程校验：navigate/click/fill 缺 target 各自报错", () => {
  const problems = validateFlow({
    name: "x",
    steps: [{ action: "navigate" }, { action: "click" }, { action: "fill" }]
  })
  assert.deepEqual(problems, [
    "步骤 1 缺少 target",
    "步骤 2 缺少 target",
    "步骤 3 缺少 target"
  ])
})

test("流程校验：最小合法流程返回空问题列表", () => {
  assert.deepEqual(validateFlow({ name: "合法", steps: [] }), [])
  assert.deepEqual(
    validateFlow({
      name: "合法",
      steps: [{ action: "click", target: { by: "role", value: "button:确定" } }]
    }),
    []
  )
})

// ---------- interpolate / resolveFlow ----------

test("变量注入：未定义变量保留原样，已定义变量被替换", () => {
  assert.equal(interpolate("${a}-${missing}-${b}", { a: "A", b: "B" }), "A-${missing}-B")
})

test("变量注入：非字符串字段原样透传", () => {
  assert.equal(interpolate(123, {}), 123)
  assert.equal(interpolate(true, {}), true)
  assert.equal(interpolate(null, {}), null)
  assert.equal(interpolate(undefined, {}), undefined)
  const obj = { x: 1 }
  assert.equal(interpolate(obj, {}), obj)
})

test("变量注入：空变量对象保留全部占位符", () => {
  assert.equal(interpolate("hello ${x}", {}), "hello ${x}")
  assert.equal(interpolate("${a}${b}", {}), "${a}${b}")
})

test("变量注入：特殊字符与数字值转为字符串", () => {
  assert.equal(interpolate("${x}", { x: `a$b&<>"/` }), `a$b&<>"/`)
  assert.equal(interpolate("值=${n}", { n: 42 }), "值=42")
  assert.equal(interpolate("值=${n}", { n: 0 }), "值=0")
  assert.equal(interpolate("值=${f}", { f: false }), "值=false")
})

test("变量注入：变量名两端空格被忽略，值中的占位符不二次解析", () => {
  assert.equal(interpolate("${ x }", { x: "ok" }), "ok")
  assert.equal(interpolate("${x}", { x: "${y}", y: "Z" }), "${y}")
})

test("流程解析：嵌套对象与数组中的变量全部替换且不修改原对象", () => {
  const flow = {
    name: "${n}",
    config: { baseUrl: "http://${host}", variables: { n: "N", host: "h" } },
    steps: [
      { action: "fill", value: "${v}", target: { by: "css", value: "${sel}" } },
      { action: "wait", value: 100, meta: { arr: ["${v}", 3, false, null] } }
    ]
  }
  const result = resolveFlow(flow, { v: "V", sel: "#s" })
  assert.equal(result.name, "N")
  assert.equal(result.config.baseUrl, "http://h")
  assert.equal(result.steps[0].value, "V")
  assert.deepEqual(result.steps[0].target, { by: "css", value: "#s" })
  assert.deepEqual(result.steps[1].meta.arr, ["V", 3, false, null])
  // 原对象未被修改，且返回的是深拷贝
  assert.equal(flow.name, "${n}")
  assert.equal(flow.steps[0].value, "${v}")
  assert.notStrictEqual(result, flow)
  assert.notStrictEqual(result.steps[0], flow.steps[0])
})

test("流程解析：extraVariables 覆盖同名内置变量", () => {
  const flow = { name: "${who}", config: { variables: { who: "内部" } }, steps: [] }
  assert.equal(resolveFlow(flow).name, "内部")
  assert.equal(resolveFlow(flow, { who: "外部" }).name, "外部")
})

test("流程解析：空变量对象与非字符串字段行为", () => {
  const flow = {
    name: "${keep}",
    config: { variables: {} },
    steps: [{ action: "wait", value: 5, flag: true, empty: null }]
  }
  const result = resolveFlow(flow)
  assert.equal(result.name, "${keep}")
  assert.equal(result.steps[0].value, 5)
  assert.equal(result.steps[0].flag, true)
  assert.equal(result.steps[0].empty, null)
})

// ---------- parseWithRules ----------

test("规则解析：空字符串返回空步骤数组", () => {
  assert.deepEqual(parseWithRules(""), [])
  assert.deepEqual(parseWithRules("   "), [])
  assert.deepEqual(parseWithRules(undefined), [])
})

test("规则解析：单步骤识别点击动作并剥离按钮后缀", () => {
  const [step] = parseWithRules("点击登录按钮")
  assert.equal(step.action, "click")
  assert.deepEqual(step.target, { by: "role", value: "button:登录" })
})

test("规则解析：序号前缀（1. / 1、/ 1)）被剥离", () => {
  for (const line of ["1. 打开 /login", "1、打开 /login", "1) 打开 /login"]) {
    const [step] = parseWithRules(line)
    assert.equal(step.action, "navigate")
    assert.equal(step.name, "打开 /login")
    assert.deepEqual(step.target, { by: "url", value: "/login" })
  }
})

test("规则解析：中文分号与英文分号分隔多步骤", () => {
  for (const sep of ["；", ";"]) {
    const steps = parseWithRules(`打开 /a${sep}点击登录按钮${sep}验证出现成功`)
    assert.equal(steps.length, 3)
    assert.deepEqual(steps.map(s => s.action), ["navigate", "click", "assert"])
  }
})

test("规则解析：换行与 CRLF 分隔多步骤", () => {
  for (const sep of ["\n", "\r\n"]) {
    const steps = parseWithRules(`打开 /a${sep}点击登录按钮${sep}验证出现成功`)
    assert.equal(steps.length, 3)
    assert.deepEqual(steps.map(s => s.action), ["navigate", "click", "assert"])
  }
})

test("规则解析：等待单位秒转毫秒，ms 与无单位按原值", () => {
  assert.equal(parseWithRules("等待 2 秒")[0].action, "wait")
  assert.equal(parseWithRules("等待 2 秒")[0].value, 2000)
  assert.equal(parseWithRules("等待 1.5 秒")[0].value, 1500)
  assert.equal(parseWithRules("等待 500 ms")[0].value, 500)
  assert.equal(parseWithRules("等待 500 毫秒")[0].value, 500)
  assert.equal(parseWithRules("等待 2")[0].value, 2)
})

test("规则解析：无关键词时兜底为文本可见断言", () => {
  const [step] = parseWithRules("无关描述文本")
  assert.equal(step.action, "assert")
  assert.equal(step.name, "1. 无关描述文本")
  assert.deepEqual(step.target, { by: "text", value: "无关描述文本" })
  assert.deepEqual(step.assert, { type: "visible" })
})

test("规则解析：英文引号内文本提取（输入/断言/点击/截图）", () => {
  const [fill] = parseWithRules(`在"用户名"输入框输入"admin"`)
  assert.equal(fill.action, "fill")
  assert.deepEqual(fill.target, { by: "placeholder", value: "用户名" })
  assert.equal(fill.value, "admin")

  const [assertion] = parseWithRules(`验证"成功"`)
  assert.deepEqual(assertion.target, { by: "text", value: "成功" })

  const [click] = parseWithRules(`点击"登录"按钮`)
  assert.deepEqual(click.target, { by: "role", value: "button:登录" })

  const [shot] = parseWithRules(`截图"result.png"`)
  assert.equal(shot.action, "screenshot")
  assert.equal(shot.value, "result.png")
})

test("规则解析：中文引号 fill 目标名吞入右引号（已知缺陷，记录当前行为）", () => {
  const [step] = parseWithRules(`在「邮箱」输入框输入「a@b.com」`)
  assert.equal(step.action, "fill")
  // 缺陷：正则捕获组未排除右引号 」，导致目标名多出该字符；理想值应为 "邮箱"
  assert.equal(step.target.value, "邮箱」")
  assert.equal(step.value, "a@b.com")
})

// ---------- resolveLocator ----------

test("定位器：role 方式拆分角色与名称并调用 getByRole", () => {
  const page = createFakePage()
  const withName = resolveLocator(page, { by: "role", value: "button:登录" })
  assert.deepEqual(withName.args, ["button", { name: "登录" }])
  const withoutName = resolveLocator(page, { by: "role", value: "button" })
  assert.deepEqual(withoutName.args, ["button"])
  const multiColon = resolveLocator(page, { by: "role", value: "button:a:b" })
  assert.deepEqual(multiColon.args, ["button", { name: "a:b" }])
})

test("定位器：label/placeholder/text/testId/css 各方式产出可用对象", () => {
  const page = createFakePage()
  const cases = [
    [{ by: "label", value: "用户名" }, "getByLabel", ["用户名"]],
    [{ by: "placeholder", value: "请输入" }, "getByPlaceholder", ["请输入"]],
    [{ by: "text", value: "提交" }, "getByText", ["提交"]],
    [{ by: "testId", value: "submit-btn" }, "getByTestId", ["submit-btn"]],
    [{ by: "css", value: "#app .btn" }, "locator", ["#app .btn"]]
  ]
  for (const [target, method, args] of cases) {
    const locator = resolveLocator(page, target)
    assert.equal(locator.method, method)
    assert.deepEqual(locator.args, args)
    // 返回值即假 page 产出的 locator 对象，可被后续 .first()/click() 使用
    assert.equal(page.calls.at(-1).locator, locator)
  }
})

test("定位器：url 返回 null 供 navigate 专用", () => {
  assert.equal(resolveLocator(createFakePage(), { by: "url", value: "/login" }), null)
})

test("定位器：非法 by 与缺少 target 均抛错", () => {
  const page = createFakePage()
  assert.throws(() => resolveLocator(page, { by: "xpath", value: "//div" }), /不支持的定位方式: xpath/)
  assert.throws(() => resolveLocator(page, undefined), /缺少 target/)
})
