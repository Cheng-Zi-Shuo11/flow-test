import 'package:flutter/material.dart';

import '../models/report.dart';

/// 单条步骤执行结果：序号、名称、动作、状态、详情、耗时。
///
/// 通过用绿色、失败用红色区分，与 Web 版报告表格的视觉风格保持一致。
class StepResultTile extends StatelessWidget {
  final int index;
  final StepResult result;

  const StepResultTile({
    super.key,
    required this.index,
    required this.result,
  });

  @override
  Widget build(BuildContext context) {
    final passed = result.passed;
    final statusColor = passed
        ? const Color(0xFF0F6E56) // 通过：深绿
        : const Color(0xFFA32D2D); // 失败：深红
    final statusBackground = passed
        ? const Color(0xFFE1F5EE)
        : const Color(0xFFFBE7E7);

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Color(0xFFE5E7EB)),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          // 序号徽标
          Container(
            width: 26,
            height: 26,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: statusBackground,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '${index + 1}',
              style: TextStyle(
                color: statusColor,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                // 步骤名称 + 通过/失败状态
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        result.name,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF1F2937),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: statusBackground,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        passed ? '通过' : '失败',
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                // 动作 + 耗时
                Row(
                  children: <Widget>[
                    const Icon(
                      Icons.bolt_outlined,
                      size: 13,
                      color: Color(0xFF6B7280),
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        result.action,
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF6B7280),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${result.duration} ms',
                      style: const TextStyle(
                        fontSize: 11,
                        color: Color(0xFF9CA3AF),
                      ),
                    ),
                  ],
                ),
                // 详情（失败原因等）
                if (result.detail.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 4),
                  Text(
                    result.detail,
                    style: TextStyle(
                      fontSize: 12,
                      color: passed ? const Color(0xFF4B5563) : statusColor,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
