// 流程相关的数据模型，对应服务端 flow.js 中的 JSON 结构。

/// 流程配置：被测地址、变量、超时与浏览器视口尺寸。
class FlowConfig {
  final String baseUrl;
  final Map<String, dynamic> variables;
  final int timeout;
  final Map<String, int> viewport;

  FlowConfig({
    required this.baseUrl,
    required this.variables,
    required this.timeout,
    required this.viewport,
  });

  /// 从服务端 JSON 解析配置，缺字段时给出安全默认值。
  factory FlowConfig.fromJson(Map<String, dynamic> json) {
    final rawVariables = json['variables'];
    final variables = rawVariables is Map
        ? Map<String, dynamic>.from(rawVariables)
        : <String, dynamic>{};

    final rawViewport = json['viewport'];
    final viewport = <String, int>{};
    if (rawViewport is Map) {
      rawViewport.forEach((key, value) {
        if (value is num) viewport[key.toString()] = value.toInt();
      });
    }

    return FlowConfig(
      baseUrl: (json['baseUrl'] as String?) ?? '',
      variables: variables,
      timeout: (json['timeout'] as num?)?.toInt() ?? 30000,
      viewport: viewport,
    );
  }

  Map<String, dynamic> toJson() => {
        'baseUrl': baseUrl,
        'variables': variables,
        'timeout': timeout,
        'viewport': viewport,
      };

  /// 生成一份新配置，仅覆盖传入的字段。
  FlowConfig copyWith({
    String? baseUrl,
    Map<String, dynamic>? variables,
    int? timeout,
    Map<String, int>? viewport,
  }) {
    return FlowConfig(
      baseUrl: baseUrl ?? this.baseUrl,
      variables: variables ?? this.variables,
      timeout: timeout ?? this.timeout,
      viewport: viewport ?? this.viewport,
    );
  }
}

/// 单个测试步骤：动作 + 可选定位目标 + 可选输入值 + 可选断言。
class FlowStep {
  final String name;
  final String action;
  final Map<String, dynamic>? target;
  final dynamic value;
  /// 服务端 JSON 字段名为 "assert"，Dart 侧改用 assertion 避免关键字冲突。
  final Map<String, dynamic>? assertion;

  FlowStep({
    required this.name,
    required this.action,
    this.target,
    this.value,
    this.assertion,
  });

  factory FlowStep.fromJson(Map<String, dynamic> json) {
    return FlowStep(
      name: (json['name'] as String?) ?? '',
      action: (json['action'] as String?) ?? '',
      target: json['target'] is Map
          ? Map<String, dynamic>.from(json['target'])
          : null,
      value: json['value'],
      assertion: json['assert'] is Map
          ? Map<String, dynamic>.from(json['assert'])
          : null,
    );
  }

  Map<String, dynamic> toJson() {
    final result = <String, dynamic>{
      'name': name,
      'action': action,
    };
    if (target != null) result['target'] = target;
    if (value != null) result['value'] = value;
    if (assertion != null) result['assert'] = assertion;
    return result;
  }
}

/// 一个完整流程：元信息 + 配置 + 步骤列表。
class Flow {
  final String name;
  final String description;
  final FlowConfig config;
  final List<FlowStep> steps;
  /// 客户端保存的自然语言原文，服务端数据结构中无此字段时保持为 null。
  final String? sourceText;

  Flow({
    required this.name,
    required this.description,
    required this.config,
    required this.steps,
    this.sourceText,
  });

  factory Flow.fromJson(Map<String, dynamic> json) {
    final rawConfig = json['config'];
    final config = FlowConfig.fromJson(
      rawConfig is Map ? Map<String, dynamic>.from(rawConfig) : <String, dynamic>{},
    );

    final steps = <FlowStep>[];
    final rawSteps = json['steps'];
    if (rawSteps is List) {
      for (final item in rawSteps) {
        if (item is Map) {
          steps.add(FlowStep.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }

    return Flow(
      name: (json['name'] as String?) ?? '',
      description: (json['description'] as String?) ?? '',
      config: config,
      steps: steps,
      sourceText: json['sourceText'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    final result = <String, dynamic>{
      'name': name,
      'description': description,
      'config': config.toJson(),
      'steps': steps.map((step) => step.toJson()).toList(),
    };
    if (sourceText != null) result['sourceText'] = sourceText;
    return result;
  }

  /// 生成一份新流程，仅覆盖传入的字段。
  Flow copyWith({
    String? name,
    String? description,
    FlowConfig? config,
    List<FlowStep>? steps,
    String? sourceText,
  }) {
    return Flow(
      name: name ?? this.name,
      description: description ?? this.description,
      config: config ?? this.config,
      steps: steps ?? this.steps,
      sourceText: sourceText ?? this.sourceText,
    );
  }
}

/// 流程列表中的一项概要信息。
class FlowInfo {
  final String file;
  final String name;
  final int steps;

  FlowInfo({
    required this.file,
    required this.name,
    required this.steps,
  });

  factory FlowInfo.fromJson(Map<String, dynamic> json) {
    return FlowInfo(
      file: (json['file'] as String?) ?? '',
      name: (json['name'] as String?) ?? '',
      steps: (json['steps'] as num?)?.toInt() ?? 0,
    );
  }
}
