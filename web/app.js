const $ = id => document.getElementById(id)
let currentFile = null

function toast(message) {
  const el = $("toast")
  el.textContent = message
  el.classList.add("show")
  setTimeout(() => el.classList.remove("show"), 2500)
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`)
  return data
}

async function loadConfig() {
  try {
    const config = await api("/api/config")
    $("llmStatus").textContent = config.llmConfigured
      ? `AI 解析已启用 (${config.model})`
      : "AI 未配置，使用规则解析"
  } catch (error) {
    $("llmStatus").textContent = "配置检测失败"
    toast(`配置检测失败: ${error.message}`)
  }
}

async function loadReports() {
  try {
    const { reports } = await api("/api/reports")
    $("reportList").innerHTML = reports.length
      ? reports.map(r => `<a href="/api/reports/${r.id}" target="_blank">${r.passed ? "✓" : "✗"} ${escapeHtml(r.name)} · ${r.passedCount}/${r.passedCount + r.failedCount} · ${r.startedAt.slice(0, 19)}</a>`).join("")
      : "暂无报告"
  } catch (error) {
    $("reportList").textContent = error.message
    toast(`加载报告列表失败: ${error.message}`)
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

async function loadFlows(selectedFile = currentFile) {
  try {
    const { flows } = await api("/api/flows")
    const select = $("savedFlow")
    select.innerHTML = `<option value="">-- 选择已保存流程 --</option>` +
      flows.map(f => `<option value="${escapeHtml(f.file)}">${escapeHtml(f.name)} · ${f.steps} 步</option>`).join("")
    select.value = selectedFile && flows.some(f => f.file === selectedFile) ? selectedFile : ""
  } catch (error) {
    toast(`加载流程列表失败: ${error.message}`)
  }
}

async function loadFlow(file) {
  if (!file) return
  try {
    const flow = await api(`/api/flows/${file}`)
    const sourceText = flow.sourceText || ""
    $("flowName").value = flow.name || "未命名流程"
    $("baseUrl").value = flow.config?.baseUrl || ""
    $("stepsText").value = sourceText
    $("structuredJson").value = JSON.stringify(flow.steps || [], null, 2)
    $("structuredBox").open = true
    $("variables").value = JSON.stringify(flow.config?.variables || {}, null, 2)
    $("parseInfo").textContent = ""
    $("resultTable").innerHTML = ""
    $("runSummary").textContent = "尚未运行"
    currentFile = file
    toast(sourceText
      ? `已载入流程: ${flow.name || file}`
      : "已加载结构化步骤（该流程未保存自然语言原文）")
  } catch (error) {
    toast(`加载流程失败: ${error.message}`)
  }
}

function buildFlow() {
  let steps
  try {
    steps = JSON.parse($("structuredJson").value || "[]")
    if (!Array.isArray(steps)) throw new Error("步骤必须是数组")
  } catch (error) {
    toast(`步骤 JSON 无效: ${error.message}`)
    throw error
  }
  let variables
  try {
    variables = JSON.parse($("variables").value || "{}")
  } catch {
    variables = {}
  }
  return {
    name: $("flowName").value || "未命名流程",
    description: "",
    sourceText: $("stepsText").value,
    config: { baseUrl: $("baseUrl").value, variables, timeout: 30000, viewport: { width: 1280, height: 720 } },
    steps
  }
}

function renderSteps(steps) {
  $("structuredJson").value = JSON.stringify(steps, null, 2)
  $("structuredBox").open = true
}

function renderResult(report) {
  const rows = report.steps.map((step, i) => `
    <tr class="${step.passed ? "pass" : "fail"}">
      <td>${i + 1}</td><td>${escapeHtml(step.name)}</td><td>${escapeHtml(step.action)}</td>
      <td>${step.passed ? "通过" : "失败"}</td><td>${escapeHtml(step.detail)}</td><td>${step.duration}ms</td>
    </tr>`).join("")
  $("resultTable").innerHTML = `<table><thead><tr><th>#</th><th>步骤</th><th>动作</th><th>状态</th><th>详情</th><th>耗时</th></tr></thead><tbody>${rows}</tbody></table>`
  $("runSummary").textContent = `${report.passed ? "通过" : "失败"} · ${report.passedCount}/${report.steps.length}`
}

$("savedFlow").onchange = event => loadFlow(event.target.value)

$("btnParse").onclick = async () => {
  try {
    const result = await api("/api/parse", {
      method: "POST",
      body: JSON.stringify({ text: $("stepsText").value, useRules: $("useRules").checked })
    })
    renderSteps(result.steps)
    $("parseInfo").textContent = `解析引擎: ${result.engine}`
    if (result.warning) toast(result.warning)
  } catch (error) {
    toast(error.message)
  }
}

$("btnSave").onclick = async () => {
  try {
    const flow = buildFlow()
    const data = await api("/api/flows", {
      method: "POST",
      body: JSON.stringify({ file: currentFile, flow })
    })
    currentFile = data.file
    toast(`已保存: ${data.file}`)
    await loadFlows(data.file)
    loadReports()
  } catch (error) {
    toast(error.message)
  }
}

$("btnNew").onclick = () => {
  currentFile = null
  $("savedFlow").value = ""
  $("flowName").value = "未命名流程"
  $("baseUrl").value = ""
  $("stepsText").value = ""
  $("structuredJson").value = "[]"
  $("variables").value = "{}"
  $("structuredBox").open = false
  $("resultTable").innerHTML = ""
  $("runSummary").textContent = "尚未运行"
  $("parseInfo").textContent = ""
}

$("btnRun").onclick = async () => {
  let flow
  try {
    flow = buildFlow()
  } catch { return }
  if (!flow.steps.length) {
    toast("请先解析或填写步骤")
    return
  }
  $("btnRun").disabled = true
  $("btnRun").textContent = "执行中..."
  $("runSummary").textContent = "执行中..."
  $("resultTable").innerHTML = `<div class="running">流程正在执行，请稍候…</div>`
  try {
    const data = await api("/api/run", {
      method: "POST",
      body: JSON.stringify({
        flow,
        variables: flow.config.variables,
        channel: $("browserChannel").value || undefined
      })
    })
    renderResult(data.report)
    toast(`报告已生成: ${data.htmlPath}`)
    loadReports()
  } catch (error) {
    $("runSummary").textContent = "执行失败"
    $("resultTable").innerHTML = ""
    toast(`执行失败: ${error.message}`)
  } finally {
    $("btnRun").disabled = false
    $("btnRun").textContent = "运行测试"
  }
}

loadConfig()
loadReports()
loadFlows()
