#!/usr/bin/env bun
/**
 * omo-bot.ts - OpenCode 远程调度脚本
 *
 * 运行环境: WSL/Linux
 * 前置条件: Bun, OpenCode CLI
 */

import { homedir } from 'os';
import { resolve } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, openSync } from 'fs';
import { execSync, spawn } from 'child_process';

// 运行时常量
const RUNTIME_DIR = resolve(homedir(), '.omo_runtime');
const PID_FILE = resolve(RUNTIME_DIR, 'omo_server.pid');
const LOG_FILE = resolve(RUNTIME_DIR, 'omo_server.log');
const SERVER_URL = 'http://127.0.0.1:4096';

/**
 * 确保运行时目录存在
 */
function ensureRuntimeDir(): void {
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    console.log(`[runtime] 创建目录: ${RUNTIME_DIR}`);
  }
}

/**
 * 检查依赖命令是否可用
 * - bun: Bun 运行时
 * - opencode: OpenCode CLI
 */
function checkDependencies(): void {
  const missing: string[] = [];
  
  try {
    execSync('which bun', { stdio: 'ignore' });
  } catch {
    missing.push('bun');
  }
  
  try {
    execSync('which opencode', { stdio: 'ignore' });
  } catch {
    missing.push('opencode');
  }
  
  if (missing.length > 0) {
    console.error('\n❌ 错误: 缺少必要依赖\n');
    for (const cmd of missing) {
      console.error(`  缺少: ${cmd}`);
      if (cmd === 'bun') {
        console.error('  安装: curl -fsSL https://bun.sh/install | bash');
        console.error('  验证: bun --version');
      } else if (cmd === 'opencode') {
        console.error('  安装: npm install -g opencode');
        console.error('  验证: opencode --version');
      }
    }
    console.error('\n💡 提示: 安装后请确保重新加载 shell 配置:');
    console.error('   source ~/.bashrc   # 或 ~/.zshrc');
    console.error('   验证: command -v <命令名>\n');
    process.exit(1);
  }
}

/**
 * 读取 PID 文件
 * @returns PID 数字，文件不存在或内容无效返回 null
 */
function readPidFile(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }
  
  try {
    const content = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * 写入 PID 到文件
 */
function writePidFile(pid: number): void {
  ensureRuntimeDir();
  writeFileSync(PID_FILE, String(pid), 'utf-8');
}

/**
 * 删除 PID 文件
 */
function removePidFile(): void {
  if (existsSync(PID_FILE)) {
    unlinkSync(PID_FILE);
  }
}

/**
 * 检查进程是否存活
 * @param pid 进程 ID
 * @returns true 表示进程存活，false 表示进程不存在
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 启动服务
 */
function startService(): void {
  checkDependencies();
  ensureRuntimeDir();
  
  const pid = readPidFile();
  if (pid !== null) {
    if (isProcessAlive(pid)) {
      console.log(`[start] omo-server 已在运行 (PID: ${pid})`);
      return;
    } else {
      console.log(`[start] 检测到 stale PID ${pid}，清理中...`);
      removePidFile();
    }
  }
  
  const logFd = openSync(LOG_FILE, 'a');
  
  const child = spawn('opencode', ['serve', '--port', '4096', '--hostname', '127.0.0.1'], {
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });
  
  child.unref();
  
  writePidFile(child.pid!);
  
  console.log(`[start] omo-server 已启动 (PID: ${child.pid})`);
  console.log(`  SERVER_URL: ${SERVER_URL}`);
  console.log(`  LOG_FILE: ${LOG_FILE}`);
}

/**
 * 停止服务
 * 
 * 使用 pkill 命令终止服务进程，而非 kill(-pid) 机制。
 * 
 * 为什么使用 pkill：
 * 1. opencode 是 Node.js 包装器，通过 spawnSync 启动实际二进制
 * 2. startService() 使用 detached: true，让包装器快速退出
 * 3. 子进程成为孤儿进程（PPID=1），不再属于原进程组
 * 4. kill(-pid) 需要进程组组长存在才能向组成员传递信号
 * 5. 孤儿进程的进程组可能已经不存在组长，导致 kill(-pid) 失效
 * 
 * pkill -f 通过进程名匹配，能可靠地找到并终止孤儿进程。
 */
function stopService(): void {
  const pid = readPidFile();
  
  if (pid === null) {
    console.log('[stop] omo-server 未运行');
    return;
  }
  
  if (!isProcessAlive(pid)) {
    console.log('[stop] 服务未运行（已清理过期 PID）');
    removePidFile();
    return;
  }
  
  console.log(`[stop] 正在停止 omo-server (PID: ${pid})...`);
  
  // -f 匹配完整命令行，确保精确匹配 opencode serve 进程
  try {
    // timeout: 2000 表示 2 秒后强制返回，不等待进程退出
    execSync('pkill -TERM -f "\\.opencode serve"', { stdio: 'ignore', timeout: 2000 });
    console.log('[stop] 已发送 SIGTERM 信号');
  } catch (err) {
    // 超时或没有匹配进程都忽略，后续 pgrep 会检查进程状态
    console.log('[stop] 已发送 SIGTERM 信号（或进程不存在）', err);
  }
  
  // 轮询等待进程退出
  let attempts = 0;
  const maxAttempts = 10;
  
  const interval = setInterval(() => {
    attempts++;
    
    try {
      execSync('pgrep -f "\\.opencode serve"', { stdio: 'ignore' });
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        try {
          execSync('pkill -KILL -f "\\.opencode serve"', { stdio: 'ignore' });
          console.log('[stop] omo-server 已强制停止 (SIGKILL)');
        } catch (err) {
          console.log('[stop] 进程已不存在', err);
        }
        removePidFile();
      }
    } catch (err) {
      // pgrep 返回非零表示进程已停止
      clearInterval(interval);
      removePidFile();
      console.log('[stop] omo-server 已停止', err);
    }
  }, 500);
}

