/**
 * Remote IM Controller - CommandRouter 模块测试
 */

import { createCommandRouter } from '../command_router.js';
import { createTmuxManager } from '../tmux_manager.js';
import { createTestConfig } from './test_utils.js';

async function main() {
  const tmuxManager = createTmuxManager(50, false, './logs/stream/');
  const router = createCommandRouter({ tmuxManager });

  const mockConfig = createTestConfig({
    logLevel: 'debug',
    logDir: './logs',
    streamLogDir: './logs/stream/',
  });

  console.log('=== CommandRouter 测试 ===\n');

  // 测试 1: help
  console.log('1. 测试 help 指令...');
  const helpResult = await router.route({
    parsed: { action: 'help', args: [], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${helpResult.success ? '✓' : '✗'}`);
  console.log(`   消息:\n${helpResult.message.split('\n').map((l) => `     ${l}`).join('\n')}\n`);

  // 测试 2: list
  console.log('2. 测试 list 指令...');
  const listResult = await router.route({
    parsed: { action: 'list', args: [], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${listResult.success ? '✓' : '✗'}`);
  console.log(`   消息: ${listResult.message}\n`);

  // 测试 3: create
  const testSession = `test-router-${Date.now()}`;
  console.log(`3. 测试 create 指令 (${testSession})...`);
  const createResult = await router.route({
    parsed: { action: 'create', session: testSession, args: [], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${createResult.success ? '✓' : '✗'}`);
  console.log(`   消息: ${createResult.message}\n`);

  // 测试 4: status
  console.log(`4. 测试 status 指令 (${testSession})...`);
  const statusResult = await router.route({
    parsed: { action: 'status', session: testSession, args: [], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${statusResult.success ? '✓' : '✗'}`);
  console.log(`   消息: ${statusResult.message}\n`);

  // 测试 5: exec
  console.log(`5. 测试 exec 指令 (${testSession})...`);
  const execResult = await router.route({
    parsed: { action: 'exec', session: testSession, command: 'echo hello', args: ['echo', 'hello'], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${execResult.success ? '✓' : '✗'}`);
  console.log(`   消息: ${execResult.message}\n`);

  // 测试 6: kill
  console.log(`6. 测试 kill 指令 (${testSession})...`);
  const killResult = await router.route({
    parsed: { action: 'kill', session: testSession, args: [], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${killResult.success ? '✓' : '✗'}`);
  console.log(`   消息: ${killResult.message}\n`);

  // 测试 7: status 不存在的会话
  console.log('7. 测试 status 指令 (不存在的会话)...');
  const statusNotFoundResult = await router.route({
    parsed: { action: 'status', session: 'nonexistent-session', args: [], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${statusNotFoundResult.success ? '✓' : '✗'}`);
  console.log(`   消息: ${statusNotFoundResult.message}\n`);

  // 测试 8: 未知动作
  console.log('8. 测试未知动作...');
  const unknownResult = await router.route({
    parsed: { action: 'unknown' as never, args: [], options: {} },
    chatId: 'test-chat',
    messageId: 'test-msg',
    config: mockConfig,
  });
  console.log(`   结果: ${unknownResult.success ? '✗ (预期失败)' : '✓ (预期失败)'}`);
  console.log(`   消息: ${unknownResult.message}\n`);

  console.log('=== 所有测试完成 ===');
}

main().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
