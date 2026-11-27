import 'dart:convert';
import 'dart:io';

/// 内嵌 Node 引擎生命周期管理。
///
/// Flutter 客户端启动后在后台拉起 FlowTest 的 Node HTTP 服务，
/// 并通过 [baseUrl] 暴露给上层 API 层调用；用户无需手动执行 `npm start`。
class EngineService {
  EngineService({String? engineDir, int port = 3777})
      : _engineDirOverride = engineDir,
        port = port;

  /// 引擎监听端口，与上层 ApiService 保持一致。
  final int port;

  /// 调用方显式指定的引擎目录（最高优先级）。
  final String? _engineDirOverride;

  Process? _process;
  bool _exited = true;
  bool _reused = false;
  Future<bool>? _startFuture;
  void Function(String)? _onStatus;

  /// 引擎进程输出（stdout + stderr）的环形上限缓冲，避免无限增长。
  final StringBuffer _outputBuffer = StringBuffer();
  static const int _maxBufferChars = 20000;

  /// 健康检查超时：15 秒，每 300ms 轮询一次。
  static const Duration _healthTimeout = Duration(seconds: 15);
  static const Duration _healthInterval = Duration(milliseconds: 300);

  String get baseUrl => 'http://127.0.0.1:$port';

  /// 引擎是否可用：由本服务拉起的进程存活，或复用了外部已有的服务。
  bool get isRunning => _reused || (_process != null && !_exited);

  /// 最近一次引擎输出（最多保留 [_maxBufferChars] 个字符），便于故障排查。
  String get output => _outputBuffer.toString();

  /// 启动引擎；若端口上已有健康服务则直接复用。
  Future<bool> start({void Function(String)? onStatus}) {
    // 并发调用共享同一次启动流程，避免重复拉起进程。
    final inflight = _startFuture;
    if (inflight != null) return inflight;

    _onStatus = onStatus;
    final future = _startInternal();
    _startFuture = future;
    future.whenComplete(() {
      if (identical(_startFuture, future)) _startFuture = null;
    });
    return future;
  }

