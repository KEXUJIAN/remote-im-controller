import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createLogger } from './logger.js';
import type { TmuxCaptureResult } from './types.js';
import { TmuxNotAvailableError } from './types.js';

const logger = createLogger('tmux_manager');

export interface TmuxManager {
  checkAvailable(): Promise<void>;
  createSession(name: string): Promise<void>;
  killSession(name: string): Promise<void>;
  listSessions(): Promise<string[]>;
  sendCommand(name: string, cmd: string): Promise<void>;
  captureScreen(name: string, lines?: number): Promise<TmuxCaptureResult>;
  sessionExists(name: string): Promise<boolean>;
}

function cleanOutput(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()(AB012]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function createTmuxManager(defaultLines: number, debug: boolean = false): TmuxManager {
  const debugArgs = debug ? ['-v', '-v'] : [];

  function execTmux(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tmux', [...debugArgs, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (err) => {
        const error = new Error(`tmux command failed: ${err.message}`);
        error.cause = err;
        logger.error('exec', `tmux command error: ${args.join(' ')}`, error);
        reject(error);
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          const error = new Error(`tmux command exited with code ${code}: ${stderr.trim() || 'no error message'}`);
          logger.error('exec', `tmux command failed: tmux ${args.join(' ')}`, error, { exitCode: code, stderr: stderr.trim() });
          reject(error);
          return;
        }
        logger.debug('exec', `tmux command succeeded: tmux ${args.join(' ')}`, { stdoutLength: stdout.length });
        resolve(stdout);
      });
    });
  }

  return {
    async checkAvailable(): Promise<void> {
      logger.info('checkAvailable', '检查 tmux 是否可用');
      try {
        const output = await execTmux(['-V']);
        logger.info('checkAvailable', `tmux 可用: ${output.trim()}`);
      } catch (err) {
        const error = new TmuxNotAvailableError(err instanceof Error ? err.message : 'unknown error');
        logger.error('checkAvailable', 'tmux 不可用', error);
        throw error;
      }
    },

    async createSession(name: string): Promise<void> {
      logger.info('createSession', `创建 tmux 会话: ${name}`);
      try {
        await execTmux(['new-session', '-d', '-s', name]);
        logger.info('createSession', `会话创建成功: ${name}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('createSession', `创建会话失败: ${name}`, error);
        throw error;
      }
    },

    async killSession(name: string): Promise<void> {
      logger.info('killSession', `终止 tmux 会话: ${name}`);
      try {
        await execTmux(['kill-session', '-t', name]);
        logger.info('killSession', `会话已终止: ${name}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('killSession', `终止会话失败: ${name}`, error);
        throw error;
      }
    },

    async listSessions(): Promise<string[]> {
      logger.debug('listSessions', '列出所有 tmux 会话');
      try {
        const output = await execTmux(['list-sessions', '-F', '#{session_name}']);
        const sessions = output.trim().split('\n').filter((line) => line.length > 0);
        logger.debug('listSessions', `找到 ${sessions.length} 个会话`, { sessions });
        return sessions;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('no sessions') || errMsg.includes('error connecting to') || errMsg.includes('no server running')) {
          logger.debug('listSessions', '没有找到任何会话或服务器未启动');
          return [];
        }
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('listSessions', '列出会话失败', error);
        throw error;
      }
    },

    async sendCommand(name: string, cmd: string): Promise<void> {
      logger.info('sendCommand', `向会话 ${name} 发送命令`, { command: cmd });
      try {
        await execTmux(['send-keys', '-t', name, cmd, 'C-m']);
        logger.debug('sendCommand', `命令已发送: ${cmd}`);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('sendCommand', `发送命令失败: ${cmd}`, error, { session: name });
        throw error;
      }
    },

    async captureScreen(name: string, lines?: number): Promise<TmuxCaptureResult> {
      const lineCount = lines ?? defaultLines;
      logger.debug('captureScreen', `抓取会话 ${name} 的屏幕输出`, { lines: lineCount });
      try {
        const raw = await execTmux(['capture-pane', '-p', '-t', name, '-S', `-${lineCount}`]);
        const cleaned = cleanOutput(raw);
        const hash = createHash('md5').update(cleaned).digest('hex');
        const result: TmuxCaptureResult = { raw, cleaned, lines: cleaned.split('\n').length, hash };
        logger.debug('captureScreen', `抓取成功`, { rawLength: raw.length, cleanedLength: cleaned.length, lines: result.lines, hash });
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error('captureScreen', `抓取屏幕失败`, error, { session: name });
        throw error;
      }
    },

    async sessionExists(name: string): Promise<boolean> {
      logger.debug('sessionExists', `检查会话是否存在: ${name}`);
      const sessions = await this.listSessions();
      const exists = sessions.includes(name);
      logger.debug('sessionExists', `会话 ${name} ${exists ? '存在' : '不存在'}`);
      return exists;
    },
  };
}

if (process.argv[2] === 'test') {
  import('fs').then(({ mkdirSync }) => {
    process.env.TMUX_TMPDIR = process.env.TMUX_TMPDIR || process.env.LOG_DIR || './logs';
    mkdirSync(process.env.TMUX_TMPDIR, { recursive: true });
  });

  const debug = process.env.TMUX_DEBUG === 'true';
  const manager = createTmuxManager(50, debug);

  const runTests = async () => {
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

    console.log(`5. 向会话 "${testSessionName}" 发送命令 "echo hello"...`);
    try {
      await manager.sendCommand(testSessionName, 'echo hello');
      await new Promise((r) => setTimeout(r, 500));
      console.log('   ✓ 命令发送成功\n');
    } catch (err) {
      console.log('   ✗ 发送失败:', err instanceof Error ? err.message : err);
    }

    console.log(`6. 抓取会话 "${testSessionName}" 的屏幕...`);
    try {
      const result = await manager.captureScreen(testSessionName, 10);
      console.log(`   ✓ 抓取成功 (${result.lines} 行, hash: ${result.hash.slice(0, 8)}...)`);
      console.log('   输出预览:');
      result.cleaned.split('\n').slice(0, 5).forEach((line) => console.log(`     | ${line}`));
      console.log();
    } catch (err) {
      console.log('   ✗ 抓取失败:', err instanceof Error ? err.message : err);
    }

    console.log(`7. 终止测试会话 "${testSessionName}"...`);
    console.log('   等待 3 秒，可在另一个终端 attach 观察...');
    await new Promise((r) => setTimeout(r, 3000));
    try {
      await manager.killSession(testSessionName);
      console.log('   ✓ 会话已终止\n');
    } catch (err) {
      console.log('   ✗ 终止失败:', err instanceof Error ? err.message : err);
    }

    console.log(`8. 确认会话 "${testSessionName}" 已不存在...`);
    const stillExists = await manager.sessionExists(testSessionName);
    console.log(`   ${!stillExists ? '✓ 已删除' : '✗ 仍存在'}\n`);

    console.log('=== 所有测试完成 ===');
  };

  runTests().catch((err) => {
    console.error('测试失败:', err);
    process.exit(1);
  });
}
