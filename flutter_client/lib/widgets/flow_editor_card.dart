import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/flow.dart';
import '../services/api_service.dart';

/// 左侧「流程编排」表单卡片。
///
/// 负责已保存流程的加载、自然语言解析、JSON 编辑与保存；
/// 运行与新建通过回调交给父页面处理。
class FlowEditorCard extends StatefulWidget {
  final ApiService api;

  /// 点击「运行测试」时回调，携带构造好的流程与浏览器通道。
  final void Function(Flow flow, String? channel) onRun;

  /// 点击「新建」时回调，父页面可清空执行结果区。
  final VoidCallback onNew;

  /// 保存成功后回调，父页面可刷新历史报告列表。
  final VoidCallback onSaved;

  /// 父页面正在执行流程，此时禁用表单按钮。
  final bool isRunning;

  const FlowEditorCard({
    super.key,
    required this.api,
    required this.onRun,
    required this.onNew,
    required this.onSaved,
    this.isRunning = false,
  });

  @override
  State<FlowEditorCard> createState() => _FlowEditorCardState();
}

class _FlowEditorCardState extends State<FlowEditorCard> {
  final TextEditingController _nameController =
      TextEditingController(text: '未命名流程');
  final TextEditingController _baseUrlController = TextEditingController();
  final TextEditingController _stepsController = TextEditingController();
  final TextEditingController _structuredController =
      TextEditingController(text: '[]');
  final TextEditingController _variablesController =
      TextEditingController(text: '{}');

  List<FlowInfo> _flows = <FlowInfo>[];
  String? _currentFile;
  String _channel = 'chrome'; // 与 Web 版默认一致：系统 Chrome
  bool _useRules = false;
  bool _isParsing = false;
  bool _isSaving = false;
  String _parseInfo = '';

  static const Map<String, String> _channels = <String, String>{
    '': 'Playwright Chromium（需先下载）',
    'chrome': '系统 Chrome（本机已装）',
    'msedge': '系统 Edge',
  };