  Future<bool> _startInternal() async {
    _report('准备启动 FlowTest 引擎（端口 $port）...');

    // 已有服务：直接复用，不再拉起进程，也不在 stop() 时误杀外部进程。
    if (await isHealthy()) {
      _reused = true;
      _report('检测到 $baseUrl 已有服务在运行，直接复用');
      return true;
    }

    final engineDir = _resolveEngineDir();
    if (engineDir == null) {
      _report('未找到引擎目录，请确保 bundled_engine/src/server.js 存在，'
          '或设置 FLOWTEST_ENGINE_DIR');
      return false;
    }

    final nodeBin = _resolveNodeBin();
    final serverFile = File(_join(engineDir.path, 'src', 'server.js'));
    if (!serverFile.existsSync()) {
      _report('引擎入口不存在：${serverFile.path}');
      return false;
    }

    try {
      // includeParentEnvironment 默认 true，继承 FLOWTEST_LLM_* 等LLM配置。
      final process = await Process.start(
        nodeBin,
        [serverFile.path],
        workingDirectory: engineDir.path,
        environment: <String, String>{'PORT': '$port'},
        includeParentEnvironment: true,
      );

      _process = process;
      _exited = false;
      _reused = false;
      _appendOutput('[engine] 启动命令: $nodeBin ${serverFile.path} (PORT=$port)\n');

      process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) => _appendOutput('[stdout] $line\n'));
      process.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) => _appendOutput('[stderr] $line\n'));

      process.exitCode.then((code) {
        _exited = true;
        _appendOutput('[engine] 进程退出，exitCode=$code\n');
        _report('引擎进程已退出（exitCode=$code）');
      }).catchError((Object error) {
        _exited = true;
        _appendOutput('[engine] 等待退出码失败: $error\n');
      });

      _report('引擎进程已启动（pid=${process.pid}），等待健康检查...');

      // 轮询健康端点，最多等待 15 秒。
      final deadline = DateTime.now().add(_healthTimeout);
      while (DateTime.now().isBefore(deadline)) {
        if (await isHealthy()) {
          _report('引擎已就绪：$baseUrl');
          return true;
        }
        if (_exited) break;
        await Future<void>.delayed(_healthInterval);
      }

      _report('引擎启动失败或健康检查超时，最近输出：${_tail(800)}');
      await stop();
      return false;
    } catch (error) {
      _report('启动引擎失败：$error');
      await stop();
      return false;
    }
  }

  /// GET /api/config 返回 200 即视为健康。
  Future<bool> isHealthy() async {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client
          .getUrl(Uri.parse('$baseUrl/api/config'))
          .timeout(const Duration(seconds: 2));
      final response = await request.close().timeout(const Duration(seconds: 2));
      await response.drain<void>();
      return response.statusCode == 200;
    } catch (_) {
      return false;
    } finally {
      client.close();
    }
  }

  /// 优雅停止由本服务拉起的引擎进程；复用外部服务时只解除复用标记。
  Future<void> stop() async {
    final process = _process;
    _process = null;
    _reused = false;
    if (process == null) return;

    try {
      if (Platform.isWindows) {
        // Windows 不支持信号，直接终止。
        process.kill();
      } else {
        // Unix 先 SIGTERM，等待 2 秒仍未退出再 SIGKILL 兜底。
        process.kill(ProcessSignal.sigterm);
        bool timedOut = false;
        await process.exitCode.timeout(const Duration(seconds: 2), onTimeout: () {
          timedOut = true;
          return -1;
        });
        if (timedOut) {
          process.kill(ProcessSignal.sigkill);
        }
      }
      _report('引擎进程已停止');
    } catch (error) {
      _appendOutput('[engine] 停止进程时出错: $error\n');
    }
  }

  /// 引擎目录定位优先级：
  /// 1) 构造函数传入；2) FLOWTEST_ENGINE_DIR；
  /// 3) 可执行文件同级（或工作目录）下的 bundled_engine/；
  /// 4) 开发模式：Flutter 项目上级目录（即 flow-test 主项目）。
  Directory? _resolveEngineDir() {
    bool valid(Directory dir) =>
        File(_join(dir.path, 'src', 'server.js')).existsSync();

    final override = _engineDirOverride;
    if (override != null && override.isNotEmpty) {
      final dir = Directory(override);
      if (valid(dir)) return dir;
    }

    final envDir = Platform.environment['FLOWTEST_ENGINE_DIR'];
    if (envDir != null && envDir.isNotEmpty) {
      final dir = Directory(envDir);
      if (valid(dir)) return dir;
    }

    final exeDir = Directory(Platform.resolvedExecutable).parent;
    for (final candidate in <Directory>[
      Directory(_join(exeDir.path, 'bundled_engine')),
      Directory(_join(Directory.current.path, 'bundled_engine')),
    ]) {
      if (valid(candidate)) return candidate;
    }

    // 开发模式：从当前目录向上逐级查找（flutter_client 的上级即主项目）。
    var dir = Directory.current;
    for (var i = 0; i < 5; i++) {
      if (valid(dir)) return dir;
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
    return null;
  }

  /// Node 可执行文件解析：
  /// 1) FLOWTEST_NODE_BIN；2) 引擎目录内置的 node/node.exe（打包分发用，用户无需自装）；
  /// 3) PATH 中的 node；4) 交给系统继续查找。
  String _resolveNodeBin() {
    final envBin = Platform.environment['FLOWTEST_NODE_BIN'];
    if (envBin != null && envBin.isNotEmpty && File(envBin).existsSync()) {
      return envBin;
    }

    // 分发包会在 bundled_engine/ 内放置 Node 运行时，优先使用它。
    final engineDir = _resolveEngineDir();
    if (engineDir != null) {
      for (final name in const ['node', 'node.exe']) {
        final candidate = _join(engineDir.path, name);
        if (File(candidate).existsSync()) return candidate;
      }
    }

    if (Platform.isWindows) {
      final pathVar = Platform.environment['Path'] ?? Platform.environment['PATH'] ?? '';
      for (final entry in pathVar.split(';')) {
        if (entry.isEmpty) continue;
        for (final name in const ['node.exe', 'node']) {
          final candidate = _join(entry, name);
          if (File(candidate).existsSync()) return candidate;
        }
      }
      // 交给 Process.start 继续在 PATH 中查找；失败时由上层报告错误。
      return 'node.exe';
    }
    return 'node';
  }

  String _join(String a, [String? b, String? c]) => <String>[
        a,
        if (b != null) b,
        if (c != null) c,
      ].join(Platform.pathSeparator);

  void _report(String message) {
    _appendOutput('[engine] $message\n');
    _onStatus?.call(message);
  }

  void _appendOutput(String text) {
    _outputBuffer.write(text);
    if (_outputBuffer.length > _maxBufferChars) {
      final all = _outputBuffer.toString();
      _outputBuffer.clear();
      _outputBuffer.write(all.substring(all.length - _maxBufferChars));
    }
  }

  String _tail(int chars) {
    final all = _outputBuffer.toString();
    return all.length <= chars ? all : all.substring(all.length - chars);
  }
}
