/**
 * 流程定义的数据结构与校验。
 *
 * 一个流程 = 配置（地址、变量、超时）+ 步骤数组。
 * 每个步骤 = 动作（做什么）+ 可选断言（验证什么）。
 * 流程与被测项目完全解耦：项目差异通过 config.variables 注入。
 */

export const ACTIONS = {
  navigate: "navigate",
  click: "click",
  fill: "fill",
  select: "select",
  hover: "hover",
  press: "press",
  wait: "wait",
  screenshot: "screenshot",
  assert: "assert"
}

export const ASSERT_TYPES = {
  visible: "visible",
  hidden: "hidden",
  text: "text",
  textContains: "textContains",
  url: "url",
  urlContains: "urlContains",
  count: "count",
  value: "value",
  title: "title",
  enabled: "enabled",
  disabled: "disabled"
}

/** 支持的定位方式，按抗改版能力从强到弱排列 */
export const LOCATORS = {
  role: "role",
  label: "label",
  placeholder: "placeholder",
  text: "text",
  textExact: "textExact",
  testId: "testId",
  css: "css"
}

export function createEmptyFlow(name = "未命名流程") {
  return {
    name,
    description: "",
    config: {
      baseUrl: "",
      variables: {},
      timeout: 30000,
      viewport: { width: 1280, height: 720 }
    },
    steps: []
  }
}

/**
 * 校验流程定义，返回问题列表。空数组表示合法。
 * 这里只做结构校验，不做语义校验（目标是否存在留给执行阶段）。
 */
export function validateFlow(flow) {
  const problems = []
  if (!flow || typeof flow !== "object") return ["流程必须是对象"]
  if (!flow.name || typeof flow.name !== "string") problems.push("流程缺少 name")
  if (!Array.isArray(flow.steps)) {
    problems.push("流程缺少 steps 数组")
    return problems
  }
  if (flow.config?.baseUrl && typeof flow.config.baseUrl !== "string") {
    problems.push("config.baseUrl 必须是字符串")
  }
  const allowedActions = new Set(Object.values(ACTIONS))
  flow.steps.forEach((step, index) => {
    const prefix = `步骤 ${index + 1}`
    if (!step || typeof step !== "object") {
      problems.push(`${prefix} 不是对象`)
      return
    }
    if (!allowedActions.has(step.action)) {
      problems.push(`${prefix} 的 action "${step.action}" 不支持`)
    }
    if (step.assert && !Object.values(ASSERT_TYPES).includes(step.assert.type)) {
      problems.push(`${prefix} 的断言类型 "${step.assert.type}" 不支持`)
    }
    if (
      ["navigate", "click", "fill", "select", "hover", "press", "assert"].includes(
        step.action
      ) &&
      step.target === undefined
    ) {
      problems.push(`${prefix} 缺少 target`)
    }
  })
  return problems
}

/** 用 ${var} 语法替换字符串中的变量；非字符串原样返回 */
export function interpolate(value, variables) {
  if (typeof value !== "string") return value
  return value.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const trimmed = key.trim()
    return Object.prototype.hasOwnProperty.call(variables, trimmed)
      ? String(variables[trimmed])
      : match
  })
}

/** 深拷贝并替换流程中所有字符串字段的变量 */
export function resolveFlow(flow, extraVariables = {}) {
  const variables = { ...(flow.config?.variables || {}), ...extraVariables }
  const walk = value => {
    if (typeof value === "string") return interpolate(value, variables)
    if (Array.isArray(value)) return value.map(walk)
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]))
    }
    return value
  }
  return walk(flow)
}
