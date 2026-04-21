/**
 * Remote IM Controller - 自定义错误类
 */

/**
 * 会话未找到错误
 */
export class SessionNotFoundError extends Error {
  constructor(
    public sessionName: string,
    public availableSessions: string[] = []
  ) {
    super(`tmux session '${sessionName}' not found`);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * 重连次数超限错误
 */
export class ReconnectLimitExceededError extends Error {
  constructor(
    public attempts: number,
    public maxRetries: number
  ) {
    super(`Reconnect limit exceeded: ${attempts}/${maxRetries}`);
    this.name = 'ReconnectLimitExceededError';
  }
}

/**
 * tmux 不可用错误
 */
export class TmuxNotAvailableError extends Error {
  constructor(public reason: string = 'tmux command not found') {
    super(`tmux not available: ${reason}`);
    this.name = 'TmuxNotAvailableError';
  }
}
