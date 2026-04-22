/**
 * Remote IM Controller - Session 输出管理模块
 * 
 * 用于管理 SESSION 模式下的输出 offset，只返回本次命令的新增输出
 */

import { statSync, openSync, readSync, closeSync, existsSync } from 'fs';
import { createLogger } from './logger.js';
import { cleanTerminalOutput } from './utils/terminal_cleaner.js';
import type { MarkerDetector } from './types.js';

const logger = createLogger('session_output_manager');

/** 默认最大输出大小 (100KB) */
const DEFAULT_MAX_OUTPUT_SIZE = 100 * 1024;

/** 流式推送选项 */
export interface StreamingOptions {
  /** 轮询间隔 (ms) */
  intervalMs: number;
  /** 每次读取到新内容时的回调 */
  onChunk: (chunk: string) => Promise<void>;
  /** 完成时的回调 */
  onComplete?: () => void;
  /** 标记检测器（可选，用于检测命令完成） */
  markerDetector?: MarkerDetector;
}

/** readNewOutput 返回结果 */
export interface ReadNewOutputResult {
  /** 清理后的内容 */
  content: string;
  /** 是否检测到标记 */
  markerFound: boolean;
  /** 标记位置（仅在 markerFound 为 true 时有效） */
  markerPosition: number;
}

/**
 * Session 输出管理器接口
 */
export interface SessionOutputManager {
  /** 初始化 session 的 offset（创建 session 时调用） */
  initOffset(sessionName: string): void;
  
  /** 重置 offset 到文件末尾（发送命令前调用），返回当前 offset */
  resetOffset(sessionName: string): number;
  
  /** 读取从指定 offset 开始的新增内容（命令完成后调用） */
  readNewOutput(sessionName: string, fromOffset: number, markerDetector?: MarkerDetector): ReadNewOutputResult;
  
  /** 清理 session 的 offset（销毁 session 时调用） */
  clearOffset(sessionName: string): void;
  
  /** 检查 session 是否已初始化 offset */
  hasOffset(sessionName: string): boolean;
  
  /** 开始流式推送 */
  startStreaming(sessionName: string, options: StreamingOptions): void;
  
  /** 停止流式推送 */
  stopStreaming(sessionName: string): void;
  
  /** 检查是否正在流式推送 */
  isStreaming(sessionName: string): boolean;
  
  /** 加载持久化的会话状态 */
  loadSessionStates(data: Record<string, { offset: number; lineBuffer: string; logPath: string }>): void;
  
  /** 获取所有会话状态数据（用于持久化） */
  getAllSessionStatesData(): Record<string, { offset: number; lineBuffer: string; logPath: string }>;
}

/**
 * Session 输出管理器配置
 */
export interface SessionOutputManagerOptions {
  /** 获取 session 日志文件路径的函数 */
  getLogPath: (sessionName: string) => string | undefined;
  /** 最大输出大小（字节），默认 100KB */
  maxOutputSize?: number;
}

/**
 * Session 状态（内部使用）
 */
interface SessionState {
  /** 文件读取偏移量 */
  offset: number;
  /** 行缓冲（不完整的行） */
  lineBuffer: string;
}

/**
 * 创建 Session 输出管理器
 */
