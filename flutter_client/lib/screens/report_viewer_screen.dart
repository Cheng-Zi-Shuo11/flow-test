import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/report.dart';
import '../services/api_service.dart';
import '../widgets/step_result_tile.dart';

/// 报告详情页。
///
/// 不引入 webview_flutter：直接在 Flutter 内展示报告摘要与步骤明细，
/// 需要查看服务端完整 HTML 报告时，通过 url_launcher 在外部浏览器打开。
class ReportViewerScreen extends StatefulWidget {
  final ApiService api;
  final ReportSummary summary;

  /// 运行完成后立即查看时传入的完整报告，用于展示步骤明细。
  final TestReport? report;

  const ReportViewerScreen({
    super.key,
    required this.api,
    required this.summary,
    this.report,
  });

  @override
  State<ReportViewerScreen> createState() => _ReportViewerScreenState();
}

class _ReportViewerScreenState extends State<ReportViewerScreen> {
  bool _isOpening = false;

  void _showSnack(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? const Color(0xFFA32D2D) : null,
        ),
      );
  }

  /// 在外部浏览器打开服务端生成的 HTML 报告。
  Future<void> _openInBrowser() async {
    final uri = widget.api.reportUri(widget.summary.id);
    setState(() => _isOpening = true);
    try {
      final opened = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        _showSnack('无法打开浏览器，请检查系统默认浏览器设置', error: true);
      }
    } catch (e) {
      _showSnack('打开报告失败: $e', error: true);
    } finally {
      if (mounted) setState(() => _isOpening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final summary = widget.summary;
    final report = widget.report;
    final statusColor = summary.passed
        ? const Color(0xFF0F6E56)
        : const Color(0xFFA32D2D);
    final statusBackground = summary.passed
        ? const Color(0xFFE1F5EE)
        : const Color(0xFFFBE7E7);
    final total = report?.total ?? summary.passedCount + summary.failedCount;

    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        title: const Text('报告详情'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF1F2937),
        elevation: 0,
        actions: <Widget>[
          IconButton(
            tooltip: '在浏览器打开',
            icon: const Icon(Icons.open_in_browser),
            onPressed: _isOpening ? null : _openInBrowser,
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            // 摘要卡片
            Card(
              elevation: 0,
              color: Colors.white,
              surfaceTintColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: const BorderSide(color: Color(0xFFE5E7EB)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            summary.name.isNotEmpty ? summary.name : '未命名报告',
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF1F2937),
                            ),
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: statusBackground,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            summary.passed ? '通过' : '失败',
                            style: TextStyle(
                              color: statusColor,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 24,
                      runSpacing: 12,
                      children: <Widget>[
                        _summaryItem('通过步骤', '${summary.passedCount}'),
                        _summaryItem('失败步骤', '${summary.failedCount}'),
                        _summaryItem('步骤总数', '$total'),
                        _summaryItem(
                          '开始时间',
                          summary.startedAt.isEmpty
                              ? '-'
                              : summary.startedAt.length >= 19
                                  ? summary.startedAt.substring(0, 19)
                                  : summary.startedAt,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),

            const Text(
              '步骤明细',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1F2937),
              ),
            ),
            const SizedBox(height: 8),

            if (report != null && report.steps.isNotEmpty)
              Card(
                elevation: 0,
                color: Colors.white,
                surfaceTintColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: Color(0xFFE5E7EB)),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  child: Column(
                    children: <Widget>[
                      for (var i = 0; i < report.steps.length; i++)
                        StepResultTile(index: i, result: report.steps[i]),
                    ],
                  ),
                ),
              )
            else
              Container(
                padding: const EdgeInsets.all(28),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFF9FAFB),
                  border: Border.all(color: const Color(0xFFE5E7EB)),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  '该历史报告的逐步明细请在浏览器中查看',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
                ),
              ),
            const SizedBox(height: 20),

            ElevatedButton.icon(
              onPressed: _isOpening ? null : _openInBrowser,
              icon: _isOpening
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.open_in_new, size: 16),
              label: const Text('在浏览器打开'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF185FA5),
                foregroundColor: Colors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _summaryItem(String label, String value) {
    return SizedBox(
      width: 130,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Color(0xFF1F2937),
            ),
          ),
        ],
      ),
    );
  }
}
