#!/usr/bin/env bun
/**
 * omo-bot.ts - OpenCode 远程调度脚本
 *
 * 运行环境: WSL/Linux
 * 前置条件: Bun, OpenCode CLI
 */

import { homedir } from 'os';
import { resolve, join } from 'path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, openSync, readdirSync } from 'fs';
import { execSync, spawn, spawnSync } from 'child_process';

// ============ 运行时常量 ============

const RUNTIME_DIR = resolve(homedir(), '.omo_runtime');
const PID_FILE = resolve(RUNTIME_DIR, 'omo_server.pid');
const LOG_FILE = resolve(RUNTIME_DIR, 'omo_server.log');
const SERVER_URL = 'http://127.0.0.1:4096';

// chatId 隔离：通过环境变量传入，默认为 "default"
const chatId = process.env.OMO_CHAT_ID || 'default';
const SESSION_FILE = resolve(RUNTIME_DIR, `${chatId}.session`);

// 模式前缀
const MODE_PREFIXES: Record<string, string> = {
  plan: '【仅规划】请仅输出计划，不要修改代码：',
  deep: '【深度研究】请深入分析：',
  explore: '【只读探索】请只读取和分析，不要修改代码：',
};

// ============ 工具函数 ============

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
 */
function checkDependencies(): void {
  const missing: string[] = [];

  try {
    execSync('which bun', { stdio: 'ignore' });
  } catch (err) {
    console.error('[checkDependencies] bun check failed:', err);
    missing.push('bun');
  }

  try {
    execSync('which opencode', { stdio: 'ignore' });
  } catch (err) {
    console.error('[checkDependencies] opencode check failed:', err);
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
 */
function readPidFile(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch (err) {
    console.error('[readPidFile] failed:', err);
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
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 创建新会话（通过 Server API）
 */
async function createSession(): Promise<string> {
  try {
    const res = await fetch(`${SERVER_URL}/session`, { method: 'POST' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as { id: string };
    ensureRuntimeDir();
    writeFileSync(SESSION_FILE, data.id, 'utf-8');
    console.log(`[new] 创建会话: ${data.id}`);
    return data.id;
  } catch (err) {
    console.error('\n❌ 错误: 无法创建会话');
    console.error(`  服务是否运行? 执行: omo start\n`);
    throw err;
  }
}

/**
 * 获取当前会话 ID
 */
function getSessionId(): string | null {
  if (!existsSync(SESSION_FILE)) {
    return null;
  }
  try {
    return readFileSync(SESSION_FILE, 'utf-8').trim() || null;
  } catch (err) {
    console.error('[getSessionId] failed:', err);
    return null;
  }
}

/**
 * 清理所有 session 文件
 */
function clearSessions(): void {
  if (!existsSync(RUNTIME_DIR)) return;
  const files = readdirSync(RUNTIME_DIR);
  let count = 0;
  for (const file of files) {
    if (file.endsWith('.session')) {
      unlinkSync(join(RUNTIME_DIR, file));
      count++;
    }
  }
  if (count > 0) {
    console.log(`[stop] 清理 ${count} 个 session 文件`);
  }
}

/**
 * 执行 prompt（通过 opencode run -s）
 */
function runPrompt(sessionId: string, prompt: string, mode?: string): void {
  const finalPrompt = mode && MODE_PREFIXES[mode] ? MODE_PREFIXES[mode] + prompt : prompt;

  console.log(`[${mode || 'exec'}] 发送 prompt...`);

  const result = spawnSync(
    'opencode',
    ['run', '-s', sessionId, finalPrompt],
    { stdio: 'inherit', encoding: 'utf-8' }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// ============ 命令处理 ============

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
 */
function stopService(): void {
  const pid = readPidFile();

  if (pid === null) {
    console.log('[stop] omo-server 未运行');
    clearSessions();
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log('[stop] 服务未运行（已清理过期 PID）');
    removePidFile();
    clearSessions();
    return;
  }

  const result = spawnSync('pkill', ['-TERM', '-f', '\\.opencode serve'], {
    timeout: 5000,
    stdio: 'ignore',
  });

  removePidFile();
  clearSessions();

  if (result.status === 0) {
    console.log('[stop] omo-server 已停止');
  } else if (result.status === 1) {
    console.log('[stop] 没有找到匹配的进程');
  } else if (result.signal) {
    console.log('[stop] pkill 被信号终止:', result.signal);
  } else {
    console.log('[stop] pkill 异常退出，code:', result.status);
  }
}

/**
 * 处理 new 命令
 */
async function handleNew(args: string[]): Promise<void> {
  checkDependencies();

  // 检查 serve 是否运行
  const pid = readPidFile();
  if (pid === null || !isProcessAlive(pid)) {
    console.error('\n❌ 错误: omo-server 未运行');
    console.error('  请先执行: omo start\n');
    process.exit(1);
  }

  // 检查 new:mode 格式
  const firstArg = args[0];
  if (firstArg?.startsWith('new:')) {
    const mode = firstArg.slice(4);
    if (!['exec', 'plan', 'deep', 'explore'].includes(mode)) {
      console.error(`\n❌ 错误: 未知模式 "${mode}"`);
      console.error('  可用模式: exec, plan, deep, explore\n');
      process.exit(1);
    }
    const prompt = args.slice(1).join(' ');
    if (!prompt) {
      console.error('\n❌ 错误: 缺少 prompt 参数');
      console.error(`  用法: omo new:${mode} <prompt>\n`);
      process.exit(1);
    }
    const sessionId = await createSession();
    runPrompt(sessionId, prompt, mode === 'exec' ? undefined : mode);
  } else if (args.length > 0) {
    // new 后面有参数但不是 new:mode 格式
    console.error('\n❌ 错误: new 命令不能直接带 prompt');
    console.error('  使用以下命令创建会话并执行:');
    console.error('    omo new:exec <prompt>   创建会话并执行');
    console.error('    omo new:plan <prompt>   创建会话并规划');
    console.error('    omo new:deep <prompt>   创建会话并深度研究');
    console.error('    omo new:explore <prompt> 创建会话并只读探索\n');
    process.exit(1);
  } else {
    // 纯 new，只创建空会话
    await createSession();
    console.log('[new] 空会话已就绪，可执行 omo exec/plan/deep/explore');
  }
}

/**
 * 处理继续命令（exec/plan/deep/explore）
 */
async function handleContinue(command: string, args: string[]): Promise<void> {
  checkDependencies();

  // 检查 serve 是否运行
  const pid = readPidFile();
  if (pid === null || !isProcessAlive(pid)) {
    console.error('\n❌ 错误: omo-server 未运行');
    console.error('  请先执行: omo start\n');
    process.exit(1);
  }

  // 检查是否有活跃会话
  const sessionId = getSessionId();
  if (!sessionId) {
    console.error('\n❌ 错误: 没有活跃会话');
    console.error('  请先执行: omo new\n');
    process.exit(1);
  }

  // 获取 prompt
  const prompt = args.join(' ');
  if (!prompt) {
    console.error('\n❌ 错误: 缺少 prompt 参数');
    console.error(`  用法: omo ${command} <prompt>\n`);
    process.exit(1);
  }

  // 执行
  const mode = ['plan', 'deep', 'explore'].includes(command) ? command : undefined;
  runPrompt(sessionId, prompt, mode);
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
omo - OpenCode 远程调度工具

运行环境: WSL/Linux

前置条件:
  1. Bun 运行时
  2. OpenCode CLI

安装:
  npm run bi [name]      安装，默认 omo

改名:
  npm run br <name>      改名

卸载:
  npm run bu             卸载

命令:
  omo start                    启动 opencode serve
  omo stop                     停止服务并清理会话
  omo new                      创建新会话（空）
  omo new:exec <prompt>        创建会话并执行
  omo new:plan <prompt>        创建会话并规划
  omo new:deep <prompt>        创建会话并深度研究
  omo new:explore <prompt>     创建会话并只读探索
  omo exec <prompt>            继续当前会话并执行
  omo plan <prompt>            继续当前会话并规划
  omo deep <prompt>            继续当前会话并深度研究
  omo explore <prompt>         继续当前会话并只读探索

工作流程:
  omo start
  omo new:exec 修复登录bug
  omo exec 继续实现
  omo new
  omo plan 设计认证系统
  omo stop

路径说明:
  运行时目录: ${RUNTIME_DIR}
  PID 文件:   ${PID_FILE}
  日志文件:   ${LOG_FILE}
  服务地址:   ${SERVER_URL}
  会话文件:   ${SESSION_FILE}
`);
}

// ============ 主入口 ============

async function main(): Promise<void> {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  if (!command) {
    showHelp();
    process.exit(0);
  }

  switch (command) {
    case 'start':
      startService();
      break;
    case 'stop':
      stopService();
      break;
    case 'new':
      await handleNew(args);
      break;
    case 'exec':
    case 'plan':
    case 'deep':
    case 'explore':
      await handleContinue(command, args);
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.error(`\n❌ 未知命令: ${command}\n`);
      showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('执行失败:', err);
  process.exit(1);
});
