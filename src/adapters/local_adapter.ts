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
function parseInput(input: string): UnifiedMessage {
  const chatId = 'local-cli';
  const timestamp = Date.now();

  if (input.startsWith('/click enter ')) {
    const sessionName = input.slice('/click enter '.length).trim();
    return {
      type: 'CARD_EVENT',
      chatId,
      payload: { action: 'enter', sessionName } as CardEventPayload,
      timestamp,
    };
  }

  if (input.startsWith('/click kill ')) {
    const sessionName = input.slice('/click kill '.length).trim();
    return {
      type: 'CARD_EVENT',
      chatId,
      payload: { action: 'kill', sessionName } as CardEventPayload,
      timestamp,
    };
  }

  if (input === '/menu exit') {
    return {
      type: 'MENU_EVENT',
      chatId,
      payload: { eventKey: 'exit_wsl_session_mode' } as MenuEventPayload,
      timestamp,
    };
  }

  return {
    type: 'TEXT',
    chatId,
    payload: input,
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

    async sendMessage(_chatId: string, message: string): Promise<void> {
      process.stdout.write(`\n${message}\n\n> `);
    },
  };
}

// ============ 内联测试 ============

if (process.argv[2] === 'test') {
  console.log('=== 测试 parseInput ===\n');

  // 测试 1: TEXT 消息解析
  {
    const result = parseInput('hello world');
    console.assert(result.type === 'TEXT', 'TEXT: type should be TEXT');
    console.assert(result.chatId === 'local-cli', 'TEXT: chatId should be local-cli');
    console.assert(result.payload === 'hello world', 'TEXT: payload should match input');
    console.log('✓ TEXT 消息解析');
  }

  // 测试 2: TEXT 消息解析 - 空输入
  {
    const result = parseInput('');
    console.assert(result.type === 'TEXT', 'EMPTY: type should be TEXT');
    console.assert(result.payload === '', 'EMPTY: payload should be empty string');
    console.log('✓ 空输入解析');
  }

  // 测试 3: CARD_EVENT (enter) 消息解析
  {
    const result = parseInput('/click enter my-session');
    console.assert(result.type === 'CARD_EVENT', 'CARD_EVENT enter: type should be CARD_EVENT');
    const payload = result.payload as CardEventPayload;
    console.assert(payload.action === 'enter', 'CARD_EVENT enter: action should be enter');
    console.assert(payload.sessionName === 'my-session', 'CARD_EVENT enter: sessionName should match');
    console.log('✓ CARD_EVENT (enter) 消息解析');
  }

  // 测试 4: CARD_EVENT (enter) 带空格
  {
    const result = parseInput('/click enter   session-with-spaces   ');
    console.assert(result.type === 'CARD_EVENT', 'CARD_EVENT enter trim: type should be CARD_EVENT');
    const payload = result.payload as CardEventPayload;
    console.assert(payload.sessionName === 'session-with-spaces', 'CARD_EVENT enter trim: sessionName should be trimmed');
    console.log('✓ CARD_EVENT (enter) 带空格解析');
  }

  // 测试 5: CARD_EVENT (kill) 消息解析
  {
    const result = parseInput('/click kill test-session');
    console.assert(result.type === 'CARD_EVENT', 'CARD_EVENT kill: type should be CARD_EVENT');
    const payload = result.payload as CardEventPayload;
    console.assert(payload.action === 'kill', 'CARD_EVENT kill: action should be kill');
    console.assert(payload.sessionName === 'test-session', 'CARD_EVENT kill: sessionName should match');
    console.log('✓ CARD_EVENT (kill) 消息解析');
  }

  // 测试 6: MENU_EVENT 消息解析
  {
    const result = parseInput('/menu exit');
    console.assert(result.type === 'MENU_EVENT', 'MENU_EVENT: type should be MENU_EVENT');
    const payload = result.payload as MenuEventPayload;
    console.assert(payload.eventKey === 'exit_wsl_session_mode', 'MENU_EVENT: eventKey should match');
    console.log('✓ MENU_EVENT 消息解析');
  }

  // 测试 7: 类似前缀但不匹配
  {
    const result = parseInput('/click enterx test');
    console.assert(result.type === 'TEXT', 'PREFIX_MISMATCH: type should be TEXT');
    console.assert(result.payload === '/click enterx test', 'PREFIX_MISMATCH: payload should be original input');
    console.log('✓ 类似前缀不匹配');
  }

  // 测试 8: 时间戳
  {
    const before = Date.now();
    const result = parseInput('test');
    const after = Date.now();
    console.assert(result.timestamp >= before, 'TIMESTAMP: timestamp should be >= before');
    console.assert(result.timestamp <= after, 'TIMESTAMP: timestamp should be <= after');
    console.log('✓ 时间戳正确');
  }

  console.log('\n=== 所有测试通过 ===');
}
