/**
 * Remote IM Controller - TmuxManager 模块测试
 */

import { createTmuxManager } from '../tmux_manager.js';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';

async function main() {
  process.env.TMUX_TMPDIR = resolve(process.env.TMUX_TMPDIR || process.env.LOG_DIR || './logs');
  mkdirSync(process.env.TMUX_TMPDIR, { recursive: true });

  const debug = process.env.TMUX_DEBUG === 'true';
  const streamLogDir = './logs/stream/';
  const manager = createTmuxManager(50, debug, streamLogDir);

  console.log('=== TmuxManager 测试 ===\n');
  if (debug) console.log('调试模式已开启，日志将写入 logs/ 目录\n');

  console.log('1. 检查 tmux 是否可用...');
  try {
    await manager.checkAvailable();
    console.log('   ✓ tmux 可用\n');
  } catch (err) {
    console.log('   ✗ tmux 不可用:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log('2. 列出现有会话...');
  const sessions = await manager.listSessions();
  console.log(`   当前会话: [${sessions.join(', ') || '无'}]\n`);

  const testSessionName = `test-${Date.now()}`;
  console.log(`3. 创建测试会话 "${testSessionName}"...`);
  try {
    await manager.createSession(testSessionName);
    console.log('   ✓ 会话创建成功');
    console.log('   提示: 可在另一个终端运行 `tmux attach -t %s` 观察', testSessionName);
    console.log();
    await new Promise((r) => setTimeout(r, 3000));
  } catch (err) {
    console.log('   ✗ 创建失败:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`4. 检查会话 "${testSessionName}" 是否存在...`);
  const exists = await manager.sessionExists(testSessionName);
  console.log(`   ${exists ? '✓ 存在' : '✗ 不存在'}\n`);

  console.log(`5. 测试 pipe-pane 日志文件...`);
  const pipeLogPath = manager.getPipeLogPath(testSessionName);
  if (pipeLogPath) {
    console.log(`   ✓ getPipeLogPath 返回路径: ${pipeLogPath}`);
    if (existsSync(pipeLogPath)) {
      console.log('   ✓ 日志文件存在');
    } else {
      console.log('   ✗ 日志文件不存在');
    }
  } else {
    console.log('   ✗ getPipeLogPath 返回 undefined');
  }
  console.log();

  console.log(`6. 向会话 "${testSessionName}" 发送命令 "echo hello"...`);
  try {
    await manager.sendCommand(testSessionName, 'echo hello');
    await new Promise((r) => setTimeout(r, 500));
    console.log('   ✓ 命令发送成功\n');
  } catch (err) {
    console.log('   ✗ 发送失败:', err instanceof Error ? err.message : err);
  }

  console.log(`7. 抓取会话 "${testSessionName}" 的屏幕...`);
  try {
    const result = await manager.captureScreen(testSessionName, 10);
    console.log(`   ✓ 抓取成功 (${result.lines} 行, hash: ${result.hash.slice(0, 8)}...)`);
    console.log('   输出预览:');
    result.cleaned.split('\n').slice(0, 5).forEach((line) => console.log(`     | ${line}`));
    console.log();
  } catch (err) {
    console.log('   ✗ 抓取失败:', err instanceof Error ? err.message : err);
  }

  console.log(`8. 终止测试会话 "${testSessionName}"...`);
  console.log('   等待 3 秒，可在另一个终端 attach 观察...');
  await new Promise((r) => setTimeout(r, 3000));
  try {
    await manager.killSession(testSessionName);
    console.log('   ✓ 会话已终止\n');
  } catch (err) {
    console.log('   ✗ 终止失败:', err instanceof Error ? err.message : err);
  }

  console.log(`9. 确认会话 "${testSessionName}" 已不存在...`);
  const stillExists = await manager.sessionExists(testSessionName);
  console.log(`   ${!stillExists ? '✓ 已删除' : '✗ 仍存在'}\n`);

  console.log(`10. 测试 pipe-pane 清理...`);
  const pipeLogPathAfterKill = manager.getPipeLogPath(testSessionName);
  if (pipeLogPathAfterKill === undefined) {
    console.log('   ✓ getPipeLogPath 返回 undefined');
  } else {
    console.log(`   ✗ getPipeLogPath 仍返回路径: ${pipeLogPathAfterKill}`);
  }
  
  if (pipeLogPath && !existsSync(pipeLogPath)) {
    console.log('   ✓ 日志文件已删除');
  } else if (pipeLogPath) {
    console.log('   ✗ 日志文件仍存在，尝试清理...');
    try {
      unlinkSync(pipeLogPath);
      console.log('   ✓ 手动清理成功');
    } catch {
      console.log('   ! 手动清理失败');
    }
  }
  console.log();

  console.log('=== 所有测试完成 ===');
}

main().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
