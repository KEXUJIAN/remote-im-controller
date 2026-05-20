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
  startStreaming(sessionName: string, options: StreamingOptions): Promise<void>;
  
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
    
    const combined = state.lineBuffer + content;
    
    const lastNewlineIndex = combined.lastIndexOf('\n');
    
    if (lastNewlineIndex === -1) {
      state.lineBuffer = combined;
      return '';
    }
    
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
    
    const bytesToRead = currentSize - fromOffset;
    
    if (bytesToRead <= 0) {
      logger.debug('readNewOutput', '没有新内容', { sessionName, fromOffset, currentSize });
      return { content: '', markerFound: false, markerPosition: 0 };
    }
    
    const actualBytesToRead = Math.min(bytesToRead, maxOutputSize);
    
    let content = readFileSyncRange(logPath, fromOffset, actualBytesToRead);
    
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
    
    content = cleanTerminalOutput(content);
    
    if (state) {
      content = processLineBuffer(sessionName, content);
    }
    
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
  function startStreaming(sessionName: string, options: StreamingOptions): Promise<void> {
    const { intervalMs, onChunk, markerDetector } = options;
    return new Promise<void>((resolve) => {
    
    if (streamingTimers.has(sessionName)) {
      stopStreaming(sessionName);
    }
    
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
          resolve();
          return;
        }
        
        const result = readNewOutput(sessionName, currentOffset, markerDetector);
        
        const state = sessionStates.get(sessionName);
        if (state) {
          streamingOffsets.set(sessionName, state.offset);
        }
        
        if (result.content) {
          if (result.markerFound) {
            logger.info('startStreaming', '检测到完成标记', { sessionName, position: result.markerPosition });
            
            const contentBeforeMarker = result.content.slice(0, result.markerPosition);
            if (contentBeforeMarker) {
              await onChunk(contentBeforeMarker);
            }
            
            stopStreaming(sessionName);
            resolve();
            return;
          }
          
          await onChunk(result.content);
        }
      } catch (err) {
        logger.error('startStreaming', '流式推送出错', err, { sessionName });
      }
    }, intervalMs);
    
    streamingTimers.set(sessionName, timer);
    });
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

