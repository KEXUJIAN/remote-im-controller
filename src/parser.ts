/**
 * Remote IM Controller - 文本清洗模块
 */

import { createHash } from 'crypto';
import stripAnsi from 'strip-ansi';
import { createLogger } from './logger.js';

const logger = createLogger('parser');

/** Parser 接口定义 */
export interface Parser {
  cleanOutput(raw: string, maxLines?: number): string;
  removeAnsi(text: string): string;
  filterEmptyLines(text: string): string;
  removePrompt(text: string): string;
  hasPrompt(text: string): boolean;
  extractLastCommandOutput(text: string): string;
  generateHash(text: string): string;
}

/** 匹配常见 shell 提示符的正则表达式 */
const PROMPT_PATTERN = /(?:@[\w.-]+:[^$\n]*)?[$#❯>]\s*$|➜.*\S$/;

/**
 * 创建 Parser 实例
 */
export function createParser(): Parser {
  /**
   * 移除 ANSI 颜色代码
   */
  function removeAnsi(text: string): string {
    return stripAnsi(text);
  }

  /**
   * 过滤连续空行，最多保留 1 个
   */
  function filterEmptyLines(text: string): string {
    const lines = text.split('\n');
    const result: string[] = [];
    let prevEmpty = false;

    for (const line of lines) {
      const isEmpty = line.trim() === '';
      if (isEmpty) {
        if (!prevEmpty) {
          result.push(line);
        }
        prevEmpty = true;
      } else {
        result.push(line);
        prevEmpty = false;
      }
    }

    return result.join('\n');
  }

  /**
   * 移除末尾 bash/zsh 提示符
   * 匹配模式如 `username@hostname:~$` 或 `user@host:~$`
   */
  function removePrompt(text: string): string {
    return text.replace(PROMPT_PATTERN, '');
  }

  function hasPrompt(text: string): boolean {
    return PROMPT_PATTERN.test(text.trim());
  }

  function extractLastCommandOutput(text: string): string {
    const lines = text.split('\n');
    const promptIndices: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && PROMPT_PATTERN.test(line.trim())) {
        promptIndices.push(i);
      }
    }

    if (promptIndices.length < 2) {
      return text.trim();
    }

    const secondLastIdx = promptIndices.at(-2);
    const lastIdx = promptIndices.at(-1);

    if (secondLastIdx === undefined || lastIdx === undefined) {
      return text.trim();
    }

    return lines.slice(secondLastIdx + 1, lastIdx).join('\n').trim();
  }

  /**
   * 清洗原始输出
   * 按顺序调用: removeAnsi → filterEmptyLines → removePrompt
   * 截取最后 N 行（默认 50）
   */
  function cleanOutput(raw: string, maxLines: number = 50): string {
    logger.debug('cleanOutput', '开始清洗输出', {
      inputLength: raw.length,
      maxLines,
    });

    let result = removeAnsi(raw);
    result = filterEmptyLines(result);
    result = removePrompt(result);

    const lines = result.split('\n');
    if (lines.length > maxLines) {
      result = lines.slice(-maxLines).join('\n');
      logger.debug('cleanOutput', '输出已截断', {
        originalLines: lines.length,
        maxLines,
      });
    }

    logger.debug('cleanOutput', '清洗完成', {
      outputLength: result.length,
    });

    return result;
  }

  function generateHash(text: string): string {
    return createHash('md5').update(text).digest('hex');
  }

  return {
    cleanOutput,
    removeAnsi,
    filterEmptyLines,
    removePrompt,
    hasPrompt,
    extractLastCommandOutput,
    generateHash,
  };
}

if (process.argv[2] === 'test') {
  const parser = createParser();

  console.log('=== Parser 模块测试 ===\n');

  const ansiText = '\x1b[31m红色文字\x1b[0m 普通文字 \x1b[1m粗体\x1b[0m';
  console.log('1. removeAnsi 测试:');
  console.log('   输入:', JSON.stringify(ansiText));
  console.log('   输出:', parser.removeAnsi(ansiText));
  console.log();

  const emptyLinesText = '第一行\n\n\n\n第二行\n\n\n第三行\n\n';
  console.log('2. filterEmptyLines 测试:');
  console.log('   输入:', JSON.stringify(emptyLinesText));
  console.log('   输出:', JSON.stringify(parser.filterEmptyLines(emptyLinesText)));
  console.log();

  const promptText = '命令输出结果\nuser@hostname:~$ ';
  console.log('3. removePrompt 测试:');
  console.log('   输入:', JSON.stringify(promptText));
  console.log('   输出:', JSON.stringify(parser.removePrompt(promptText)));
  console.log();

  const hasPromptText1 = '命令输出\nuser@host:~$ ';
  const hasPromptText2 = '命令输出';
  console.log('4. hasPrompt 测试:');
  console.log('   输入 1:', JSON.stringify(hasPromptText1));
  console.log('   结果:', parser.hasPrompt(hasPromptText1));
  console.log('   输入 2:', JSON.stringify(hasPromptText2));
  console.log('   结果:', parser.hasPrompt(hasPromptText2));
  console.log();

  const extractText = 'line1\nuser@host:~$ command\noutput line\nuser@host:~$ ';
  console.log('5. extractLastCommandOutput 测试:');
  console.log('   输入:', JSON.stringify(extractText));
  console.log('   输出:', JSON.stringify(parser.extractLastCommandOutput(extractText)));
  console.log();

  const hashInput = '测试内容';
  console.log('6. generateHash 测试:');
  console.log('   输入:', hashInput);
  console.log('   哈希:', parser.generateHash(hashInput));
  console.log();

  const rawOutput = '\x1b[32m成功\x1b[0m\n\n\n\n其他输出\nuser@host:~$ ';
  console.log('7. cleanOutput 测试 (maxLines=10):');
  console.log('   输入:', JSON.stringify(rawOutput));
  console.log('   输出:', JSON.stringify(parser.cleanOutput(rawOutput, 10)));
  console.log();

  console.log('=== 测试完成 ===');
}
