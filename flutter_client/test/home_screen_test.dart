import 'package:flutter/material.dart' hide Flow;
import 'package:flutter_test/flutter_test.dart';
import 'package:flowtest_client/models/flow.dart';
import 'package:flowtest_client/models/report.dart';
import 'package:flowtest_client/screens/home_screen.dart';
import 'package:flowtest_client/services/api_service.dart';

/// 用假 API 替换真实 HTTP 调用，验证界面渲染与交互链路。
/// 这样无需 Xcode、无需启动 Node 引擎即可跑通 UI 逻辑。
class _FakeApi extends ApiService {
  _FakeApi({this.failConfig = false, this.report})
      : super(baseUrl: 'http://127.0.0.1:3777');

  final bool failConfig;
  final TestReport? report;
  int runCount = 0;

  @override
  Future<EngineConfigStatus> getConfig() async {
    if (failConfig) throw ApiException('引擎未连接');
    return EngineConfigStatus(llmConfigured: false, model: 'rules', endpoint: '');
  }

  @override
  Future<List<FlowInfo>> listFlows() async => <FlowInfo>[
        FlowInfo(file: 'demo.json', name: '示例流程', steps: 3),
      ];

  @override
  Future<Flow> loadFlow(String file) async => Flow(
        name: '示例流程',
        description: '',
        config: FlowConfig(
          baseUrl: 'http://localhost:8899',
          variables: <String, dynamic>{},
          timeout: 30000,
          viewport: <String, int>{'width': 1280, 'height': 720},
        ),
        steps: <FlowStep>[
          FlowStep(
            name: '打开首页',
            action: 'navigate',
            target: <String, dynamic>{'by': 'url', 'value': '/'},
          ),
        ],
      );

  @override
  Future<String> saveFlow(String? file, Flow flow) async => 'saved.json';

  @override
  Future<Map<String, dynamic>> parseSteps(String text, {bool useRules = false}) async {
    return <String, dynamic>{
      'steps': <dynamic>[
        <String, dynamic>{
          'name': '打开首页',
          'action': 'navigate',
          'target': <String, dynamic>{'by': 'url', 'value': '/'},
        }
      ],
      'engine': 'rules',
    };
  }

  @override
  Future<TestReport> runFlow(
    Flow flow, {
    String? channel,
    Map<String, dynamic>? variables,
    bool stopOnFailure = false,
  }) async {
    runCount++;
    return report ??
        TestReport(
          name: flow.name,
          passed: true,
          passedCount: 2,
          failedCount: 0,
          startedAt: '2026-11-27T05:00:00.000Z',
          finishedAt: '2026-11-27T05:00:03.000Z',
          steps: <StepResult>[
            StepResult(
              name: '打开首页',
              action: 'navigate',
              passed: true,
              detail: 'http://localhost:8899/',
              duration: 120,
            ),
            StepResult(
              name: '点击站点实况',
              action: 'click',
              passed: true,
              detail: '已点击 站点实况（降级定位: textExact）',
              duration: 340,
            ),
          ],
        );
  }

  @override
  Future<List<ReportSummary>> listReports() async => <ReportSummary>[];

  @override
  Uri reportUri(String id) => Uri.parse('http://127.0.0.1:3777/api/reports/$id');
}

Widget _wrap(ApiService api) {
  return MaterialApp(
    home: HomeScreen(api: api, engineRunning: true, engineBaseUrl: 'http://127.0.0.1:3777'),
  );
}

/// 放大测试窗口到双栏布局尺寸，避免按钮被挤到可视区外导致点击落空
Future<void> _pump(WidgetTester tester, ApiService api) async {
  tester.view.physicalSize = const Size(1600, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(_wrap(api));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('主界面渲染：左右两栏与关键按钮都在', (tester) async {
    await _pump(tester, _FakeApi());

    expect(find.text('执行结果'), findsOneWidget);
    expect(find.text('运行测试'), findsOneWidget);
    expect(find.text('解析为结构化步骤'), findsOneWidget);
    expect(find.textContaining('AI 未配置'), findsWidgets);
    expect(find.text('引擎运行中'), findsOneWidget);
  });

  testWidgets('流程列表加载后出现在下拉框中', (tester) async {
    await _pump(tester, _FakeApi());

    await tester.tap(find.text('-- 选择已保存流程 --'));
    await tester.pumpAndSettle();

    expect(find.text('示例流程 · 3 步'), findsWidgets);
  });

  testWidgets('解析自然语言后再运行测试，展示步骤结果与通过统计', (tester) async {
    final api = _FakeApi();
    await _pump(tester, api);

    // 第 3 个输入框是「自然语言步骤」
    await tester.enterText(find.byType(TextField).at(2), '打开 /login');
    await tester.pumpAndSettle();

    await tester.tap(find.text('解析为结构化步骤'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('运行测试'));
    await tester.pumpAndSettle();

    expect(api.runCount, 1);
    expect(find.text('通过'), findsWidgets);
    expect(find.text('2/2 步通过'), findsOneWidget);
    expect(find.text('点击站点实况'), findsOneWidget);
    expect(find.textContaining('降级定位'), findsWidgets);
  });

  testWidgets('没有步骤时点运行会提示，不会发请求', (tester) async {
    final api = _FakeApi();
    await _pump(tester, api);

    await tester.tap(find.text('运行测试'));
    await tester.pump(const Duration(milliseconds: 300));

    expect(api.runCount, 0);
    expect(find.text('请先解析或填写步骤'), findsWidgets);
  });

  testWidgets('运行失败时展示失败状态与失败步骤', (tester) async {
    final failing = TestReport(
      name: '失败流程',
      passed: false,
      passedCount: 1,
      failedCount: 1,
      startedAt: '2026-11-27T05:00:00.000Z',
      finishedAt: '2026-11-27T05:00:05.000Z',
      steps: <StepResult>[
        StepResult(
          name: '打开首页',
          action: 'navigate',
          passed: true,
          detail: 'http://localhost:8899/',
          duration: 100,
        ),
        StepResult(
          name: '点击站点实况',
          action: 'click',
          passed: false,
          detail: '无法定位「站点实况」（点击失败）',
          duration: 2100,
        ),
      ],
    );
    final api = _FakeApi(report: failing);
    await _pump(tester, api);

    await tester.enterText(find.byType(TextField).at(2), '打开 /login');
    await tester.pumpAndSettle();
    await tester.tap(find.text('解析为结构化步骤'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('运行测试'));
    await tester.pumpAndSettle();

    expect(find.text('失败'), findsWidgets);
    expect(find.text('1/2 步通过'), findsOneWidget);
    expect(find.textContaining('无法定位'), findsWidgets);
  });

  testWidgets('引擎配置读取失败时给出错误提示，不白屏', (tester) async {
    tester.view.physicalSize = const Size(1600, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(_wrap(_FakeApi(failConfig: true)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.textContaining('引擎未连接'), findsWidgets);
    expect(find.text('运行测试'), findsOneWidget);
  });
}