export function createSessionOutputManager(options: SessionOutputManagerOptions): SessionOutputManager {
  const { getLogPath, maxOutputSize = DEFAULT_MAX_OUTPUT_SIZE } = options;
  
  /** session 状态映射 */
  const sessionStates = new Map<string, SessionState>();
  
  /** 流式推送定时器映射 */
  const streamingTimers = new Map<string, NodeJS.Timeout>();
  
  /** 流式推送 offset 映射 */
  const streamingOffsets = new Map<string, number>();
  
  /**
   * 同步获取文件大小
   */
  function getFileSize(filePath: string): number {
    try {
      const stats = statSync(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
  
  /**
   * 同步读取文件的指定范围
   */
  function readFileSyncRange(filePath: string, start: number, length: number): string {
    if (length <= 0) return '';
    
    try {
      const buffer = Buffer.alloc(length);
      const fd = openSync(filePath, 'r');
      const bytesRead = readSync(fd, buffer, 0, length, start);
      closeSync(fd);
      
      return buffer.toString('utf8', 0, bytesRead);
    } catch (err) {
      logger.error('readFileSyncRange', '读取文件失败', err, { filePath, start, length });
      return '';
    }
  }
  
  /**
   * 处理行缓冲
   * 只返回完整的行，不完整的行保留到下次
   */
  function processLineBuffer(sessionName: string, content: string): string {
    const state = sessionStates.get(sessionName);
    if (!state) return content;
    
    // 合并上次未完成的行
    const combined = state.lineBuffer + content;
    
    // 查找最后一个换行符
    const lastNewlineIndex = combined.lastIndexOf('\n');
    
    if (lastNewlineIndex === -1) {
      // 没有完整行，全部缓冲
      state.lineBuffer = combined;
      return '';
    }
    
    // 返回完整行，缓冲剩余部分
    const completeLines = combined.slice(0, lastNewlineIndex + 1);
    state.lineBuffer = combined.slice(lastNewlineIndex + 1);
    
    return completeLines;
  }
  
  /**
   * 初始化 session 的 offset
   */
  function initOffset(sessionName: string): void {
    const logPath = getLogPath(sessionName);
    
    if (!logPath) {
      logger.warn('initOffset', '无法获取日志路径', { sessionName });
      return;
    }
    
    // 如果文件存在，获取当前大小作为初始 offset
    const initialOffset = existsSync(logPath) ? getFileSize(logPath) : 0;
    
    sessionStates.set(sessionName, {
      offset: initialOffset,
      lineBuffer: '',
    });
    
    logger.info('initOffset', 'session offset 已初始化', { sessionName, offset: initialOffset });
  }
  
  /**
   * 重置 offset 到文件末尾
   * 返回当前 offset（用于后续读取）
   */
  function resetOffset(sessionName: string): number {
    const logPath = getLogPath(sessionName);
    
    if (!logPath) {
      logger.warn('resetOffset', '无法获取日志路径', { sessionName });
      return 0;
    }
    
    const currentSize = existsSync(logPath) ? getFileSize(logPath) : 0;
    
    // 更新或创建状态
    const state = sessionStates.get(sessionName);
    if (state) {
      state.offset = currentSize;
      state.lineBuffer = '';
    } else {
      sessionStates.set(sessionName, {
        offset: currentSize,
        lineBuffer: '',
      });
    }
    
    logger.debug('resetOffset', 'offset 已重置', { sessionName, offset: currentSize });
    return currentSize;
  }
  
  /**
   * 读取从指定 offset 开始的新增内容
   */
  function readNewOutput(
    sessionName: string, 
    fromOffset: number, 
    markerDetector?: MarkerDetector
  ): ReadNewOutputResult {
    const logPath = getLogPath(sessionName);
    
    if (!logPath) {
      logger.warn('readNewOutput', '无法获取日志路径', { sessionName });
      return { content: '', markerFound: false, markerPosition: 0 };
    }
    
    if (!existsSync(logPath)) {
      logger.debug('readNewOutput', '日志文件不存在', { sessionName, logPath });
      return { content: '', markerFound: false, markerPosition: 0 };
    }
    
    const currentSize = getFileSize(logPath);
    const state = sessionStates.get(sessionName);
    
    // 文件轮转检测：如果当前文件大小小于 fromOffset，说明文件被截断或轮转
    if (currentSize < fromOffset) {
      logger.info('readNewOutput', '检测到文件轮转，从文件开头读取', { 
        sessionName, 
        oldOffset: fromOffset, 
        newSize: currentSize 
      });
      fromOffset = 0;
    }
    
    // 计算需要读取的字节数
    const bytesToRead = currentSize - fromOffset;
    
    if (bytesToRead <= 0) {
      logger.debug('readNewOutput', '没有新内容', { sessionName, fromOffset, currentSize });
      return { content: '', markerFound: false, markerPosition: 0 };
    }
    
    // 限制最大输出大小
    const actualBytesToRead = Math.min(bytesToRead, maxOutputSize);
    
    // 读取内容
    let content = readFileSyncRange(logPath, fromOffset, actualBytesToRead);
    
    // 如果内容被截断，记录日志
    if (bytesToRead > maxOutputSize) {
      logger.warn('readNewOutput', '输出被截断', { 
        sessionName, 
        requestedBytes: bytesToRead, 
        actualBytes: actualBytesToRead 
      });
    }
    
    // 在清理前检测标记
    let markerFound = false;
    let markerPosition = 0;
    
    if (markerDetector) {
      const result = markerDetector.check(content);
      markerFound = result.found;
      markerPosition = result.position;
    }
    
    // 清理终端控制序列
    content = cleanTerminalOutput(content);
    
    // 处理行缓冲
    if (state) {
      content = processLineBuffer(sessionName, content);
    }
    
    // 更新 offset
    if (state) {
      state.offset = currentSize;
    }
    
    logger.debug('readNewOutput', '读取完成', { 
      sessionName, 
      fromOffset, 
      bytesToRead: actualBytesToRead,
      contentLength: content.length,
      markerFound 
    });
    
    return { content, markerFound, markerPosition };
  }
  
  /**
   * 清理 session 的 offset
   */
  function clearOffset(sessionName: string): void {
    const deleted = sessionStates.delete(sessionName);
    
    if (deleted) {
      logger.info('clearOffset', 'session offset 已清理', { sessionName });
    } else {
      logger.debug('clearOffset', 'session offset 不存在', { sessionName });
    }
  }
  
  /**
   * 检查 session 是否已初始化 offset
   */
  function hasOffset(sessionName: string): boolean {
    return sessionStates.has(sessionName);
  }
  
  /**
   * 开始流式推送
   */
  function startStreaming(sessionName: string, options: StreamingOptions): void {
    const { intervalMs, onChunk, onComplete, markerDetector } = options;
    
    // 如果已经在流式推送，先停止
    if (streamingTimers.has(sessionName)) {
      stopStreaming(sessionName);
    }
    
    // 初始化流式 offset
    const logPath = getLogPath(sessionName);
    const initialOffset = logPath && existsSync(logPath) ? getFileSize(logPath) : 0;
    streamingOffsets.set(sessionName, initialOffset);
    
    logger.info('startStreaming', '开始流式推送', { 
      sessionName, 
      intervalMs, 
      initialOffset 
    });
    
    const timer = setInterval(async () => {
      try {
        const currentOffset = streamingOffsets.get(sessionName);
        if (currentOffset === undefined) {
          logger.warn('startStreaming', '流式 offset 不存在', { sessionName });
          stopStreaming(sessionName);
          return;
        }
        
        const result = readNewOutput(sessionName, currentOffset, markerDetector);
        
        // 更新 offset
        const state = sessionStates.get(sessionName);
        if (state) {
          streamingOffsets.set(sessionName, state.offset);
        }
        
        if (result.content) {
          // 检查标记
          if (result.markerFound) {
            logger.info('startStreaming', '检测到完成标记', { sessionName, position: result.markerPosition });
            
            // 推送标记之前的内容
            const contentBeforeMarker = result.content.slice(0, result.markerPosition);
            if (contentBeforeMarker) {
              await onChunk(contentBeforeMarker);
            }
            
            // 停止流式推送
            stopStreaming(sessionName);
            onComplete?.();
            return;
          }
          
          // 推送新内容
          await onChunk(result.content);
        }
      } catch (err) {
        logger.error('startStreaming', '流式推送出错', err, { sessionName });
      }
    }, intervalMs);
    
    streamingTimers.set(sessionName, timer);
  }
  
  /**
   * 停止流式推送
   */
  function stopStreaming(sessionName: string): void {
    const timer = streamingTimers.get(sessionName);
    
    if (timer) {
      clearInterval(timer);
      streamingTimers.delete(sessionName);
      streamingOffsets.delete(sessionName);
      
      logger.info('stopStreaming', '流式推送已停止', { sessionName });
    } else {
      logger.debug('stopStreaming', '未找到流式推送', { sessionName });
    }
  }
  
  /**
   * 检查是否正在流式推送
   */
  function isStreaming(sessionName: string): boolean {
    return streamingTimers.has(sessionName);
  }
  
  /**
   * 加载持久化的会话状态
   */
  function loadSessionStates(
    data: Record<string, { offset: number; lineBuffer: string; logPath: string }>
  ): void {
    for (const [sessionName, state] of Object.entries(data)) {
      sessionStates.set(sessionName, {
        offset: state.offset,
        lineBuffer: state.lineBuffer,
      });
      // 恢复 logPath 到 activePipes（由 TmuxManager 处理）
    }
    logger.info('loadSessionStates', '会话状态加载完成', { count: sessionStates.size });
  }
  
  /**
   * 获取所有会话状态数据（用于持久化）
   */
  function getAllSessionStatesData(): Record<string, {
    offset: number;
    lineBuffer: string;
    logPath: string;
  }> {
    const data: Record<string, { offset: number; lineBuffer: string; logPath: string }> = {};
    for (const [sessionName, state] of sessionStates.entries()) {
      // logPath 需要从外部获取，这里用空字符串占位
      // 实际 logPath 由 TmuxManager.getActivePipes() 提供
      data[sessionName] = {
        offset: state.offset,
        lineBuffer: state.lineBuffer,
        logPath: '', // 占位，由调用方合并
      };
    }
    return data;
  }
  
  return {
    initOffset,
    resetOffset,
    readNewOutput,
    clearOffset,
    hasOffset,
    startStreaming,
    stopStreaming,
    isStreaming,
    loadSessionStates,
    getAllSessionStatesData,
  };
}

// ============ 内联测试 ============
// 仅当文件被直接执行时运行测试（非导入时）

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'test') {
  const { writeFileSync, mkdirSync, rmSync, existsSync: fileExists, truncateSync } = await import('fs');
  const { join } = await import('path');
  
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
      
      let onCompleteCalled = false;
      const chunks: string[] = [];
      
      manager.startStreaming('test-session', {
        intervalMs: 50,
        onChunk: async (chunk) => {
          chunks.push(chunk);
        },
        onComplete: () => {
          onCompleteCalled = true;
        },
        markerDetector,
      });
      
      // 写入不含标记的内容
      writeFileSync(testLogFile, '正常内容\n', { encoding: 'utf8', flag: 'a' });
      
      // 等待第一次触发
      setTimeout(() => {
        // 写入包含标记的内容
        writeFileSync(testLogFile, '完成前内容<<COMPLETE>>忽略内容\n', { encoding: 'utf8', flag: 'a' });
        
        // 等待检测
        setTimeout(() => {
          console.log(`  onComplete 被调用: ${onCompleteCalled}`);
          console.log(`  收到的 chunks: ${JSON.stringify(chunks)}`);
          console.log(`  流式推送状态: ${manager.isStreaming('test-session')}`);
          
          // 验证：应该检测到标记并停止
          if (onCompleteCalled && !manager.isStreaming('test-session')) {
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
        }, 150);
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
