/**
 * Remote IM Controller - 流式推送会话模块
 */

import { cleanTerminalOutput } from './utils/terminal_cleaner.js';
import { toError } from './utils/misc.js';
import { createLogger } from './logger.js';
import type { SessionOutputManager } from './session_output_manager.js';
import type { MarkerDetector } from './types.js';

const logger = createLogger('streaming_session');

/** 飞书消息更新最小间隔 (ms) — 区别于 config.streamPushIntervalMs（文件轮询间隔） */
const UPDATE_INTERVAL_MS = 5000;
/** 触发更新的最小累积字节数 */
const UPDATE_SIZE_THRESHOLD = 1024;
/** 单条消息输出截断上限 */
const MAX_OUTPUT_SIZE = 8 * 1024;

export interface StreamingSessionDeps {
  chatId: string;
  sessionName: string;
  sendMessage: (chatId: string, message: string) => Promise<string | null>;
  updateMessage: (chatId: string, messageId: string, message: string) => Promise<void>;
}

export function createStreamingSession(deps: StreamingSessionDeps): { run: (outputManager: SessionOutputManager, markerDetector: MarkerDetector, intervalMs: number) => Promise<void> } {
  const { chatId, sendMessage, updateMessage } = deps;

  let accumulatedOutput = '';
  let messageId: string | null = null;
  let lastUpdateTime = Date.now();

  async function handleChunk(chunk: string): Promise<void> {
    accumulatedOutput += chunk;
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTime;
    const outputSize = accumulatedOutput.length;

    if (outputSize > 0 && (timeSinceLastUpdate >= UPDATE_INTERVAL_MS || outputSize >= UPDATE_SIZE_THRESHOLD)) {
      let outputToSend = accumulatedOutput;
      if (outputToSend.length > MAX_OUTPUT_SIZE) {
        outputToSend = outputToSend.slice(-MAX_OUTPUT_SIZE);
        logger.warn('handleChunk', '输出超过 8KB，已截断', { originalSize: outputSize });
      }

      const cleanedOutput = cleanTerminalOutput(outputToSend);

      if (messageId) {
        try {
          await updateMessage(chatId, messageId, `\`\`\`\n${cleanedOutput}\n\`\`\``);
        } catch (error) {
          logger.warn('handleChunk', '消息更新失败（可能触发频控）', { error: toError(error).message });
        }
      } else {
        messageId = await sendMessage(chatId, `\`\`\`\n${cleanedOutput}\n\`\`\``);
      }
      lastUpdateTime = now;
    }

    logger.debug('handleChunk', '流式推送 chunk', { chunkLength: chunk.length });
  }

  async function handleComplete(): Promise<void> {
    if (accumulatedOutput) {
        let finalOutput = accumulatedOutput;
        if (finalOutput.length > MAX_OUTPUT_SIZE) {
          finalOutput = finalOutput.slice(-MAX_OUTPUT_SIZE);
          logger.warn('handleComplete', '最终输出超过 8KB，已截断', { originalSize: accumulatedOutput.length });
        }
        const cleanedOutput = cleanTerminalOutput(finalOutput);
        const finalMessage = `\`\`\`\n${cleanedOutput}\n\`\`\`\n\n✅ 命令执行完成`;

        if (messageId) {
          try {
            await updateMessage(chatId, messageId, finalMessage);
          } catch (error) {
            logger.warn('handleComplete', '最终消息更新失败', { error: toError(error).message });
          }
        } else {
          await sendMessage(chatId, finalMessage);
        }
      } else if (messageId) {
        try {
          await updateMessage(chatId, messageId, '✅ 命令执行完成（无输出）');
        } catch (error) {
          logger.warn('handleComplete', '无输出消息更新失败', { error: toError(error).message });
        }
      } else {
        await sendMessage(chatId, '✅ 命令执行完成（无输出）');
      }
  }

  async function run(outputManager: SessionOutputManager, markerDetector: MarkerDetector, intervalMs: number): Promise<void> {
    await outputManager.startStreaming(deps.sessionName, {
      intervalMs,
      onChunk: handleChunk,
      markerDetector,
    });
    await handleComplete();
  }

  return { run };
}
