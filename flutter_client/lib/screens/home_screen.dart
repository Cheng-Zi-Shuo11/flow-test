// Flutter 自带 Flow 组件与本项目 Flow 模型重名，隐藏内置的以免歧义
import 'package:flutter/material.dart' hide Flow;

import '../models/flow.dart';
import '../models/report.dart';
import '../services/api_service.dart';
import '../widgets/flow_editor_card.dart';
import '../widgets/step_result_tile.dart';
import 'report_viewer_screen.dart';

/// 应用主页面：左侧流程编排，右侧执行结果与历史报告。
class HomeScreen extends StatefulWidget {
  final ApiService api;
  final bool engineRunning;
  final String engineBaseUrl;

  const HomeScreen({
    super.key,
    required this.api,
    required this.engineRunning,
    required this.engineBaseUrl,
  });

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  EngineConfigStatus? _config;
  List<ReportSummary> _reports = <ReportSummary>[];
  TestReport? _report;
  bool _isRunning = false;
  bool _isLoadingReports = false;

  @override
  void initState() {
    super.initState();
    _loadConfig();
    _loadReports();
  }

  void _showSnack(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? const Color(0xFFA32D2D) : null,
          duration: const Duration(seconds: 3),
        ),
      );
  }

  /// 加载 LLM 配置状态，用于 AppBar 徽章。
  Future<void> _loadConfig() async {
    try {
      final config = await widget.api.getConfig();
      if (mounted) setState(() => _config = config);
    } catch (e) {
      _showSnack('配置检测失败: $e', error: true);
    }
  }

  /// 加载历史报告列表。
  Future<void> _loadReports() async {
    setState(() => _isLoadingReports = true);
    try {
      final reports = await widget.api.listReports();
      if (mounted) setState(() => _reports = reports);
    } catch (e) {
      _showSnack('加载报告列表失败: $e', error: true);
    } finally {
      if (mounted) setState(() => _isLoadingReports = false);
    }
  }

  /// 执行流程并展示报告。
  Future<void> _runFlow(Flow flow, String? channel) async {
    setState(() => _isRunning = true);
    try {
      final report = await widget.api.runFlow(
        flow,
        channel: channel,
        variables: flow.config.variables,
      );
      if (!mounted) return;
      setState(() => _report = report);
      await _loadReports();
      _showSnack('报告已生成');
    } catch (e) {
      if (!mounted) return;
      setState(() => _report = null);
      _showSnack('执行失败: $e', error: true);
    } finally {
      if (mounted) setState(() => _isRunning = false);
    }
  }

  /// 打开报告详情页；若是刚运行的报告则带上完整步骤明细。
  void _openReport(ReportSummary summary) {
    final fullReport = _report != null && _report!.name == summary.name
        ? _report
        : null;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ReportViewerScreen(
          api: widget.api,
          summary: summary,
          report: fullReport,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF1F2937),
        elevation: 0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.bolt, color: Color(0xFF185FA5), size: 20),
            const SizedBox(width: 8),
            const Text(
              'FlowTest',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                'Web 自动化流程测试',
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                  color: Color(0xFF6B7280),
                ),
              ),
            ),
          ],
        ),
        actions: <Widget>[
          _buildStatusBadge(
            _llmStatusText(),
            _config?.llmConfigured ?? false,
            tooltip: _config?.endpoint ?? '',
          ),
          const SizedBox(width: 8),
          _buildStatusBadge(
            widget.engineRunning ? '引擎运行中' : '引擎未运行',
            widget.engineRunning,
            tooltip: widget.engineBaseUrl,
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final wide = constraints.maxWidth >= 1000;
          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: wide
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(child: _buildEditorCard()),
                      const SizedBox(width: 20),
                      Expanded(child: _buildResultCard()),
                    ],
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      _buildEditorCard(),
                      const SizedBox(height: 20),
                      _buildResultCard(),
                    ],
                  ),
          );
        },
      ),
    );
  }

  String _llmStatusText() {
    final config = _config;
    if (config == null) return '配置检测中';
    if (config.llmConfigured) {
      return config.model.isEmpty ? 'AI 解析已启用' : 'AI 已启用 (${config.model})';
    }
    return 'AI 未配置，规则解析';
  }

  Widget _buildStatusBadge(String text, bool positive, {String tooltip = ''}) {
    final background = positive
        ? const Color(0xFFE1F5EE)
        : const Color(0xFFF3F4F6);
    final foreground = positive
        ? const Color(0xFF0F6E56)
        : const Color(0xFF6B7280);
    return Tooltip(
      message: tooltip,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 12,
            color: foreground,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }

  Widget _buildEditorCard() {
    return FlowEditorCard(
      api: widget.api,
      isRunning: _isRunning,
      onRun: _runFlow,
      onNew: () => setState(() => _report = null),
      onSaved: _loadReports,
    );
  }

  Widget _buildResultCard() {
    return Card(
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
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text(
              '执行结果',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1F2937),
              ),
            ),
            const SizedBox(height: 16),
            _buildSummary(),
            const SizedBox(height: 20),
            const Divider(height: 1, color: Color(0xFFE5E7EB)),
            const SizedBox(height: 16),
            const Text(
              '步骤结果',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Color(0xFF4B5563),
              ),
            ),
            const SizedBox(height: 8),
            _buildSteps(),
            const SizedBox(height: 20),
            const Divider(height: 1, color: Color(0xFFE5E7EB)),
            const SizedBox(height: 16),
            Row(
              children: <Widget>[
                const Text(
                  '历史报告',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Color(0xFF4B5563),
                  ),
                ),
                const Spacer(),
                IconButton(
                  tooltip: '刷新报告列表',
                  icon: _isLoadingReports
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 18),
                  onPressed: _isLoadingReports ? null : _loadReports,
                ),
              ],
            ),
            const SizedBox(height: 4),
            _buildReports(),
          ],
        ),
      ),
    );
  }

  /// 运行摘要：通过/失败、通过数/总数、耗时。
  Widget _buildSummary() {
    if (_isRunning) {
      return Container(
        padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 12),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color(0xFFF9FAFB),
          border: Border.all(color: const Color(0xFFD1D5DB)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Column(
          children: <Widget>[
            CircularProgressIndicator(
              valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF185FA5)),
            ),
            SizedBox(height: 12),
            Text(
              '流程正在执行，请稍候…',
              style: TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
            ),
          ],
        ),
      );
    }

    final report = _report;
    if (report == null) {
      return Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: const Text(
          '尚未运行',
          style: TextStyle(fontSize: 13, color: Color(0xFF9CA3AF)),
        ),
      );
    }

    final statusColor = report.passed
        ? const Color(0xFF0F6E56)
        : const Color(0xFFA32D2D);
    final background = report.passed
        ? const Color(0xFFE1F5EE)
        : const Color(0xFFFBE7E7);
    final durationMs =
        report.steps.fold<int>(0, (sum, step) => sum + step.duration);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: background,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                report.passed ? '通过' : '失败',
                style: TextStyle(
                  color: statusColor,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Text(
              '${report.passedCount}/${report.total} 步通过',
              style: const TextStyle(
                fontSize: 13,
                color: Color(0xFF1F2937),
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 12),
            Text(
              '耗时 ${durationMs}ms',
              style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
            ),
          ],
        ),
        if (report.startedAt.isNotEmpty || report.finishedAt.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            '开始 ${report.startedAt} · 结束 ${report.finishedAt}',
            style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)),
          ),
        ],
      ],
    );
  }

  /// 步骤结果列表。
  Widget _buildSteps() {
    if (_isRunning) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text(
          '步骤结果将在执行完成后显示',
          style: TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
        ),
      );
    }
    final report = _report;
    if (report == null || report.steps.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text(
          '运行后在此显示每步结果',
          style: TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
        ),
      );
    }
    return Column(
      children: <Widget>[
        for (var i = 0; i < report.steps.length; i++)
          StepResultTile(index: i, result: report.steps[i]),
      ],
    );
  }

  /// 历史报告列表，点击进入报告详情页。
  Widget _buildReports() {
    if (_reports.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text(
          '暂无报告',
          style: TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
        ),
      );
    }
    return Column(
      children: <Widget>[
        for (final item in _reports)
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              item.passed ? Icons.check_circle : Icons.cancel,
              color: item.passed
                  ? const Color(0xFF0F6E56)
                  : const Color(0xFFA32D2D),
              size: 18,
            ),
            title: Text(
              item.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, color: Color(0xFF1F2937)),
            ),
            subtitle: Text(
              '${item.passedCount}/${item.passedCount + item.failedCount} · '
              '${item.startedAt.length >= 19 ? item.startedAt.substring(0, 19) : item.startedAt}',
              style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)),
            ),
            trailing: const Icon(Icons.chevron_right, size: 18),
            onTap: () => _openReport(item),
          ),
      ],
    );
  }
}
