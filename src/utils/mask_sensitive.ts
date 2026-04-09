/**
 * Remote IM Controller - 敏感信息脱敏工具
 */

/**
 * 脱敏敏感字段，保留前缀和后缀
 * @param value 原始值
 * @param prefix 保留前缀长度（默认 4）
 * @returns 脱敏后的值
 */
export function maskSensitive(value: string, prefix: number = 4): string {
  if (value.length <= prefix * 2) {
    return `${value.slice(0, prefix)}****`;
  }
  return `${value.slice(0, prefix)}****${value.slice(-prefix)}`;
}
