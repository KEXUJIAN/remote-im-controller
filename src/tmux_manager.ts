/**
 * Remote IM Controller - tmux 管理模块
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { resolve } from 'path';
import stripAnsi from 'strip-ansi';
import { createLogger } from './logger.js';
import { createSessionOutputManager, type SessionOutputManager } from './session_output_manager.js';
import type { TmuxCaptureResult } from './types.js';
import { TmuxNotAvailableError, SessionNotFoundError } from './errors.js';
import { toErrorMessage } from './utils/misc.js';

const logger = createLogger('tmux_manager');

export interface TmuxManager {
  checkAvailable(): Promise<void>;
  createSession(name: string): Promise<void>;
  killSession(name: string): Promise<void>;
  listSessions(): Promise<string[]>;
  sendCommand(name: string, cmd: string): Promise<void>;
  captureScreen(name: string, lines?: number): Promise<TmuxCaptureResult>;
  sessionExists(name: string): Promise<boolean>;
  getPaneCommand(name: string): Promise<string>;
  getPipeLogPath(name: string): string | undefined;
  getOutputManager(): SessionOutputManager;
  recoverSessions(sessionData: Record<string, { logPath: string }>): Promise<string[]>;
  getActivePipes(): Record<string, string>;
}

export async function ensureSessionExists(
  tmuxManager: TmuxManager,
  sessionName: string
): Promise<void> {
  const exists = await tmuxManager.sessionExists(sessionName);
  if (!exists) {
    const sessions = await tmuxManager.listSessions();
    throw new SessionNotFoundError(sessionName, sessions);
  }
}

function toInternalName(sessionName: string, instanceId: string): string {
  return `${instanceId}-${sessionName}`;
}

function toExternalName(internalName: string, instanceId: string): string {
  const prefix = `${instanceId}-`;
  return internalName.startsWith(prefix) ? internalName.slice(prefix.length) : internalName;
}

export function createTmuxManager(
  defaultLines: number,
  debug: boolean = false,
  streamLogDir: string = './logs/stream/',
  instanceId: string = 'cli'
): TmuxManager {
  const debugArgs = debug ? ['-v', '-v'] : [];
  const tmuxTmpDir = process.env.TMUX_TMPDIR || process.env.LOG_DIR || './logs';
  const activePipes = new Map<string, string>();
  
  const outputManager = createSessionOutputManager({
    getLogPath: (externalName: string) => {
      const internalName = toInternalName(externalName, instanceId);
      return activePipes.get(internalName);
    },
  });

  function buildTmuxArgs(args: string[]): string[] {
    return [...debugArgs, ...args];
  }

  function buildSpawnOptions() {
    return {
      stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
      cwd: debug ? tmuxTmpDir : undefined,
      env: { ...process.env },
    };
  }

  function createProcessError(err: unknown, args: string[]): Error {
    const error = new Error(`tmux command failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    error.cause = err;
    logger.error('exec', `tmux command error: ${args.join(' ')}`, error);
    return error;
  }

  function createExitError(code: number | null, stderr: string, args: string[]): Error {
    const error = new Error(`tmux command exited with code ${code}: ${stderr.trim() || 'no error message'}`);
    logger.error('exec', `tmux command failed: tmux ${args.join(' ')}`, error, { exitCode: code, stderr: stderr.trim() });
    return error;
  }

  function execTmux(args: string[]): Promise<string> {
    return new Promise((res, reject) => {
      const proc = spawn('tmux', buildTmuxArgs(args), buildSpawnOptions());

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (err) => {
        reject(createProcessError(err, args));
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(createExitError(code, stderr, args));
          return;
        }
        logger.debug('exec', `tmux command succeeded: tmux ${args.join(' ')}`, { stdoutLength: stdout.length });
        res(stdout);
      });
    });
  }

  async function setupPipePane(internalName: string): Promise<void> {
    logger.debug('setupPipePane', `设置 pipe-pane: ${internalName}`);
    
    await execTmux(['pipe-pane', '-t', internalName]);
    
    const absoluteStreamLogDir = resolve(streamLogDir);
    await mkdir(absoluteStreamLogDir, { recursive: true });
    
    const logFilePath = `${absoluteStreamLogDir}/${internalName}.log`;
    await writeFile(logFilePath, '');
    
    await execTmux(['pipe-pane', '-o', '-t', internalName, `exec cat >> '${logFilePath}'`]);
    
    await new Promise((r) => setTimeout(r, 50));
    
    activePipes.set(internalName, logFilePath);
    logger.info('setupPipePane', `pipe-pane 已启动: ${internalName}`, { logFilePath });
  }

  async function teardownPipePane(internalName: string): Promise<void> {
    logger.debug('teardownPipePane', `停止 pipe-pane: ${internalName}`);
    
    const logFilePath = activePipes.get(internalName);
    
    await execTmux(['pipe-pane', '-t', internalName]).catch((err) => {
      const errMsg = toErrorMessage(err);
      logger.debug('teardownPipePane', `停止 pipe-pane 时出错（可能已停止）: ${errMsg}`);
    });
    
    activePipes.delete(internalName);
    
    if (logFilePath) {
      await unlink(logFilePath).catch((err) => {
        const errMsg = toErrorMessage(err);
        logger.debug('teardownPipePane', `删除日志文件时出错（可能已删除）: ${errMsg}`);
      });
      logger.info('teardownPipePane', `pipe-pane 已停止: ${internalName}`, { logFilePath });
    }
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
      const internalName = toInternalName(name, instanceId);
      logger.info('createSession', `创建 tmux 会话: ${name} (内部: ${internalName})`);
      try {
        await execTmux(['new-session', '-d', '-s', internalName]);
        await setupPipePane(internalName);
        
        const shell = process.env.SHELL || '/bin/zsh';

        if (shell.includes('bash')) {
          const ps1Command = `export PS1=$'\\e]99;CMD_END\\a$ '`;
          await execTmux(['send-keys', '-t', internalName, ps1Command, 'C-m']);
          logger.debug('createSession', `注入 PS1 标记 (bash)`, { shell, ps1Command });
        } else {
          await execTmux(['send-keys', '-t', internalName, 'unset zle_bracket_paste', 'C-m']);
          const ps1Command = `export PS1=$'%{%f%b%k%}\\e]99;CMD_END\\a%# '`;
          await execTmux(['send-keys', '-t', internalName, ps1Command, 'C-m']);
          logger.debug('createSession', `注入 PS1 标记 (zsh)`, { shell, ps1Command });
        }
        
        outputManager.initOffset(name);
        logger.info('createSession', `会话创建成功: ${name}`);
      } catch (err) {
        logger.error('createSession', `创建会话失败: ${name}`, err);
        throw err;
      }
    },

    async killSession(name: string): Promise<void> {
      const internalName = toInternalName(name, instanceId);
      logger.info('killSession', `终止 tmux 会话: ${name} (内部: ${internalName})`);
      try {
        await teardownPipePane(internalName);
        outputManager.clearOffset(name);
        await execTmux(['kill-session', '-t', internalName]);
        logger.info('killSession', `会话已终止: ${name}`);
      } catch (err) {
        logger.error('killSession', `终止会话失败: ${name}`, err);
        throw err;
      }
    },

    async listSessions(): Promise<string[]> {
      logger.debug('listSessions', '列出所有 tmux 会话');
      try {
        const output = await execTmux(['list-sessions', '-F', '#{session_name}']);
        const allSessions = output.trim().split('\n').filter((line) => line.length > 0);
        
        const prefix = `${instanceId}-`;
        const mySessions = allSessions
          .filter(s => s.startsWith(prefix))
          .map(s => toExternalName(s, instanceId));
        
        logger.debug('listSessions', `找到 ${mySessions.length} 个本实例会话`, { 
          allSessions, 
          mySessions 
        });
        return mySessions;
      } catch (err) {
        const errMsg = toErrorMessage(err);
        if (errMsg.includes('no sessions') || errMsg.includes('error connecting to') || errMsg.includes('no server running')) {
          logger.debug('listSessions', '没有找到任何会话或服务器未启动');
          return [];
        }
        logger.error('listSessions', '列出会话失败', err);
        throw err;
      }
    },

    async sendCommand(name: string, cmd: string): Promise<void> {
      const internalName = toInternalName(name, instanceId);
      logger.info('sendCommand', `向会话 ${name} 发送命令`, { command: cmd });
      try {
        await execTmux(['send-keys', '-t', internalName, cmd, 'C-m']);
        logger.debug('sendCommand', `命令已发送: ${cmd}`);
      } catch (err) {
        logger.error('sendCommand', `发送命令失败: ${cmd}`, err, { session: name });
        throw err;
      }
    },

    async captureScreen(name: string, lines?: number): Promise<TmuxCaptureResult> {
      const internalName = toInternalName(name, instanceId);
      const lineCount = lines ?? defaultLines;
      logger.debug('captureScreen', `抓取会话 ${name} 的屏幕输出`, { lines: lineCount });
      try {
        const raw = await execTmux(['capture-pane', '-p', '-t', internalName, '-S', `-${lineCount}`]);
        const cleaned = stripAnsi(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const hash = createHash('md5').update(cleaned).digest('hex');
        const result: TmuxCaptureResult = { raw, cleaned, lines: cleaned.split('\n').length, hash };
        logger.debug('captureScreen', `抓取成功`, { rawLength: raw.length, cleanedLength: cleaned.length, lines: result.lines, hash });
        return result;
      } catch (err) {
        logger.error('captureScreen', `抓取屏幕失败`, err, { session: name });
        throw err;
      }
    },

    async sessionExists(name: string): Promise<boolean> {
      const internalName = toInternalName(name, instanceId);
      logger.debug('sessionExists', `检查会话是否存在: ${name} (内部: ${internalName})`);
      const sessions = await this.listSessions();
      const exists = sessions.includes(name);
      logger.debug('sessionExists', `会话 ${name} ${exists ? '存在' : '不存在'}`);
      return exists;
    },

    async getPaneCommand(name: string): Promise<string> {
      const internalName = toInternalName(name, instanceId);
      logger.debug('getPaneCommand', `获取会话当前命令: ${name}`);
      try {
        const output = await execTmux(['list-panes', '-t', internalName, '-F', '#{pane_current_command}']);
        const command = output.trim();
        logger.debug('getPaneCommand', `会话 ${name} 当前命令: ${command}`);
        return command;
      } catch {
        logger.debug('getPaneCommand', `获取会话命令失败，会话可能不存在: ${name}`);
        return '';
      }
    },

    getPipeLogPath(name: string): string | undefined {
      const internalName = toInternalName(name, instanceId);
      return activePipes.get(internalName);
    },

    getOutputManager(): SessionOutputManager {
      return outputManager;
    },

    async recoverSessions(sessionData: Record<string, { logPath: string }>): Promise<string[]> {
      const recovered: string[] = [];
      const output = await execTmux(['list-sessions', '-F', '#{session_name}']).catch(() => '');
      const existingSessions = output.trim().split('\n').filter((line) => line.length > 0);

      for (const [externalName, data] of Object.entries(sessionData)) {
        const internalName = toInternalName(externalName, instanceId);
        
        if (!existingSessions.includes(internalName)) {
          logger.info('recoverSessions', `会话已不存在: ${externalName}`);
          continue;
        }

        if (!existsSync(data.logPath)) {
          logger.warn('recoverSessions', `日志文件不存在: ${data.logPath}`);
        }

        activePipes.set(internalName, data.logPath);
        outputManager.initOffset(externalName);
        recovered.push(externalName);
        logger.info('recoverSessions', `会话恢复: ${externalName}`, { logPath: data.logPath });
      }

      return recovered;
    },

    getActivePipes(): Record<string, string> {
      const result: Record<string, string> = {};
      for (const [internalName, path] of activePipes.entries()) {
        const externalName = toExternalName(internalName, instanceId);
        result[externalName] = path;
      }
      return result;
    },
  };
}
