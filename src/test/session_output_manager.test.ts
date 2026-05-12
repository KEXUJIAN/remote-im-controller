/**
 * Remote IM Controller - SessionOutputManager 模块测试
 */

import { writeFileSync, mkdirSync, rmSync, existsSync, truncateSync } from 'fs';
import { join } from 'path';
import { createSessionOutputManager } from '../session_output_manager.js';
import type { MarkerDetector } from '../types.js';

const fileExists = existsSync;

async function main() {
  const testDir = './logs/session_output_test';
  const testLogFile = join(testDir, 'test-session.log');

  // 清理并创建测试目录
  if (fileExists(testDir)) {
    rmSync(testDir, { recursive: true });
  }
  mkdirSync(testDir, { recursive: true });

  console.log('\n=== SessionOutputManager 内联测试 ===\n');

  let testPassed = 0;
  let testFailed = 0;

  // 创建测试用的 getLogPath 函数
  const getTestLogPath = (sessionName: string): string | undefined => {
    if (sessionName === 'test-session') {
      return testLogFile;
    }
    return undefined;
  };

  /**
   * 测试 1：初始化和基本读写
   */
  function testBasicReadWrite(): boolean {
    console.log('测试 1：初始化和基本读写');

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    // 创建初始文件
    writeFileSync(testLogFile, '第一行内容\n', 'utf8');

    // 初始化 offset
    manager.initOffset('test-session');

    // 写入新内容
    writeFileSync(testLogFile, '第二行内容\n', { encoding: 'utf8', flag: 'a' });

    // 重置并获取 offset
    const offset = manager.resetOffset('test-session');

    // 写入更多内容
    writeFileSync(testLogFile, '第三行内容\n', { encoding: 'utf8', flag: 'a' });

    // 读取新增内容
    const result = manager.readNewOutput('test-session', offset);

    console.log(`  offset: ${offset}`);
    console.log(`  输出: ${JSON.stringify(result.content)}`);

    // 验证：应该只包含第三行
    if (result.content.includes('第三行内容') && !result.content.includes('第一行内容') && !result.content.includes('第二行内容')) {
      console.log('  ✓ 通过：只读取到新增内容');
      return true;
    } else {
      console.log('  ✗ 失败：输出包含历史内容');
      return false;
    }
  }

  /**
   * 测试 2：文件轮转检测
   */
  function testFileRotation(): boolean {
    console.log('\n测试 2：文件轮转检测');

    // 清理并重新创建文件
    rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    // 创建文件并写入大量数据
    writeFileSync(testLogFile, '大量数据 '.repeat(100) + '\n', 'utf8');

    // 记录 offset
    manager.initOffset('test-session');
    const offset = manager.resetOffset('test-session');

    // 模拟日志轮转：截断文件
    truncateSync(testLogFile, 0);

    // 写入新数据
    writeFileSync(testLogFile, '轮转后的新数据\n', 'utf8');

    // 读取输出
    const result = manager.readNewOutput('test-session', offset);

    console.log(`  旧 offset: ${offset}`);
    console.log(`  输出: ${JSON.stringify(result.content)}`);

    // 验证：应该检测到轮转并读取新数据
    if (result.content.includes('轮转后的新数据')) {
      console.log('  ✓ 通过：检测到文件轮转');
      return true;
    } else {
      console.log('  ✗ 失败：未正确处理文件轮转');
      return false;
    }
  }

  /**
   * 测试 3：ANSI 代码剥离
   */
  function testAnsiStrip(): boolean {
    console.log('\n测试 3：ANSI 代码剥离');

    // 清理并重新创建文件
    rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    // 写入包含 ANSI 代码的内容
    writeFileSync(testLogFile, '', 'utf8');
    manager.initOffset('test-session');
    const offset = manager.resetOffset('test-session');

    // 写入带 ANSI 代码的内容
    writeFileSync(testLogFile, '\x1b[32m绿色文字\x1b[0m\n\x1b[1m粗体\x1b[0m\n', { encoding: 'utf8', flag: 'a' });

    const result = manager.readNewOutput('test-session', offset);

    console.log(`  输出: ${JSON.stringify(result.content)}`);

    // 验证：不应包含 ANSI 转义序列
    if (!result.content.includes('\x1b') && result.content.includes('绿色文字') && result.content.includes('粗体')) {
      console.log('  ✓ 通过：ANSI 代码已剥离');
      return true;
    } else {
      console.log('  ✗ 失败：ANSI 代码未正确剥离');
      return false;
    }
  }

  /**
   * 测试 4：行缓冲处理
   */
  function testLineBuffer(): boolean {
    console.log('\n测试 4：行缓冲处理');

    // 清理并重新创建文件
    rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    writeFileSync(testLogFile, '', 'utf8');
    manager.initOffset('test-session');
    const offset = manager.resetOffset('test-session');

    // 写入不完整的行
    writeFileSync(testLogFile, '不完整的行', { encoding: 'utf8', flag: 'a' });

    // 第一次读取应该返回空（行不完整）
    const result1 = manager.readNewOutput('test-session', offset);

    // 写入换行符使其完整
    writeFileSync(testLogFile, '\n完整的行了\n', { encoding: 'utf8', flag: 'a' });

    // 第二次读取应该返回完整内容
    const result2 = manager.readNewOutput('test-session', offset);

    console.log(`  第一次输出: ${JSON.stringify(result1.content)}`);
    console.log(`  第二次输出: ${JSON.stringify(result2.content)}`);

    // 验证：第一次应该为空，第二次应该包含完整行
    if (result1.content === '' && result2.content.includes('不完整的行\n完整的行了\n')) {
      console.log('  ✓ 通过：行缓冲正确处理');
      return true;
    } else {
      console.log('  ✗ 失败：行缓冲处理有问题');
      return false;
    }
  }

  /**
   * 测试 5：clearOffset 清理
   */
  function testClearOffset(): boolean {
    console.log('\n测试 5：clearOffset 清理');

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    // 初始化
    manager.initOffset('test-session');

    // 验证存在
    if (!manager.hasOffset('test-session')) {
      console.log('  ✗ 失败：initOffset 后 should have offset');
      return false;
    }

    // 清理
    manager.clearOffset('test-session');

    // 验证已清理
    if (manager.hasOffset('test-session')) {
      console.log('  ✗ 失败：clearOffset 后不应有 offset');
      return false;
    }

    console.log('  ✓ 通过：offset 正确清理');
    return true;
  }

  /**
   * 测试 6：OSC 序列清理
   */
  function testOscSequenceCleanup(): boolean {
    console.log('\n测试 6：OSC 序列清理');

    // 清理并重新创建文件
    rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    writeFileSync(testLogFile, '', 'utf8');
    manager.initOffset('test-session');
    const offset = manager.resetOffset('test-session');

    // 写入包含 OSC 序列的内容
    // OSC 设置标题: \x1b]0;title\x07 或 \x1b]7;file://...\x1b\\
    writeFileSync(testLogFile, '\x1b]0;my-title\x07正常内容\n\x1b]7;file:///path\x1b\\\n', { encoding: 'utf8', flag: 'a' });

    const result = manager.readNewOutput('test-session', offset);

    console.log(`  输出: ${JSON.stringify(result.content)}`);

    // 验证：OSC 序列应被移除
    if (!result.content.includes('\x1b]') && result.content.includes('正常内容')) {
      console.log('  ✓ 通过：OSC 序列已清理');
      return true;
    } else {
      console.log('  ✗ 失败：OSC 序列未正确清理');
      return false;
    }
  }

  /**
   * 测试 7：退格符处理
   */
  function testBackspaceHandling(): boolean {
    console.log('\n测试 7：退格符处理');

    // 清理并重新创建文件
    rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    writeFileSync(testLogFile, '', 'utf8');
    manager.initOffset('test-session');
    const offset = manager.resetOffset('test-session');

    // 写入包含退格符的内容（模拟 zsh 回显：l + 退格 + ll = 最终显示 ll）
    writeFileSync(testLogFile, 'l\x08ll\n', { encoding: 'utf8', flag: 'a' });

    const result = manager.readNewOutput('test-session', offset);

    console.log(`  输出: ${JSON.stringify(result.content)}`);

    // 验证：退格符应被正确处理，输出 "ll"
    if (result.content.includes('ll') && !result.content.includes('\x08')) {
      console.log('  ✓ 通过：退格符已正确处理');
      return true;
    } else {
      console.log('  ✗ 失败：退格符处理有问题');
      return false;
    }
  }

  /**
   * 测试 8：私有模式序列清理
   */
  function testPrivateModeSequenceCleanup(): boolean {
    console.log('\n测试 8：私有模式序列清理');

    // 清理并重新创建文件
    rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

    writeFileSync(testLogFile, '', 'utf8');
    manager.initOffset('test-session');
    const offset = manager.resetOffset('test-session');

    // 写入包含私有模式序列的内容（如 bracket paste mode）
    // 注意：这些序列可能在日志中没有 \x1b 前缀
    writeFileSync(testLogFile, '[?2004h[?1l正常输出\n', { encoding: 'utf8', flag: 'a' });

    const result = manager.readNewOutput('test-session', offset);

    console.log(`  输出: ${JSON.stringify(result.content)}`);

    // 验证：私有模式序列应被移除
    if (!result.content.includes('[?2004') && !result.content.includes('[?1l') && result.content.includes('正常输出')) {
      console.log('  ✓ 通过：私有模式序列已清理');
      return true;
    } else {
      console.log('  ✗ 失败：私有模式序列未正确清理');
      return false;
    }
  }

  /**
   * 测试 9：流式推送 - 基本启动和停止
   */
  function testStreamingBasic(): Promise<boolean> {
    return new Promise((resolve) => {
      console.log('\n测试 9：流式推送 - 基本启动和停止');

      // 清理并重新创建文件
      rmSync(testDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });

      const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

      writeFileSync(testLogFile, '', 'utf8');

      // 验证初始状态
      if (manager.isStreaming('test-session')) {
        console.log('  ✗ 失败：初始状态不应在流式推送');
        resolve(false);
        return;
      }

      // 启动流式推送
      const chunks: string[] = [];
      manager.startStreaming('test-session', {
        intervalMs: 100,
        onChunk: async (chunk) => {
          chunks.push(chunk);
        },
      });

      // 验证流式推送状态
      if (!manager.isStreaming('test-session')) {
        console.log('  ✗ 失败：启动后应该在流式推送');
        resolve(false);
        return;
      }

      // 写入内容
      writeFileSync(testLogFile, '第一行\n', { encoding: 'utf8', flag: 'a' });

      // 等待一段时间让定时器触发
      setTimeout(() => {
        // 停止流式推送
        manager.stopStreaming('test-session');

        // 验证已停止
        if (manager.isStreaming('test-session')) {
          console.log('  ✗ 失败：停止后不应在流式推送');
          resolve(false);
          return;
        }

        console.log(`  收到的 chunks: ${chunks.length}`);
        console.log('  ✓ 通过：流式推送启动和停止正常');
        resolve(true);
      }, 200);
    });
  }

  /**
   * 测试 10：流式推送 - onChunk 回调触发
   */
  function testStreamingOnChunk(): Promise<boolean> {
    return new Promise((resolve) => {
      console.log('\n测试 10：流式推送 - onChunk 回调触发');

      // 清理并重新创建文件
      rmSync(testDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });

      const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

      writeFileSync(testLogFile, '', 'utf8');

      const chunks: string[] = [];
      manager.startStreaming('test-session', {
        intervalMs: 50,
        onChunk: async (chunk) => {
          chunks.push(chunk);
        },
      });

      // 写入内容
      writeFileSync(testLogFile, '内容A\n', { encoding: 'utf8', flag: 'a' });

      // 等待第一次触发
      setTimeout(() => {
        // 写入更多内容
        writeFileSync(testLogFile, '内容B\n', { encoding: 'utf8', flag: 'a' });

        // 等待第二次触发
        setTimeout(() => {
          manager.stopStreaming('test-session');

          console.log(`  收到的 chunks: ${JSON.stringify(chunks)}`);

          // 验证是否收到了内容
          const allContent = chunks.join('');
          if (allContent.includes('内容A') && allContent.includes('内容B')) {
            console.log('  ✓ 通过：onChunk 回调正确触发');
            resolve(true);
          } else {
            console.log('  ✗ 失败：未收到所有内容');
            resolve(false);
          }
        }, 100);
      }, 100);
    });
  }

  /**
   * 测试 11：流式推送 - 标记检测触发完成
   */
  function testStreamingMarkerDetection(): Promise<boolean> {
    return new Promise((resolve) => {
      console.log('\n测试 11：流式推送 - 标记检测触发完成');

      // 清理并重新创建文件
      rmSync(testDir, { recursive: true });
      mkdirSync(testDir, { recursive: true });

      const manager = createSessionOutputManager({ getLogPath: getTestLogPath });

      writeFileSync(testLogFile, '', 'utf8');

      // 创建标记检测器
      const markerDetector: MarkerDetector = {
        check: (content: string) => {
          const marker = '<<COMPLETE>>';
          const position = content.indexOf(marker);
          return { found: position !== -1, position };
        },
        reset: () => {},
      };

      const chunks: string[] = [];

      const streamPromise = manager.startStreaming('test-session', {
        intervalMs: 50,
        onChunk: async (chunk) => {
          chunks.push(chunk);
        },
        markerDetector,
      });

      // 写入不含标记的内容
      writeFileSync(testLogFile, '正常内容\n', { encoding: 'utf8', flag: 'a' });

      // 等待第一次触发
      setTimeout(async () => {
        // 写入包含标记的内容
        writeFileSync(testLogFile, '完成前内容<<COMPLETE>>忽略内容\n', { encoding: 'utf8', flag: 'a' });

        // 等待流式推送完成（标记检测触发 resolve）
        await streamPromise;

        console.log(`  收到的 chunks: ${JSON.stringify(chunks)}`);
        console.log(`  流式推送状态: ${manager.isStreaming('test-session')}`);

        // 验证：应该检测到标记并停止
        if (!manager.isStreaming('test-session')) {
          const allContent = chunks.join('');
          if (allContent.includes('正常内容') && allContent.includes('完成前内容')) {
            console.log('  ✓ 通过：标记检测正确触发完成');
            resolve(true);
          } else {
            console.log('  ✗ 失败：未正确推送标记前的内容');
            resolve(false);
          }
        } else {
          console.log('  ✗ 失败：标记检测未正确工作');
          resolve(false);
        }
      }, 100);
    });
  }

  // 运行所有测试
  try {
    // 同步测试
    if (await testBasicReadWrite()) testPassed++; else testFailed++;
    if (await testFileRotation()) testPassed++; else testFailed++;
    if (await testAnsiStrip()) testPassed++; else testFailed++;
    if (await testLineBuffer()) testPassed++; else testFailed++;
    if (await testClearOffset()) testPassed++; else testFailed++;
    if (await testOscSequenceCleanup()) testPassed++; else testFailed++;
    if (await testBackspaceHandling()) testPassed++; else testFailed++;
    if (await testPrivateModeSequenceCleanup()) testPassed++; else testFailed++;

    // 异步测试
    if (await testStreamingBasic()) testPassed++; else testFailed++;
    if (await testStreamingOnChunk()) testPassed++; else testFailed++;
    if (await testStreamingMarkerDetection()) testPassed++; else testFailed++;

    console.log(`\n=== 测试结果 ===`);
    console.log(`通过: ${testPassed}`);
    console.log(`失败: ${testFailed}`);
    console.log(`总计: ${testPassed + testFailed}\n`);

    // 清理
    rmSync(testDir, { recursive: true });

    process.exit(testFailed > 0 ? 1 : 0);
  } catch (err) {
    console.error('测试执行出错:', err);
    rmSync(testDir, { recursive: true });
    process.exit(1);
  }
}

main().catch(console.error);
