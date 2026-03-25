/**
 * Remote IM Controller - 适配器接口
 */

import type { UnifiedMessage } from '../types.js';

/**
 * 核心处理器接口
 * 处理来自各适配器的统一消息
 */
export interface CoreProcessor {
  /** 处理消息 */
  process(message: UnifiedMessage): Promise<void>;
}

/**
 * 适配器接口
 * 统一不同 IM 平台的接入方式
 */
export interface Adapter {
  /** 启动适配器，注册消息处理器 */
  start(processor: CoreProcessor): Promise<void>;
  /** 停止适配器 */
  stop(): Promise<void>;
  /** 发送消息到指定聊天 */
  sendMessage(chatId: string, message: string): Promise<void>;
}
