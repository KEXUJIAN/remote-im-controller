/**
 * Remote IM Controller - LocalAdapter 模块测试
 */

import { parseInput } from '../adapters/local_adapter.js';
import type { CardEventPayload, MenuEventPayload } from '../types.js';

function main() {
  console.log('=== 测试 parseInput ===\n');

  // 测试 1: TEXT 消息解析
  {
    const result = parseInput('hello world');
    console.assert(result.type === 'TEXT', 'TEXT: type should be TEXT');
    console.assert(result.userId === 'local-cli-user', 'TEXT: userId should be local-cli-user');
    console.assert(result.chatId === 'local-cli', 'TEXT: chatId should be local-cli');
    const textPayload = result.payload as { text: string };
    console.assert(textPayload.text === 'hello world', 'TEXT: payload.text should match input');
    console.log('✓ TEXT 消息解析');
  }

  // 测试 2: TEXT 消息解析 - 空输入
  {
    const result = parseInput('');
    console.assert(result.type === 'TEXT', 'EMPTY: type should be TEXT');
    console.assert(result.userId === 'local-cli-user', 'EMPTY: userId should be local-cli-user');
    const textPayload = result.payload as { text: string };
    console.assert(textPayload.text === '', 'EMPTY: payload.text should be empty string');
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
    const textPayload = result.payload as { text: string };
    console.assert(textPayload.text === '/click enterx test', 'PREFIX_MISMATCH: payload.text should be original input');
    console.log('✓ 类似前缀不匹配');
  }

  // 测试 8: 时间戳
  {
    const before = Date.now();
    const result = parseInput('test');
    const after = Date.now();
    console.assert(result.type === 'TEXT', 'TIMESTAMP: type should be TEXT');
    console.assert(result.userId === 'local-cli-user', 'TIMESTAMP: userId should be local-cli-user');
    const textPayload = result.payload as { text: string };
    console.assert(textPayload.text === 'test', 'TIMESTAMP: payload.text should match input');
    console.assert(result.timestamp >= before, 'TIMESTAMP: timestamp should be >= before');
    console.assert(result.timestamp <= after, 'TIMESTAMP: timestamp should be <= after');
    console.log('✓ 时间戳正确');
  }

  console.log('\n=== 所有测试通过 ===');
}

main();
