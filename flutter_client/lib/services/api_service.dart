import 'dart:convert';
import 'dart:io';

import '../models/flow.dart';
import '../models/report.dart';

/// 服务端返回的非 2xx 错误。
class ApiException implements Exception {
  final String message;

  ApiException(this.message);

  @override
  String toString() => message;
}

/// 基于 dart:io HttpClient 的 FlowTest HTTP API 客户端，无需额外第三方包。
class ApiService {
  final String baseUrl;

  ApiService({String baseUrl = 'http://127.0.0.1:3777'})
      : baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), '');

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  /// 统一发起请求并返回响应文本；非 2xx 时取响应 JSON 的 error 字段抛出 ApiException。
  Future<String> _request(String method, String path, {Object? body}) async {
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, _uri(path));
      if (body != null) {
        final bytes = utf8.encode(jsonEncode(body));
        request.headers.set(HttpHeaders.contentTypeHeader, 'application/json; charset=utf-8');
        request.headers.set(HttpHeaders.contentLengthHeader, bytes.length);
        request.add(bytes);
      }
      final response = await request.close();
      final text = await utf8.decoder.bind(response).join();

      if (response.statusCode < 200 || response.statusCode >= 300) {
        var message = 'HTTP ${response.statusCode}';
        try {
          final decoded = jsonDecode(text);
          if (decoded is Map && decoded['error'] != null) {
            message = decoded['error'].toString();
          }
        } catch (_) {
          // 响应不是合法 JSON 时保留 HTTP 状态码作为错误信息。
        }
        throw ApiException(message);
      }
      return text;
    } on ApiException {
      rethrow;
    } on SocketException catch (e) {
      throw ApiException('无法连接到服务器: ${e.message}');
    } finally {
      client.close(force: true);
    }
  }

  /// GET /api/config —— 引擎（LLM）配置状态。
  Future<EngineConfigStatus> getConfig() async {
    final text = await _request('GET', '/api/config');
    return EngineConfigStatus.fromJson(jsonDecode(text) as Map<String, dynamic>);
  }

  /// GET /api/flows —— 流程列表概要。
  Future<List<FlowInfo>> listFlows() async {
    final text = await _request('GET', '/api/flows');
    final data = jsonDecode(text) as Map<String, dynamic>;
    final rawFlows = data['flows'] as List<dynamic>? ?? <dynamic>[];
    return rawFlows
        .map((item) => FlowInfo.fromJson(Map<String, dynamic>.from(item as Map)))
        .toList();
  }

  /// GET /api/flows/<file> —— 读取单个流程定义。
  Future<Flow> loadFlow(String file) async {
    final text = await _request('GET', '/api/flows/${Uri.encodeComponent(file)}');
    return Flow.fromJson(jsonDecode(text) as Map<String, dynamic>);
  }

  /// POST /api/flows —— 保存流程，返回服务端分配的文件名。
  Future<String> saveFlow(String? file, Flow flow) async {
    final body = <String, dynamic>{'flow': flow.toJson()};
    if (file != null) body['file'] = file;
    final text = await _request('POST', '/api/flows', body: body);
    final data = jsonDecode(text) as Map<String, dynamic>;
    return data['file'] as String;
  }

  /// POST /api/parse —— 自然语言解析为步骤，返回 {steps, engine, warning}。
  Future<Map<String, dynamic>> parseSteps(String text, {bool useRules = false}) async {
    final result = await _request(
      'POST',
      '/api/parse',
      body: <String, dynamic>{'text': text, 'useRules': useRules},
    );
    return jsonDecode(result) as Map<String, dynamic>;
  }

  /// POST /api/run —— 执行流程，返回报告（响应中的 htmlPath 由报告详情页使用）。
  Future<TestReport> runFlow(
    Flow flow, {
    String? channel,
    Map<String, dynamic>? variables,
    bool stopOnFailure = false,
  }) async {
    final body = <String, dynamic>{
      'flow': flow.toJson(),
      'variables': variables ?? <String, dynamic>{},
      'stopOnFailure': stopOnFailure,
    };
    if (channel != null) body['channel'] = channel;
    final text = await _request('POST', '/api/run', body: body);
    final data = jsonDecode(text) as Map<String, dynamic>;
    return TestReport.fromJson(data['report'] as Map<String, dynamic>);
  }

  /// GET /api/reports —— 最近报告列表。
  Future<List<ReportSummary>> listReports() async {
    final text = await _request('GET', '/api/reports');
    final data = jsonDecode(text) as Map<String, dynamic>;
    final rawReports = data['reports'] as List<dynamic>? ?? <dynamic>[];
    return rawReports
        .map((item) => ReportSummary.fromJson(Map<String, dynamic>.from(item as Map)))
        .toList();
  }

  /// 报告详情页地址，供 WebView 或外部浏览器打开。
  Uri reportUri(String id) => _uri('/api/reports/${Uri.encodeComponent(id)}');
}
