import 'package:flutter/material.dart';

import 'screens/home_screen.dart';
import 'services/api_service.dart';
import 'services/engine_service.dart';

void main() {
  runApp(const FlowTestApp());
}

/// 应用入口组件。
///
/// 启动时拉起内嵌 Node 引擎，就绪后以引擎地址创建 ApiService 并传给主页面；
/// 应用退出（detached）时停止引擎进程。
class FlowTestApp extends StatefulWidget {
  const FlowTestApp({super.key});

  @override
  State<FlowTestApp> createState() => _FlowTestAppState();
}

class _FlowTestAppState extends State<FlowTestApp> with WidgetsBindingObserver {
  final EngineService _engine = EngineService();

  ApiService? _api;
  String _status = '正在启动本地引擎…';
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startEngine();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    // 此处不停止引擎，避免热重载/页面临时重建时误杀服务；
    // 真正的退出清理在 didChangeAppLifecycleState(detached) 中完成。
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.detached) {
      _engine.stop();
    }
  }

  /// 启动引擎并初始化 API；成功前展示启动状态页。
  Future<void> _startEngine() async {
    if (!mounted) return;
    setState(() {
      _api = null;
      _error = null;
      _status = '正在启动本地引擎…';
    });

    try {
      final ready = await _engine.start(onStatus: (message) {
        if (mounted) setState(() => _status = message);
      });
      if (!mounted) return;
      if (ready) {
        setState(() {
          _api = ApiService(baseUrl: _engine.baseUrl);
          _status = '引擎已就绪';
        });
      } else {
        final output = _engine.output.trim();
        final detail = output.isEmpty ? '' : '\n最近输出：${output.substring(output.length >= 300 ? output.length - 300 : 0)}';
        setState(() => _error = '引擎启动失败$detail');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '引擎启动失败: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'FlowTest',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF185FA5),
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFF9FAFB),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: Color(0xFF1F2937),
          elevation: 0,
          surfaceTintColor: Colors.white,
        ),
      ),
      home: _api == null ? _buildStartupPage() : _buildHome(_api!),
    );
  }

  Widget _buildHome(ApiService api) {
    return HomeScreen(
      api: api,
      engineRunning: _engine.isRunning,
      engineBaseUrl: _engine.baseUrl,
    );
  }

  /// 引擎启动期间的状态页，失败时可重试。
  Widget _buildStartupPage() {
    final error = _error;
    return Scaffold(
      backgroundColor: const Color(0xFFF9FAFB),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(32),
          child: error == null
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const Icon(
                      Icons.bolt,
                      size: 48,
                      color: Color(0xFF185FA5),
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'FlowTest',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF1F2937),
                      ),
                    ),
                    const SizedBox(height: 24),
                    const CircularProgressIndicator(
                      valueColor:
                          AlwaysStoppedAnimation<Color>(Color(0xFF185FA5)),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      _status,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                  ],
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const Icon(
                      Icons.error_outline,
                      size: 48,
                      color: Color(0xFFA32D2D),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      '启动失败',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        color: Color(0xFF1F2937),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      error,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 13,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                    const SizedBox(height: 20),
                    ElevatedButton.icon(
                      onPressed: _startEngine,
                      icon: const Icon(Icons.refresh, size: 16),
                      label: const Text('重试'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF185FA5),
                        foregroundColor: Colors.white,
                        elevation: 0,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