  @override
  void initState() {
    super.initState();
    _loadFlows();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _baseUrlController.dispose();
    _stepsController.dispose();
    _structuredController.dispose();
    _variablesController.dispose();
    super.dispose();
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

  /// 加载已保存流程列表。
  Future<void> _loadFlows() async {
    try {
      final flows = await widget.api.listFlows();
      if (!mounted) return;
      setState(() {
        _flows = flows;
        // 当前文件已不存在时回到占位项，避免下拉框选中无效值。
        if (_currentFile != null &&
            _currentFile!.isNotEmpty &&
            !flows.any((item) => item.file == _currentFile)) {
          _currentFile = null;
        }
      });
    } catch (e) {
      _showSnack('加载流程列表失败: $e', error: true);
    }
  }

  /// 载入某个已保存流程，回填全部表单字段。
  Future<void> _loadFlow(String? file) async {
    if (file == null || file.isEmpty) return;
    try {
      final flow = await widget.api.loadFlow(file);
      if (!mounted) return;
      final pretty = const JsonEncoder.withIndent('  ');
      setState(() {
        _currentFile = file;
        _nameController.text =
            flow.name.isNotEmpty ? flow.name : '未命名流程';
        _baseUrlController.text = flow.config.baseUrl;
        _stepsController.text = flow.sourceText ?? '';
        _structuredController.text =
            pretty.convert(flow.steps.map((step) => step.toJson()).toList());
        _variablesController.text = pretty.convert(flow.config.variables);
        _parseInfo = '';
      });
      _showSnack('已载入流程: ${flow.name.isNotEmpty ? flow.name : file}');
    } catch (e) {
      _showSnack('加载流程失败: $e', error: true);
    }
  }

  /// 新建：重置为初始状态。
  void _newFlow() {
    setState(() {
      _currentFile = null;
      _nameController.text = '未命名流程';
      _baseUrlController.clear();
      _stepsController.clear();
      _structuredController.text = '[]';
      _variablesController.text = '{}';
      _parseInfo = '';
    });
    widget.onNew();
  }

  /// 自然语言解析为结构化步骤。
  Future<void> _parse() async {
    if (_stepsController.text.trim().isEmpty) {
      _showSnack('请先填写操作步骤', error: true);
      return;
    }
    setState(() => _isParsing = true);
    try {
      final result = await widget.api.parseSteps(
        _stepsController.text,
        useRules: _useRules,
      );
      final rawSteps = result['steps'];
      if (rawSteps is! List) {
        throw const FormatException('解析结果中缺少步骤数组');
      }
      if (!mounted) return;
      setState(() {
        _structuredController.text =
            const JsonEncoder.withIndent('  ').convert(rawSteps);
        final engine = result['engine'];
        _parseInfo = engine == null || engine.toString().isEmpty
            ? '解析完成'
            : '解析引擎: $engine';
      });
      final warning = result['warning'];
      if (warning != null && warning.toString().isNotEmpty) {
        _showSnack(warning.toString());
      }
    } catch (e) {
      _showSnack('解析失败: $e', error: true);
    } finally {
      if (mounted) setState(() => _isParsing = false);
    }
  }

  /// 由表单内容构造 Flow，JSON 非法时提示并返回 null。
  Flow? _buildFlow() {
    final rawStructured = _structuredController.text.trim();
    late final List<dynamic> decodedSteps;
    try {
      final decoded = jsonDecode(rawStructured.isEmpty ? '[]' : rawStructured);
      if (decoded is! List) {
        throw const FormatException('步骤必须是数组');
      }
      decodedSteps = decoded;
    } catch (e) {
      _showSnack('步骤 JSON 无效: $e', error: true);
      return null;
    }

    final steps = <FlowStep>[];
    for (final item in decodedSteps) {
      if (item is! Map) {
        _showSnack('步骤 JSON 无效: 每一项必须是对象', error: true);
        return null;
      }
      steps.add(FlowStep.fromJson(Map<String, dynamic>.from(item)));
    }

    Map<String, dynamic> variables = <String, dynamic>{};
    final rawVariables = _variablesController.text.trim();
    if (rawVariables.isNotEmpty) {
      try {
        final decoded = jsonDecode(rawVariables);
        if (decoded is Map) {
          variables = Map<String, dynamic>.from(decoded);
        }
      } catch (_) {
        // 与 Web 版一致：变量 JSON 非法时按空对象处理。
        variables = <String, dynamic>{};
      }
    }

    final name = _nameController.text.trim();
    return Flow(
      name: name.isEmpty ? '未命名流程' : name,
      description: '',
      config: FlowConfig(
        baseUrl: _baseUrlController.text.trim(),
        variables: variables,
        timeout: 30000,
        viewport: <String, int>{'width': 1280, 'height': 720},
      ),
      steps: steps,
      sourceText: _stepsController.text,
    );
  }

  /// 保存流程到服务端。
  Future<void> _save() async {
    final flow = _buildFlow();
    if (flow == null) return;
    setState(() => _isSaving = true);
    try {
      final file = await widget.api.saveFlow(_currentFile, flow);
      if (!mounted) return;
      setState(() => _currentFile = file);
      await _loadFlows();
      _showSnack('已保存: $file');
      widget.onSaved();
    } catch (e) {
      _showSnack('保存失败: $e', error: true);
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  /// 运行测试：校验步骤后把 Flow 交给父页面执行。
  void _run() {
    final flow = _buildFlow();
    if (flow == null) return;
    if (flow.steps.isEmpty) {
      _showSnack('请先解析或填写步骤', error: true);
      return;
    }
    widget.onRun(flow, _channel.isEmpty ? null : _channel);
  }

  @override
  Widget build(BuildContext context) {
    final disabled = widget.isRunning;
    final flowValue = _currentFile != null &&
            _currentFile!.isNotEmpty &&
            _flows.any((item) => item.file == _currentFile)
        ? _currentFile
        : '';

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
              '流程编排',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1F2937),
              ),
            ),
            const SizedBox(height: 16),

            // 已保存流程下拉框
            Row(
              children: <Widget>[
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: flowValue,
                    decoration: const InputDecoration(
                      labelText: '已保存流程',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding:
                          EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                    items: <DropdownMenuItem<String>>[
                      const DropdownMenuItem<String>(
                        value: '',
                        child: Text('-- 选择已保存流程 --'),
                      ),
                      ..._flows.map(
                        (item) => DropdownMenuItem<String>(
                          value: item.file,
                          child: Text('${item.name} · ${item.steps} 步'),
                        ),
                      ),
                    ],
                    onChanged: disabled
                        ? null
                        : (value) {
                            // 选择占位项时清空当前文件，避免下拉框回弹到旧值。
                            if (value == null || value.isEmpty) {
                              setState(() => _currentFile = null);
                              return;
                            }
                            _loadFlow(value);
                          },
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  tooltip: '刷新流程列表',
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: disabled ? null : _loadFlows,
                ),
              ],
            ),
            const SizedBox(height: 12),

            // 流程名称
            TextField(
              controller: _nameController,
              enabled: !disabled,
              decoration: const InputDecoration(
                labelText: '流程名称',
                border: OutlineInputBorder(),
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            ),
            const SizedBox(height: 12),

            // 被测地址 baseUrl
            TextField(
              controller: _baseUrlController,
              enabled: !disabled,
              decoration: const InputDecoration(
                labelText: '被测地址 (baseUrl)',
                hintText: 'http://127.0.0.1:3000',
                border: OutlineInputBorder(),
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            ),
            const SizedBox(height: 18),

            const Text(
              '操作步骤（自然语言）',
              style: TextStyle(
                fontSize: 13,
                color: Color(0xFF4B5563),
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _stepsController,
              enabled: !disabled,
              maxLines: 7,
              keyboardType: TextInputType.multiline,
              decoration: const InputDecoration(
                hintText: '打开 /login\n在用户名输入框输入 \${username}\n点击登录按钮\n验证页面出现 欢迎',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),

            // 解析按钮 + 强制规则解析
            const SizedBox(height: 10),
            Wrap(
              spacing: 12,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                ElevatedButton.icon(
                  onPressed: disabled || _isParsing ? null : _parse,
                  icon: _isParsing
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.auto_awesome_outlined, size: 16),
                  label: Text(_isParsing ? '解析中...' : '解析为结构化步骤'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFE6F1FB),
                    foregroundColor: const Color(0xFF0C447C),
                    elevation: 0,
                  ),
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Checkbox(
                      value: _useRules,
                      onChanged: disabled
                          ? null
                          : (value) =>
                              setState(() => _useRules = value ?? false),
                    ),
                    const Text(
                      '强制规则解析',
                      style: TextStyle(fontSize: 12, color: Color(0xFF4B5563)),
                    ),
                  ],
                ),
              ],
            ),
            if (_parseInfo.isNotEmpty) ...<Widget>[
              const SizedBox(height: 4),
              Text(
                _parseInfo,
                style: const TextStyle(fontSize: 12, color: Color(0xFF0F6E56)),
              ),
            ],
            const SizedBox(height: 16),

            const Text(
              '结构化步骤（JSON，可手动编辑）',
              style: TextStyle(
                fontSize: 13,
                color: Color(0xFF4B5563),
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _structuredController,
              enabled: !disabled,
              maxLines: 10,
              keyboardType: TextInputType.multiline,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
              ),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 16),

            const Text(
              '变量（JSON）',
              style: TextStyle(
                fontSize: 13,
                color: Color(0xFF4B5563),
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _variablesController,
              enabled: !disabled,
              maxLines: 3,
              keyboardType: TextInputType.multiline,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
              ),
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 16),

            // 浏览器下拉
            DropdownButtonFormField<String>(
              value: _channel,
              decoration: const InputDecoration(
                labelText: '浏览器',
                border: OutlineInputBorder(),
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
              items: _channels.entries
                  .map(
                    (entry) => DropdownMenuItem<String>(
                      value: entry.key,
                      child: Text(entry.value),
                    ),
                  )
                  .toList(),
              onChanged: disabled
                  ? null
                  : (value) => setState(() => _channel = value ?? ''),
            ),
            const SizedBox(height: 20),

            // 新建 / 保存 / 运行测试
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                OutlinedButton(
                  onPressed: disabled ? null : _newFlow,
                  child: const Text('新建'),
                ),
                OutlinedButton.icon(
                  onPressed: disabled || _isSaving ? null : _save,
                  icon: _isSaving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_outlined, size: 16),
                  label: Text(_isSaving ? '保存中...' : '保存'),
                ),
                ElevatedButton.icon(
                  onPressed: disabled ? null : _run,
                  icon: disabled
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.play_arrow, size: 16),
                  label: Text(disabled ? '执行中...' : '运行测试'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF185FA5),
                    foregroundColor: Colors.white,
                    elevation: 0,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
