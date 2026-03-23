# Remote IM Controller - 学习笔记

## 项目约定
- TypeScript 严格模式
- ESNext 模块系统
- 所有错误必须包含详细堆栈日志
- 遵循 let it crash 原则
- 每个模块支持 CLI 独立测试

## 依赖
- @larksuiteoapi/node-sdk: 飞书 SDK
- strip-ansi: 去除 ANSI 颜色代码

## 类型定义已完成 (src/types.ts)
- Config: 配置类型
- TmuxSession, TmuxCaptureResult: tmux 相关
- ParsedCommand, CommandContext, CommandResult: 指令相关
- FeishuMessageEvent, FeishuCard: 飞书消息
- 自定义错误类型: SessionNotFoundError, CommandParseError, AuthenticationError, ReconnectLimitExceededError, TmuxNotAvailableError

## logger.ts 已完成
- createLogger(module) 返回 Logger 实例
- 日志级别优先级: debug < info < warn < error
- 默认级别: 'info'（通过 LOG_LEVEL 环境变量控制）
- 输出格式: 单行 JSON，包含 timestamp(ISO 8601)、level、module、action、message
- error 方法自动记录 Error 的 name、message、stack
- 使用 process.stdout.write 输出（非 console.log）

## parser.ts 已完成
- createParser() 返回 Parser 实例
- removeAnsi: 使用 strip-ansi 库去除 ANSI 转义序列
- filterEmptyLines: 过滤连续空行为单个空行
- removePrompt: 正则匹配并移除末尾 shell 提示符 `[\w.-]+@[\w.-]+:[^$\n]*[$#]\s*$`
- cleanOutput: 按 removeAnsi → filterEmptyLines → removePrompt 顺序处理，截取最后 N 行
- generateHash: 使用 Node.js crypto 模块生成 SHA256 哈希
- CLI 测试: `npm run test:parser`

## command_parser.ts 已完成
- parseCommand(input): 解析指令，非指令格式返回 null
- tokenize(body): 分词函数，支持引号包裹的参数
- 内置动作: list, help, create, kill, status
- exec 动作: `/cmd <session> <command...>` 格式
- 注意: TypeScript 的 exactOptionalPropertyTypes 配置要求可选属性不能赋值为 undefined

## tmux_manager.ts 已完成
- createTmuxManager(defaultLines): TmuxManager - 工厂函数
- 使用 child_process.spawn 执行 tmux 命令
- listSessions 处理三种"无会话"情况:
  - "no sessions" - 有服务器但无会话
  - "error connecting to" - 服务器未启动
  - "no server running" - 服务器已关闭
- cleanOutput 去除 ANSI 转义序列 (CSI/OSC/字符集)
- captureScreen 使用 MD5 计算输出哈希
- CLI 测试: `npm run test:tmux` 或 `tsx src/tmux_manager.ts test`

## command_router.ts 已完成
- createCommandRouter(deps): CommandRouter - 工厂函数
- deps 包含: tmuxManager, parser
- 六个 action 处理器: exec, list, create, kill, help, status
- 未知 action 返回友好错误提示
- SessionNotFoundError 被捕获并返回可用会话提示
- lastSession 用于记忆上次操作的会话（用于简化后续命令）
- CLI 测试: `tsx src/command_router.ts test`

## feishu_bot.ts 已完成
- createFeishuBot(config): FeishuBot - 工厂函数
- 使用 @larksuiteoapi/node-sdk 的 WSClient 建立 WebSocket 长连接
- EventDispatcher 注册 'im.message.receive_v1' 事件处理器
- start(): 启动 WS 连接，验证管理员身份（非管理员消息静默丢弃）
- stop(): 调用 wsClient.close() 关闭连接
- sendMarkdown(): 发送 Markdown 卡片消息
- sendCard(): 发送自定义卡片消息（msg_type: 'interactive'）
- 自动重连：断线后延迟重连，超过 reconnectMaxRetries 抛出 ReconnectLimitExceededError
- CLI 测试: `npm run test:feishu`
- WSClient 使用 close() 方法关闭，不是 stop()
- SDK API: client.im.v1.message.create() 发送消息

## app.ts 已完成
- 主入口整合所有模块: logger, tmux_manager, parser, command_parser, command_router, feishu_bot
- loadConfig(): 从环境变量加载配置，必填项缺失抛出错误
- 消息处理流程: 解析 JSON → parseCommand() → commandRouter.route() → sendMarkdown()
- 轮询机制:
  - Map<string, PollState> 跟踪每个会话的轮询状态
  - 每 pollInterval ms 抓取屏幕，计算 hash
  - hash 相同则 stableCount++，否则重置
  - 结束条件: stableCount >= pollStableCount && hasPrompt() 或 timeout
  - 提示符检测正则: /[\w.-]+@[\w.-]+:[^$\n]*[$#]\s*$/
- 优雅退出: SIGINT/SIGTERM → stopAllPolling() → feishuBot.stop()
- 异常处理: uncaughtException/unhandledRejection → 记录日志 → gracefulShutdown
- TypeScript exactOptionalPropertyTypes 配置要求: 可选属性不能直接赋值为 undefined
