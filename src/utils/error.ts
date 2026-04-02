/**
 * 错误处理工具函数
 */

/**
 * 将 unknown 类型的错误转换为 Error 实例
 * @param err 捕获的错误
 * @returns Error 实例
 */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * 获取错误消息字符串
 * @param err 捕获的错误
 * @returns 错误消息
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
