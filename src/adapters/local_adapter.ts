/**
 * Remote IM Controller - 本地适配器
 */

import * as readline from 'readline';
import type { Adapter, CoreProcessor } from './adapter.js';
import type { UnifiedMessage, CardEventPayload, MenuEventPayload } from '../types.js';

/**
 * 解析 CLI 输入为统一消息
 * @param input 用户输入
 * @returns 统一消息
 */
export function parseInput(input: string): UnifiedMessage {
  const userId = 'local-cli-user';
  const chatId = 'local-cli';
  const timestamp = Date.now();

  if (input.startsWith('/click enter ')) {
    const sessionName = input.slice('/click enter '.length).trim();
    return {
      type: 'CARD_EVENT',
      userId,
      chatId,
      payload: { action: 'enter', sessionName } as CardEventPayload,
      timestamp,
    };
  }

  if (input.startsWith('/click kill ')) {
    const sessionName = input.slice('/click kill '.length).trim();
    return {
      type: 'CARD_EVENT',
      userId,
      chatId,
      payload: { action: 'kill', sessionName } as CardEventPayload,
      timestamp,
    };
  }

  if (input === '/menu exit') {
    return {
      type: 'MENU_EVENT',
      userId,
      chatId,
      payload: { eventKey: 'exit_wsl_session_mode' } as MenuEventPayload,
      timestamp,
    };
  }

  return {
    type: 'TEXT',
    userId,
    chatId,
    payload: { text: input },
    timestamp,
  };
}

/**
 * 创建本地 CLI 适配器
 * 用于在没有飞书连接的情况下测试核心功能
 */
export function createLocalAdapter(): Adapter {
  let rl: readline.Interface | null = null;
  let processor: CoreProcessor | null = null;

  return {
    async start(p: CoreProcessor): Promise<void> {
      processor = p;

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
      });

      rl.prompt();

      rl.on('line', async (input: string) => {
        const trimmed = input.trim();

        if (trimmed.length === 0) {
          rl?.prompt();
          return;
        }

        const message = parseInput(trimmed);
        await processor?.process(message);

        rl?.prompt();
      });

      rl.on('close', () => {
        process.exit(0);
      });
    },

    async stop(): Promise<void> {
      if (rl) {
        rl.close();
        rl = null;
      }
      processor = null;
    },

    async sendMessage(_chatId: string, message: string): Promise<string> {
      process.stdout.write(`\n${message}\n\n> `);
      return 'local-cli-message';
    },

    async updateMessage(_chatId: string, _messageId: string, message: string): Promise<void> {
      process.stdout.write(`\n[更新消息]\n${message}\n\n> `);
    },
  };
}
