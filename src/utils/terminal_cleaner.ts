/**
 * 终端输出清理工具
 * 
 * 清理终端输出中的控制序列，包括：
 * 1. OSC 序列 (\x1b]...)：设置窗口标题、超链接等
 * 2. 私有模式序列 (\x1b[?...)：如 bracket paste mode
 * 3. CSI 序列 (\x1b[...)：颜色、光标移动等
 * 4. 退格符 (\x08)：模拟退格删除
 * 5. 回车符 (\r)：换行处理
 * 6. 其他控制字符
 */

import stripAnsi from 'strip-ansi';

/**
 * 清理终端输出中的控制序列
 * @param output 厝始终端输出
 * @returns 清理后的输出
 */
export function cleanTerminalOutput(output: string): string {
  let result = output;
  
  // 1. 先处理 OSC 序列（必须在 stripAnsi 之前）
  // OSC 格式：\x1b] <command> ; <param> \x07 或 \x1b\\
  result = result.replace(/\x1b\][^\x07]*\x07/g, '');
  result = result.replace(/\x1b\][^\x1b]*\x1b\\/g, '');
  result = result.replace(/\x1bk[^\x1b]*\x1b\\/g, '');
  
  // 2. 处理私有模式序列（必须在 stripAnsi 之前，因为可能有或没有 \x1b 前缀）
  result = result.replace(/\x1b\[\?[0-9;]*[hl]/g, '');
  result = result.replace(/\[\?[0-9;]*[hl]/g, '');
  
  // 3. 处理其他控制字符（必须在 stripAnsi 之前）
  result = result.replace(/\x1b[=>]/g, '');  // \x1b= 和 \x1b>
  result = result.replace(/\x1b\[[0-9;]*[JK]/g, '');  // 清屏序列
  
  // 4. 使用 strip-ansi 处理标准 ANSI 序列
  result = stripAnsi(result);
  
  // 5. 处理退格符（删除前一个字符）
  while (result.includes('\x08')) {
    result = result.replace(/[^\x08]\x08/g, '');
  }
  result = result.replace(/\x08+/g, '');
  
  // 6. 处理回车符（移除所有 \r）
  result = result.replace(/\r/g, '');
  
  return result;
}
