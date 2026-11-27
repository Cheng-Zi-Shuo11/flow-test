/**
 * 自然语言步骤 → 结构化动作。
 *
 * 两种模式：
 *  1. LLM 模式：配置好 apiKey/endpoint 后，用大模型解析，能理解任意表述。
 *  2. 规则模式（降级）：无 LLM 配置时用关键词规则解析，保证开箱即用。
 *
 * 两种模式都输出统一的步骤结构，执行层无需关心来源。
 */

const SYSTEM_PROMPT = `你是 Web 自动化测试步骤解析器。把用户的自然语言操作步骤转成 JSON 数组。

每个步骤格式：
{
  "name": "步骤简述",
  "action": "navigate|click|fill|select|hover|press|wait|screenshot|assert",
  "target": { "by": "role|label|placeholder|text|testId|css", "value": "..." },
  "value": "输入内容或断言期望值（可选）",
  "assert": { "type": "visible|textContains|urlContains|count|...", "value": "..." }
}

规则：
- 只输出 JSON 数组，不要解释文字。
- 打开/访问某个地址 → navigate，target 为 {by:"url", value:"地址"}。
- "点击 XX 按钮" → click，优先用 role:"button" + name 定位。
- "在 XX 输入框输入 YY" → fill，target 用 placeholder 或 label。
- "验证/确认/应该出现 XX" → assert，默认 type 为 visible 或 textContains。
- 无法确定的元素用 text 定位。
- 保留用户原文中的具体文字（按钮名、输入框名、期望文本）。

示例：
用户："打开首页，在搜索框输入 rain，点击搜索按钮，验证出现结果列表"
输出：[{"name":"打开首页","action":"navigate","target":{"by":"url","value":"/"}},{"name":"输入搜索词","action":"fill","target":{"by":"placeholder","value":"搜索"},"value":"rain"},{"name":"点击搜索","action":"click","target":{"by":"role","value":"button:搜索"}},{"name":"验证结果","action":"assert","target":{"by":"text","value":"结果列表"},"assert":{"type":"visible"}}]`

/** 调用 OpenAI 兼容接口解析；失败时抛错，由调用方决定是否降级 */
export async function parseWithLLM(text, llmConfig) {
  const { apiKey, endpoint = "https://api.openai.com/v1/chat/completions", model = "gpt-4o-mini" } = llmConfig || {}
  if (!apiKey) throw new Error("LLM apiKey 未配置")

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text }
      ]
    })
  })

  if (!response.ok) {
    throw new Error(`LLM 请求失败: ${response.status} ${await response.text()}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("LLM 返回为空")

  const jsonText = content.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim()
  return JSON.parse(jsonText)
}

/**
 * 规则降级解析：按行/序号拆分步骤，用关键词识别动作。
 * 支持中文逗号、分号、换行、"1. xxx" 等分隔方式。
 */
export function parseWithRules(text) {
  const lines = String(text || "")
    .split(/\r?\n|[；;]/)
    .map(line => line.replace(/^\s*\d+[.、)]\s*/, "").trim())
    .filter(Boolean)

  return lines.map((line, index) => {
    const name = line.slice(0, 40)
    const step = { name, action: "assert", target: undefined }

    // 导航
    const navMatch = line.match(/(?:打开|访问|进入|跳转(?:到)?)\s*([^\s，,。]+)/)
    if (navMatch) {
      return {
        name,
        action: "navigate",
        target: { by: "url", value: normalizeUrl(navMatch[1]) }
      }
    }

    // 等待
    const waitMatch = line.match(/等待\s*(\d+(?:\.\d+)?)\s*(秒|ms|毫秒)?/)
    if (waitMatch) {
      const unit = waitMatch[2]
      const ms = unit === "秒" ? Number(waitMatch[1]) * 1000 : Number(waitMatch[1])
      return { name, action: "wait", value: ms }
    }

    // 截图
    if (/截图|截屏/.test(line)) {
      return { name, action: "screenshot", value: extractQuoted(line)?.[0] }
    }

    // 填充：在"XX"输入框输入"YY"
    const fillMatch = line.match(/(?:在|向)?\s*[「"']?([^「"'，,]{1,20})[」"']?\s*(?:输入框|文本框|字段|输入框中|输入框内).*?(?:输入|填写|填入)\s*[「"']?([^」"'，,。]+)/)
    if (fillMatch) {
      step.action = "fill"
      step.target = { by: "placeholder", value: fillMatch[1].trim() }
      step.value = fillMatch[2].trim().replace(/[「」"']/g, "")
      return step
    }
    const simpleFill = line.match(/(?:输入|填写|填入)\s*[「"']?([^」"']+?)[」"']?\s*(?:到|进)\s*[「"']?([^」"']+)/)
    if (simpleFill) {
      step.action = "fill"
      step.target = { by: "placeholder", value: simpleFill[2].trim().replace(/[「」"']/g, "") }
      step.value = simpleFill[1].trim().replace(/[「」"']/g, "")
      return step
    }

    // 点击
    const clickMatch = line.match(/(?:点击|单击|按下|选择)\s*(?:「|"|')?([^」"'，,。]+)/)
    if (clickMatch && !/按钮.*验证/.test(line)) {
      const targetText = clickMatch[1].trim().replace(/(?:按钮|链接|菜单|图标)$/, "")
      step.action = "click"
      step.target = { by: "role", value: `button:${targetText}` }
      return step
    }

    // 悬停
    const hoverMatch = line.match(/悬停(?:在)?\s*[「"']?([^」"'，,。]+)/)
    if (hoverMatch) {
      step.action = "hover"
      step.target = { by: "text", value: hoverMatch[1].trim() }
      return step
    }

    // 断言：验证/确认/应该/出现/断言
    const assertMatch = line.match(/(?:验证|确认|断言|检查|应该|期望|出现)\s*(?:页面(?:上)?(?:出现|显示|包含)?)?\s*[「"']?([^」"'，,。]+)/)
    if (assertMatch) {
      const expected = assertMatch[1].trim().replace(/[「」"']/g, "")
      step.action = "assert"
      step.target = { by: "text", value: expected }
      step.assert = /url|地址|链接/.test(line)
        ? { type: "urlContains", value: expected }
        : { type: "visible" }
      return step
    }

    // 兜底：当作文本断言，保留原始描述
    step.name = `${index + 1}. ${name}`
    step.target = { by: "text", value: name }
    step.assert = { type: "visible" }
    return step
  })
}

function extractQuoted(text) {
  return [...text.matchAll(/[「"']([^」"']+)[」"']/g)].map(m => m[1])
}

function normalizeUrl(value) {
  const cleaned = value.replace(/[「」"']/g, "")
  if (/^(https?:)?\/\//.test(cleaned) || cleaned === "/") return cleaned
  return cleaned
}

/**
 * 统一解析入口。优先 LLM，失败自动降级到规则。
 * @returns {{ steps: Array, engine: 'llm'|'rules', warning?: string }}
 */
export async function parseSteps(text, llmConfig, { preferRules = false } = {}) {
  if (!preferRules && llmConfig?.apiKey) {
    try {
      const steps = await parseWithLLM(text, llmConfig)
      if (Array.isArray(steps)) return { steps, engine: "llm" }
      throw new Error("LLM 未返回数组")
    } catch (error) {
      return {
        steps: parseWithRules(text),
        engine: "rules",
        warning: `LLM 解析失败，已降级为规则解析: ${error.message}`
      }
    }
  }
  return { steps: parseWithRules(text), engine: "rules" }
}
