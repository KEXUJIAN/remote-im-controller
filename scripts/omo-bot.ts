#!/usr/bin/env bun
/**
 * omo-bot.ts - WSL 调度脚本
 * 
 * 用于在 WSL 环境中启动和管理 Remote IM Controller
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMUX_SESSION_NAME = 'remote-im-controller';

/**
 * 转义 Shell 参数，防止注入攻击
 */
function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * 检查 tmux 会话是否存在
 */
function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${escapeShellArg(name)} 2>/dev/null`, {
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动服务
 */
function startService(): void {
  console.log('启动 Remote IM Controller...');
  
  if (sessionExists(TMUX_SESSION_NAME)) {
    console.log(`tmux 会话 "${TMUX_SESSION_NAME}" 已存在`);
    console.log('使用 "omo-bot stop" 先停止现有服务');
    return;
  }
  
  try {
    execSync(`tmux new-session -d -s ${TMUX_SESSION_NAME} -c ${escapeShellArg(PROJECT_ROOT)}`, {
      stdio: 'inherit'
    });
    
    execSync(`tmux send-keys -t ${TMUX_SESSION_NAME} 'bun run start' Enter`, {
      stdio: 'inherit'
    });
    
    console.log(`服务已在 tmux 会话 "${TMUX_SESSION_NAME}" 中启动`);
    console.log('使用 "tmux attach -t remote-im-controller" 查看日志');
  } catch (error) {
    console.error('启动服务失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * 停止服务
 */
function stopService(): void {
  console.log('停止 Remote IM Controller...');
  
  if (!sessionExists(TMUX_SESSION_NAME)) {
    console.log('服务未运行');
    return;
  }
  
  try {
    execSync(`tmux send-keys -t ${TMUX_SESSION_NAME} C-c`, { stdio: 'inherit' });
    
    setTimeout(() => {
      try {
        execSync(`tmux kill-session -t ${TMUX_SESSION_NAME}`, { stdio: 'inherit' });
        console.log('服务已停止');
      } catch {
        console.log('会话已结束');
      }
    }, 1000);
  } catch (error) {
    console.error('停止服务失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * 执行 opencode plan 命令
 */
function runPlan(): void {
  console.log('执行 opencode plan...');
  
  try {
    const result = spawn('opencode', ['plan'], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    
    result.on('error', (error) => {
      console.error('执行 plan 失败:', error.message);
      process.exit(1);
    });
    
    result.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  } catch (error) {
    console.error('执行 plan 失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * 在 tmux 会话中执行命令
 */
function execCommand(command: string): void {
  if (!command) {
    console.error('错误: 缺少命令参数');
    console.log('用法: omo-bot exec <command>');
    process.exit(1);
  }
  
  if (!sessionExists(TMUX_SESSION_NAME)) {
    console.error('错误: 服务未运行');
    console.log('请先使用 "omo-bot start" 启动服务');
    process.exit(1);
  }
  
  try {
    execSync(`tmux send-keys -t ${TMUX_SESSION_NAME} ${escapeShellArg(command)} Enter`, {
      stdio: 'inherit'
    });
    console.log(`命令已发送: ${command}`);
  } catch (error) {
    console.error('执行命令失败:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
omo-bot - WSL 调度脚本

用法:
  omo-bot <command> [args]

命令:
  start           启动 Remote IM Controller 服务
  stop            停止服务
  plan            执行 opencode plan 命令
  exec <command>  在服务会话中执行命令
  help            显示此帮助信息

示例:
  omo-bot start                 # 启动服务
  omo-bot stop                  # 停止服务
  omo-bot plan                  # 执行 plan
  omo-bot exec "echo hello"     # 在会话中执行命令
  omo-bot exec "opencode run"   # 运行 opencode

环境变量:
  TMUX_SESSION_NAME  tmux 会话名称 (默认: remote-im-controller)
`);
}

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'start':
    startService();
    break;
  case 'stop':
    stopService();
    break;
  case 'plan':
    runPlan();
    break;
  case 'exec':
    execCommand(args[0] ?? '');
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    if (command) {
      console.error(`未知命令: ${command}`);
    }
    showHelp();
    process.exit(command ? 1 : 0);
}
