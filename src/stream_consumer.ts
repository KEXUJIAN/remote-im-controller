/**
 * Remote IM Controller - 流式消费者模块
 * 
 * 用于增量读取日志文件并按间隔推送更新
 */

import { open } from 'fs/promises';
import { existsSync } from 'fs';
import stripAnsi from 'strip-ansi';
import { createLogger } from './logger.js';
import type { StreamConsumer, StreamConsumerCallback } from './types.js';

const logger = createLogger('stream_consumer');

/** 流式消费者配置 */
export interface StreamConsumerOptions {
  /** 日志文件路径 */
  logFilePath: string;
  /** 推送回调 */
  pushCallback: StreamConsumerCallback;
  /** 推送间隔 (ms) */
  intervalMs: number;
}

/**
 * 创建流式消费者
 * 
 * 使用 fs.open + fs.read 进行位置读取，避免全文件读取
 */
export function createStreamConsumer(options: StreamConsumerOptions): StreamConsumer {
  const { logFilePath, pushCallback, intervalMs } = options;

  /** 文件句柄 */
  let fd: Awaited<ReturnType<typeof open>> | null = null;

  /** 当前读取偏移量 */
  let offset = 0;

  /** 定时器 ID */
  let timerId: NodeJS.Timeout | null = null;

  /** 是否已停止 */
  let stopped = false;

  /** 是否已销毁 */
  let destroyed = false;

  /**
   * 初始化文件句柄
   */
  async function initFileHandle(): Promise<void> {
    if (fd) return;

    if (!existsSync(logFilePath)) {
      logger.debug('initFileHandle', '日志文件不存在，等待创建', { path: logFilePath });
      return;
    }

    try {
      fd = await open(logFilePath, 'r');
      const stats = await fd.stat();
      offset = stats.size;
      logger.debug('initFileHandle', '文件句柄已初始化', { path: logFilePath, initialOffset: offset });
    } catch (err) {
      logger.error('initFileHandle', '打开文件失败', err, { path: logFilePath });
    }
  }

  /**
   * 执行一次增量读取
   */
  async function readIncremental(): Promise<void> {
    if (stopped || destroyed) return;

    // 如果文件不存在，尝试初始化
    if (!fd) {
      await initFileHandle();
      if (!fd) return;
    }

    try {
      const stats = await fd.stat();
      const currentSize = stats.size;

      // 如果文件变小了（被截断），重置偏移量
      if (currentSize < offset) {
        logger.debug('readIncremental', '文件被截断，重置偏移量', { 
          oldOffset: offset, 
          newSize: currentSize 
        });
        offset = currentSize;
        return;
      }

      // 有新内容需要读取
      if (currentSize > offset) {
        const bufferSize = currentSize - offset;
        const buffer = Buffer.alloc(bufferSize);
        
        const { bytesRead } = await fd.read(buffer, 0, bufferSize, offset);
        
        if (bytesRead > 0) {
          const chunk = stripAnsi(buffer.toString('utf8', 0, bytesRead));
          offset = currentSize;
          
          logger.debug('readIncremental', '读取到新内容', { 
            bytesRead, 
            newOffset: offset 
          });
          
          // 推送内容
          try {
            await pushCallback(chunk);
          } catch (err) {
            logger.error('readIncremental', '推送回调失败', err);
          }
        }
      }
    } catch (err) {
      // 文件可能已被删除或重命名
      logger.error('readIncremental', '读取文件失败', err, { path: logFilePath });
    }
  }

  /**
   * 开始消费日志文件
   */
  function start(): void {
    if (stopped || destroyed) {
      logger.warn('start', '消费者已停止或销毁，无法启动');
      return;
    }

    logger.info('start', '开始消费日志文件', { path: logFilePath, intervalMs });

    // 初始化文件句柄（异步执行，不阻塞 start）
    initFileHandle().catch(err => {
      logger.error('start', '初始化文件句柄失败', err);
    });

    // 启动定时器
    timerId = setInterval(() => {
      readIncremental().catch(err => {
        logger.error('start', '增量读取失败', err);
      });
    }, intervalMs);
  }

  /**
   * 停止消费
   */
  function stop(): void {
    if (stopped) {
      logger.debug('stop', '消费者已停止');
      return;
    }

    stopped = true;
    logger.info('stop', '停止消费', { path: logFilePath });

    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /**
   * 销毁资源
   */
  async function destroy(): Promise<void> {
    if (destroyed) {
      logger.debug('destroy', '消费者已销毁');
      return;
    }

    // 先停止
    stop();
    destroyed = true;

    // 关闭文件句柄
    if (fd) {
      try {
        await fd.close();
        logger.debug('destroy', '文件句柄已关闭', { path: logFilePath });
      } catch (err) {
        logger.error('destroy', '关闭文件句柄失败', err);
      }
      fd = null;
    }

    logger.info('destroy', '消费者已销毁', { path: logFilePath });
  }

  /**
   * 重置偏移量（开始新命令时调用）
   * 将偏移量设置为当前文件大小，避免读取旧内容
   */
  function reset(): void {
    if (destroyed) {
      logger.warn('reset', '消费者已销毁，无法重置');
      return;
    }

    // 异步获取当前文件大小并重置
    (async () => {
      if (fd) {
        try {
          const stats = await fd.stat();
          offset = stats.size;
          logger.info('reset', '偏移量已重置', { newOffset: offset, path: logFilePath });
        } catch (err) {
          logger.error('reset', '获取文件大小失败', err);
        }
      } else if (existsSync(logFilePath)) {
        // 文件存在但没有句柄，打开并获取大小
        try {
          const handle = await open(logFilePath, 'r');
          const stats = await handle.stat();
          offset = stats.size;
          await handle.close();
          logger.info('reset', '偏移量已重置（新打开文件）', { newOffset: offset, path: logFilePath });
        } catch (err) {
          logger.error('reset', '打开文件获取大小失败', err);
        }
      } else {
        // 文件不存在，偏移量设为 0
        offset = 0;
        logger.info('reset', '文件不存在，偏移量设为 0', { path: logFilePath });
      }
    })().catch(err => {
      logger.error('reset', '重置偏移量失败', err);
    });
  }

  return {
    start,
    stop,
    destroy,
    reset,
  };
}

// ============ 内联测试 ============
// 仅当文件被直接执行时运行测试（非导入时）

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'test') {
  const { writeFileSync, mkdirSync, rmSync, existsSync: fileExists } = await import('fs');
  const { join } = await import('path');

  const testDir = './logs/stream_test';
  const testFile = join(testDir, 'test.log');

  // 清理并创建测试目录
  if (fileExists(testDir)) {
    rmSync(testDir, { recursive: true });
  }
  mkdirSync(testDir, { recursive: true });

  console.log('\n=== StreamConsumer 内联测试 ===\n');

  let testPassed = 0;
  let testFailed = 0;

  /**
   * 测试 1：增量读取不重复
   */
  async function testIncrementalRead(): Promise<boolean> {
    console.log('测试 1：增量读取不重复');
    
    // 创建初始文件
    writeFileSync(testFile, '第一行内容\n', 'utf8');

    const chunks: string[] = [];
    const consumer = createStreamConsumer({
      logFilePath: testFile,
      pushCallback: async (chunk) => {
        chunks.push(chunk);
      },
      intervalMs: 100,
    });

    consumer.start();
    
    // 等待第一次读取完成
    await new Promise(resolve => setTimeout(resolve, 150));

    // 写入新内容
    writeFileSync(testFile, '第二行内容\n', { encoding: 'utf8', flag: 'a' });
    
    // 等待读取
    await new Promise(resolve => setTimeout(resolve, 200));

    consumer.stop();
    await consumer.destroy();

    // 验证：应该只读到第二行（第一行在 start 前已经存在，被 reset 到文件末尾）
    const allContent = chunks.join('');
    console.log(`  收到的内容: ${JSON.stringify(chunks)}`);
    
    if (chunks.length === 1 && allContent.includes('第二行内容')) {
      console.log('  ✓ 通过：只读取到新增内容');
      return true;
    } else {
      console.log(`  ✗ 失败：期望 1 个 chunk，实际 ${chunks.length} 个`);
      return false;
    }
  }

  /**
   * 测试 2：stop 清理定时器
   */
  async function testStopClearsInterval(): Promise<boolean> {
    console.log('\n测试 2：stop 清理定时器');

    writeFileSync(testFile, '测试内容\n', 'utf8');

    let callCount = 0;
    const consumer = createStreamConsumer({
      logFilePath: testFile,
      pushCallback: async () => {
        callCount++;
      },
      intervalMs: 50,
    });

    consumer.start();
    
    // 等待足够时间让定时器触发几次
    await new Promise(resolve => setTimeout(resolve, 200));

    const countBeforeStop = callCount;
    consumer.stop();

    // 再等待一段时间
    await new Promise(resolve => setTimeout(resolve, 200));

    // callCount 不应该增加
    if (callCount === countBeforeStop) {
      console.log('  ✓ 通过：stop 后回调不再被调用');
      return true;
    } else {
      console.log(`  ✗ 失败：stop 后回调仍然被调用 (${countBeforeStop} -> ${callCount})`);
      return false;
    }
  }

  /**
   * 测试 3：reset 移动偏移量
   */
  async function testResetMovesOffset(): Promise<boolean> {
    console.log('\n测试 3：reset 移动偏移量');

    // 创建文件并写入内容
    writeFileSync(testFile, '初始内容\n更多内容\n', 'utf8');

    const chunks: string[] = [];
    const consumer = createStreamConsumer({
      logFilePath: testFile,
      pushCallback: async (chunk) => {
        chunks.push(chunk);
      },
      intervalMs: 50,
    });

    // 启动消费者（会读取文件末尾）
    consumer.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    // 写入新内容
    writeFileSync(testFile, '新写入的内容\n', { encoding: 'utf8', flag: 'a' });
    await new Promise(resolve => setTimeout(resolve, 150));

    const chunksBeforeReset = chunks.length;

    // 重置偏移量
    consumer.reset();
    await new Promise(resolve => setTimeout(resolve, 100));

    // 再写入内容
    writeFileSync(testFile, '重置后的新内容\n', { encoding: 'utf8', flag: 'a' });
    await new Promise(resolve => setTimeout(resolve, 150));

    consumer.stop();
    await consumer.destroy();

    console.log(`  重置前 chunks: ${chunksBeforeReset}, 总 chunks: ${chunks.length}`);
    const lastChunk = chunks[chunks.length - 1] || '';
    
    if (lastChunk.includes('重置后的新内容')) {
      console.log('  ✓ 通过：reset 后能继续读取新内容');
      return true;
    } else {
      console.log(`  ✗ 失败：reset 后未能正确读取新内容`);
      return false;
    }
  }

  /**
   * 测试 4：destroy 清理资源
   */
  async function testDestroyCleansUp(): Promise<boolean> {
    console.log('\n测试 4：destroy 清理资源');

    writeFileSync(testFile, '销毁测试\n', 'utf8');

    let callCount = 0;
    const consumer = createStreamConsumer({
      logFilePath: testFile,
      pushCallback: async () => {
        callCount++;
      },
      intervalMs: 50,
    });

    consumer.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    await consumer.destroy();

    // 写入新内容
    writeFileSync(testFile, '销毁后写入\n', { encoding: 'utf8', flag: 'a' });
    await new Promise(resolve => setTimeout(resolve, 200));

    const countAfterDestroy = callCount;
    
    // 再次写入
    writeFileSync(testFile, '再次写入\n', { encoding: 'utf8', flag: 'a' });
    await new Promise(resolve => setTimeout(resolve, 200));

    if (callCount === countAfterDestroy) {
      console.log('  ✓ 通过：destroy 后资源已清理');
      return true;
    } else {
      console.log(`  ✗ 失败：destroy 后回调仍然被调用`);
      return false;
    }
  }

  // 运行所有测试
  try {
    if (await testIncrementalRead()) testPassed++; else testFailed++;
    if (await testStopClearsInterval()) testPassed++; else testFailed++;
    if (await testResetMovesOffset()) testPassed++; else testFailed++;
    if (await testDestroyCleansUp()) testPassed++; else testFailed++;

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
