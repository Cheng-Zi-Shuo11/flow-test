/**
 * 报告生成：执行结果落盘为 JSON + HTML，便于人工回看和 CI 归档。
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function renderHtmlReport(report, flow, { llmWarning } = {}) {
  const rows = report.steps
    .map(
      (step, index) => `
      <tr class="${step.passed ? "pass" : "fail"}">
        <td>${index + 1}</td>
        <td>${escapeHtml(step.name)}</td>
        <td><code>${escapeHtml(step.action)}</code></td>
        <td>${step.passed ? "通过" : "失败"}</td>
        <td>${escapeHtml(step.detail)}</td>
        <td>${step.duration}ms</td>
      </tr>`
    )
    .join("")

  const passRate = report.steps.length
    ? Math.round((report.passedCount / report.steps.length) * 100)
    : 0

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(report.name)} - 测试报告</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #1f2937; background: #f9fafb; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .summary { display: flex; gap: 16px; margin-bottom: 24px; }
  .card { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 24px; min-width: 120px; }
  .card strong { display: block; font-size: 26px; margin-top: 4px; }
  .card.ok strong { color: #0f6e56; }
  .card.bad strong { color: #a32d2d; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 13px; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  tr.pass td:nth-child(4) { color: #0f6e56; }
  tr.fail td:nth-child(4) { color: #a32d2d; font-weight: 600; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
  .warning { background: #fef3c7; border: 1px solid #fcd34d; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 13px; }
  .shots { margin-top: 24px; font-size: 13px; color: #6b7280; }
</style></head><body>
<h1>${escapeHtml(report.name)}</h1>
<div class="meta">开始 ${escapeHtml(report.startedAt)} · 结束 ${escapeHtml(report.finishedAt)} · 地址 ${escapeHtml(flow?.config?.baseUrl || "-")}</div>
${llmWarning ? `<div class="warning">${escapeHtml(llmWarning)}</div>` : ""}
<div class="summary">
  <div class="card"><span>结果</span><strong class="${report.passed ? "ok" : "bad"}">${report.passed ? "通过" : "失败"}</strong></div>
  <div class="card"><span>通过率</span><strong>${passRate}%</strong></div>
  <div class="card"><span>步骤总数</span><strong>${report.steps.length}</strong></div>
  <div class="card"><span>失败步骤</span><strong class="${report.failedCount ? "bad" : "ok"}">${report.failedCount}</strong></div>
</div>
<table><thead><tr><th>#</th><th>步骤</th><th>动作</th><th>状态</th><th>详情</th><th>耗时</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="shots">截图位于本报告同目录下的 PNG 文件，按步骤序号命名。</div>
</body></html>`
}

export function writeReport(report, flow, reportDir, { llmWarning } = {}) {
  mkdirSync(reportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const jsonPath = join(reportDir, `${stamp}.json`)
  const htmlPath = join(reportDir, `${stamp}.html`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8")
  writeFileSync(htmlPath, renderHtmlReport(report, flow, { llmWarning }), "utf8")
  return { jsonPath, htmlPath }
}
