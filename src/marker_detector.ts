/**
 * Remote IM Controller - PS1 边界标记检测模块
 *
 * 用于检测终端输出中的 OSC 标记，该标记由 PS1 配置在命令执行完成后输出。
 * 标记格式：\x1b]99;CMD_END\x07
 *
 * 核心功能：
 * 1. 完整标记检测 - 检测完整的 OSC 序列
 * 2. 部分标记缓冲 - 处理标记被分片跨读取的情况
 * 3. 状态重置 - 支持重置内部缓冲区
 */

import type { MarkerDetector } from './types.js';

/** OSC 边界标记序列，用于检测命令完成。@internal 不作为公开 API */
export const OSC_MARKER = '\x1b]99;CMD_END\x07';

/**
 * 创建 PS1 边界标记检测器
 * @returns 标记检测器实例
 */
export function createMarkerDetector(): MarkerDetector {
  /** 内部缓冲区，用于存储可能的部分标记 */
  let buffer = '';

  return {
    /**
     * 检测内容中是否包含 OSC 标记
     * @param content 新读取的内容
     * @returns 检测结果，found 表示是否找到标记，position 为标记位置
     */
    check(content: string): { found: boolean; position: number } {
      // 将缓冲区与新内容合并
      const combined = buffer + content;

      // 查找完整标记
      const pos = combined.indexOf(OSC_MARKER);

      if (pos !== -1) {
        // 找到完整标记，清空缓冲区
        buffer = '';
        return { found: true, position: pos };
      }

      // 未找到完整标记，保留最后可能的部分标记
      // OSC_MARKER 长度为 17，所以保留最后 16 个字符
      buffer = combined.slice(-(OSC_MARKER.length - 1));

      return { found: false, position: -1 };
    },

    /**
     * 重置内部缓冲区
     */
    reset(): void {
      buffer = '';
    },
  };
}