/**
 * 执行 plan 命令
 * 映射: opencode run --agent prometheus --attach <url> <prompt>
 */
function runPlan(prompt: string): void {
  checkDependencies();
  
  if (!prompt || prompt.trim() === '') {
    console.error('\n❌ 错误: 缺少 prompt 参数\n');
    console.error('用法: omo-bot plan <自然语言>');
    console.error('示例: omo-bot plan 修复登录模块bug\n');
    process.exit(1);
  }
  
  const pid = readPidFile();
  if (pid === null || !isProcessAlive(pid)) {
    console.error('\n❌ 错误: omo-server 未运行\n');
    console.error('下一步: omo-bot start\n');
    process.exit(1);
  }
  
  console.log('[plan] 创建任务计划...');
  console.log(`  SERVER_URL: ${SERVER_URL}`);
  console.log(`  prompt: ${prompt}`);
  
  const child = spawn('opencode', [
    'run',
    '--agent', 'prometheus',
    '--attach', SERVER_URL,
    prompt
  ], {
    stdio: 'inherit'
  });
  
  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

/**
 * 执行 exec 命令
 * 映射: opencode run --agent sisyphus --attach <url> <prompt>
 */
function runExec(prompt: string): void {
  checkDependencies();
  
  if (!prompt || prompt.trim() === '') {
    console.error('\n❌ 错误: 缺少 prompt 参数\n');
    console.error('用法: omo-bot exec <自然语言>');
    console.error('示例: omo-bot exec 实现用户认证功能\n');
    process.exit(1);
  }
  
  const pid = readPidFile();
  if (pid === null || !isProcessAlive(pid)) {
    console.error('\n❌ 错误: omo-server 未运行\n');
    console.error('下一步: omo-bot start\n');
    process.exit(1);
  }
  
  console.log('[exec] 执行任务...');
  console.log(`  SERVER_URL: ${SERVER_URL}`);
  console.log(`  prompt: ${prompt}`);
  
  const child = spawn('opencode', [
    'run',
    '--agent', 'sisyphus',
    '--attach', SERVER_URL,
    prompt
  ], {
    stdio: 'inherit'
  });
  
  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
omo-bot - OpenCode 远程调度脚本

运行环境: WSL/Linux

前置条件:
  1. Bun 运行时
  2. OpenCode CLI
  3. ~/.local/bin 在 PATH 中（安装后验证：command -v omo-bot）

安装:
  npm run install-bot

  安装后会创建软链接:
    ~/.local/bin/omo-bot -> <项目>/scripts/omo-bot.ts

卸载:
  npm run uninstall-bot

用法:
  omo-bot <command> [args]

命令:
  start              启动 omo-server
  stop               停止 omo-server
  plan <自然语言>    创建任务计划 (prometheus)
  exec <自然语言>    执行任务 (sisyphus)
  help               显示此帮助信息

示例:
  omo-bot start
  omo-bot stop
  omo-bot plan 修复登录模块bug
  omo-bot exec 实现用户认证功能

路径说明:
  安装目录:    ~/.local/bin
  软链接:      ~/.local/bin/omo-bot
  运行时目录:  ${RUNTIME_DIR}
  PID 文件:    ${PID_FILE}
  日志文件:    ${LOG_FILE}
  服务地址:    ${SERVER_URL}
`);
}

// 主入口
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
    runPlan(args.join(' '));
    break;
  case 'exec':
    runExec(args.join(' '));
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
