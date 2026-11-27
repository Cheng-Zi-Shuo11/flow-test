/// 测试报告相关的数据模型，对应服务端 executor.js / reporter.js 的 JSON 结构。

/// 单个步骤的执行结果。
class StepResult {
  final String name;
  final String action;
  final bool passed;
  final String detail;
  final int duration;

  StepResult({
    required this.name,
    required this.action,
    required this.passed,
    required this.detail,
    required this.duration,
  });

  factory StepResult.fromJson(Map<String, dynamic> json) {
    return StepResult(
      name: (json['name'] as String?) ?? '',
      action: (json['action'] as String?) ?? '',
      passed: json['passed'] as bool? ?? false,
      detail: (json['detail'] as String?) ?? '',
      duration: (json['duration'] as num?)?.toInt() ?? 0,
    );
  }
}

/// 一次完整执行的报告，包含全部步骤结果与统计信息。
class TestReport {
  final String name;
  final bool passed;
  final List<StepResult> steps;
  final int passedCount;
  final int failedCount;
  final String startedAt;
  final String finishedAt;

  TestReport({
    required this.name,
    required this.passed,
    required this.steps,
    required this.passedCount,
    required this.failedCount,
    required this.startedAt,
    required this.finishedAt,
  });

  factory TestReport.fromJson(Map<String, dynamic> json) {
    final steps = <StepResult>[];
    final rawSteps = json['steps'];
    if (rawSteps is List) {
      for (final item in rawSteps) {
        if (item is Map) {
          steps.add(StepResult.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }

    return TestReport(
      name: (json['name'] as String?) ?? '',
      passed: json['passed'] as bool? ?? false,
      steps: steps,
      passedCount: (json['passedCount'] as num?)?.toInt() ?? 0,
      failedCount: (json['failedCount'] as num?)?.toInt() ?? 0,
      startedAt: (json['startedAt'] as String?) ?? '',
      finishedAt: (json['finishedAt'] as String?) ?? '',
    );
  }

  /// 步骤总数，由 steps 派生。
  int get total => steps.length;
}

/// 报告列表中的一项概要信息。
class ReportSummary {
  final String id;
  final String name;
  final bool passed;
  final int passedCount;
  final int failedCount;
  final String startedAt;

  ReportSummary({
    required this.id,
    required this.name,
    required this.passed,
    required this.passedCount,
    required this.failedCount,
    required this.startedAt,
  });

  factory ReportSummary.fromJson(Map<String, dynamic> json) {
    return ReportSummary(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      passed: json['passed'] as bool? ?? false,
      passedCount: (json['passedCount'] as num?)?.toInt() ?? 0,
      failedCount: (json['failedCount'] as num?)?.toInt() ?? 0,
      startedAt: (json['startedAt'] as String?) ?? '',
    );
  }
}

/// 服务端引擎配置状态，用于展示 LLM 是否可用。
class EngineConfigStatus {
  final bool llmConfigured;
  final String model;
  final String endpoint;

  EngineConfigStatus({
    required this.llmConfigured,
    required this.model,
    required this.endpoint,
  });

  factory EngineConfigStatus.fromJson(Map<String, dynamic> json) {
    return EngineConfigStatus(
      llmConfigured: json['llmConfigured'] as bool? ?? false,
      model: (json['model'] as String?) ?? '',
      endpoint: (json['endpoint'] as String?) ?? '',
    );
  }
}
