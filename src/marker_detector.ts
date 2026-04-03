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

/** OSC 标记：\x1b]99;CMD_END\x07 */
const OSC_MARKER = '\x1b]99;CMD_END\x07';

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

// ============ 内联测试 ============

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'test') {
  console.log('=== MarkerDetector 测试 ===\n');

  // 测试 1：完整标记检测
  console.log('1. 测试完整标记检测...');
  {
    const detector = createMarkerDetector();
    const result = detector.check(`hello world${OSC_MARKER}more text`);
    console.log(`   输入: "hello world${OSC_MARKER}more text"`);
    console.log(`   结果: found=${result.found}, position=${result.position}`);
    if (result.found && result.position === 11) {
      console.log('   ✓ 通过\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  // 测试 2：部分标记分片跨块
  console.log('2. 测试部分标记分片跨块...');
  {
    const detector = createMarkerDetector();
    // 第一个块包含标记的前半部分
    const result1 = detector.check('hello\x1b]99;CMD_');
    console.log(`   第一块: "hello\\x1b]99;CMD_"`);
    console.log(`   结果: found=${result1.found}`);
    if (!result1.found) {
      console.log('   ✓ 第一块未检测到标记');
    } else {
      console.log('   ✗ 第一块不应检测到标记\n');
      process.exit(1);
    }

    // 第二个块包含标记的后半部分
    const result2 = detector.check('END\x07world');
    console.log(`   第二块: "END\\x07world"`);
    console.log(`   结果: found=${result2.found}, position=${result2.position}`);
    // 缓冲区保留最后 12 字符 "llo\x1b]99;CMD_"，合并后标记在位置 3
    if (result2.found && result2.position === 3) {
      console.log('   ✓ 通过\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  // 测试 3：单个块中多个标记
  console.log('3. 测试单个块中多个标记...');
  {
    const detector = createMarkerDetector();
    const result = detector.check(`first${OSC_MARKER}second${OSC_MARKER}third`);
    console.log(`   输入包含两个标记`);
    console.log(`   结果: found=${result.found}, position=${result.position}`);
    // 应该返回第一个标记的位置
    if (result.found && result.position === 5) {
      console.log('   ✓ 通过（返回第一个标记位置）\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  // 测试 4：无标记
  console.log('4. 测试无标记内容...');
  {
    const detector = createMarkerDetector();
    const result = detector.check('hello world, no marker here');
    console.log(`   输入: "hello world, no marker here"`);
    console.log(`   结果: found=${result.found}`);
    if (!result.found && result.position === -1) {
      console.log('   ✓ 通过\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  // 测试 5：reset 功能
  console.log('5. 测试 reset 功能...');
  {
    const detector = createMarkerDetector();
    // 创建部分标记状态
    detector.check('partial\x1b]99;CM');

    // 重置
    detector.reset();

    // 验证缓冲区已清空
    const result = detector.check('D_END\x07');
    console.log(`   重置后输入不完整标记后缀 "D_END\\x07"`);
    console.log(`   结果: found=${result.found}`);
    // 由于已重置，之前的缓冲区被清除，所以不应该匹配
    if (!result.found) {
      console.log('   ✓ 通过（reset 后缓冲区已清空）\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  // 测试 6：标记在开头
  console.log('6. 测试标记在开头...');
  {
    const detector = createMarkerDetector();
    const result = detector.check(`${OSC_MARKER}hello`);
    console.log(`   输入: 标记开头 + "hello"`);
    console.log(`   结果: found=${result.found}, position=${result.position}`);
    if (result.found && result.position === 0) {
      console.log('   ✓ 通过\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  // 测试 7：标记在末尾
  console.log('7. 测试标记在末尾...');
  {
    const detector = createMarkerDetector();
    const result = detector.check(`hello${OSC_MARKER}`);
    console.log(`   输入: "hello" + 标记末尾`);
    console.log(`   结果: found=${result.found}, position=${result.position}`);
    if (result.found && result.position === 5) {
      console.log('   ✓ 通过\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  // 测试 8：极端分片 - 每个字符一个块
  console.log('8. 测试极端分片（每个字符一个块）...');
  {
    const detector = createMarkerDetector();
    const markerChars = OSC_MARKER.split('');
    let foundResult: { found: boolean; position: number } | null = null;

    for (const char of markerChars) {
      const result = detector.check(char);
      if (result.found) {
        foundResult = result;
        break;
      }
    }

    console.log(`   逐字符输入 OSC 标记`);
    console.log(`   结果: found=${foundResult?.found ?? false}`);
    if (foundResult?.found) {
      console.log('   ✓ 通过\n');
    } else {
      console.log('   ✗ 失败\n');
      process.exit(1);
    }
  }

  console.log('=== 所有测试完成 ===');
}
