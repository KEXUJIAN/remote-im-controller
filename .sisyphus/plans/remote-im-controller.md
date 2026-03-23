# Remote IM Controller 开发计划

## 项目概述

**目标**：开发一个 Node.js 后台守护进程，通过飞书 WebSocket 长连接远程控制 WSL 终端（tmux）。

**技术栈**：TypeScript + Node.js 18+ + @larksuiteoapi/node-sdk + tmux

**核心约束**：
- 每个模块独立可测试
- 错误处理必须包含详细堆栈日志
- 遵循 let it crash 原则

---

## Phase 1: 基础设施

### Task 1.1: logger.ts - 日志模块

**目标**：实现统一日志输出，支持详细堆栈记录

**输入**：
- `src/types.ts` 中的 `LogLevel` 和 `LogEntry` 类型

**输出**：
- `src/logger.ts`

**接口定义**：
```typescript
export function createLogger(module: string): Logger;

interface Logger {
  debug(action: string, message: string, context?: Record<string, unknown>): void;
  info(action: string, message: string, context?: Record<string, unknown>): void;
  warn(action: string, message: string, context?: Record<string, unknown>): void;
  error(action: string, message: string, error?: Error, context?: Record<string, unknown>): void;
}
```

**验收标准**：
- [x] 输出 JSON 格式日志
- [x] 包含 timestamp、level、module、action 字段
- [x] error 级别自动记录完整堆栈
- [x] 通过环境变量 LOG_LEVEL 控制输出级别

**依赖**：无（依赖 types.ts 已完成）

---

## Phase 2: 核心功能模块

### Task 2.1: tmux_manager.ts - tmux 控制模块

**目标**：通过 child_process 与系统 tmux 交互

**输入**：
- `src/types.ts` 中的 `TmuxSession`, `TmuxCaptureResult`, `TmuxNotAvailableError`
- `src/logger.ts`

**输出**：
- `src/tmux_manager.ts`

**接口定义**：
```typescript
export function createTmuxManager(defaultLines: number): TmuxManager;

interface TmuxManager {
  checkAvailable(): Promise<void>;
  createSession(name: string): Promise<void>;
  killSession(name: string): Promise<void>;
  listSessions(): Promise<string[]>;
  sendCommand(name: string, cmd: string): Promise<void>;
  captureScreen(name: string, lines?: number): Promise<TmuxCaptureResult>;
  sessionExists(name: string): Promise<boolean>;
}
```

**验收标准**：
- [x] 启动时检查 tmux 可用性，不可用则抛出 TmuxNotAvailableError
- [x] createSession 执行 `tmux new-session -d -s <name>`
- [x] sendCommand 执行 `tmux send-keys -t <name> "<cmd>" C-m`
- [x] captureScreen 执行 `tmux capture-pane -p -t <name> -S -<lines>`
- [x] 所有错误包含详细堆栈和上下文
- [x] 支持 CLI 独立测试：`npm run test:tmux`

**依赖**：Task 1.1 (logger.ts)

---

### Task 2.2: parser.ts - 文本清洗模块

**目标**：处理 tmux 抓取的原始输出

**输入**：
- `src/types.ts` 中的相关类型
- `src/logger.ts`

**输出**：
- `src/parser.ts`

**接口定义**：
```typescript
export interface Parser {
  cleanOutput(raw: string, maxLines?: number): string;
  removeAnsi(text: string): string;
  filterEmptyLines(text: string): string;
  removePrompt(text: string): string;
  generateHash(text: string): string;
}

export function createParser(): Parser;
```

**验收标准**：
- [x] 使用 strip-ansi 去除 ANSI 颜色代码
- [x] 过滤连续空行（最多保留 1 个）
- [x] 移除末尾 bash/zsh 提示符（匹配 `username@hostname:~$` 等模式）
- [x] 截取最后 N 行（默认 50 行）
- [x] generateHash 返回内容的 SHA256 哈希
- [x] 支持 CLI 独立测试：`npm run test:parser`

**依赖**：Task 1.1 (logger.ts)

---

### Task 2.3: command_parser.ts - 指令解析模块

**目标**：解析飞书消息文本为结构化指令

**输入**：
- `src/types.ts` 中的 `ParsedCommand`, `CommandAction`, `CommandParseError`
- `src/logger.ts`

**输出**：
- `src/command_parser.ts`

**接口定义**：
```typescript
export function parseCommand(input: string): ParsedCommand | null;
export function tokenize(body: string): string[];
```

**指令格式**：
```
/cmd <session> <command...>   → { action: 'exec', session, command }
/cmd list                      → { action: 'list' }
/cmd create <name>             → { action: 'create', session: name }
/cmd kill <name>               → { action: 'kill', session: name }
/cmd help                      → { action: 'help' }
/cmd status [session]          → { action: 'status', session? }
```

**验收标准**：
- [x] 正确解析带空格的命令（使用引号包裹）
- [x] 非指令格式返回 null
- [x] 内置动作（list/create/kill/help/status）正确识别
- [x] 所有边界情况有测试用例

**依赖**：Task 1.1 (logger.ts)

---

## Phase 3: 通信层

### Task 3.1: command_router.ts - 指令路由模块

**目标**：路由解析后的指令到对应处理器

**输入**：
- `src/types.ts` 中的 `CommandContext`, `CommandResult`, `CommandHandler`
- `src/command_parser.ts`
- `src/tmux_manager.ts`
- `src/parser.ts`
- `src/logger.ts`

**输出**：
- `src/command_router.ts`

**接口定义**：
```typescript
export function createCommandRouter(deps: {
  tmuxManager: TmuxManager;
  parser: Parser;
  config: Config;
}): CommandRouter;

interface CommandRouter {
  route(ctx: CommandContext): Promise<CommandResult>;
}
```

**内置处理器**：
| Action | 功能 | 返回 |
|--------|------|------|
| exec | 在会话中执行命令 | 执行状态 |
| list | 列出所有会话 | 会话列表 |
| create | 创建新会话 | 创建结果 |
| kill | 终止会话 | 终止结果 |
| help | 显示帮助 | 帮助文本 |
| status | 查看会话状态 | 状态信息 |

**验收标准**：
- [x] 所有 action 有对应处理器
- [x] 未知 action 返回友好错误提示
- [x] 错误包含详细上下文

**依赖**：Task 2.1, Task 2.2, Task 2.3

---

### Task 3.2: feishu_bot.ts - 飞书通信模块

**目标**：维护飞书 WSS 连接，收发消息

**输入**：
- `src/types.ts` 中的 `FeishuMessageEvent`, `FeishuCard`, `AuthenticationError`, `ReconnectLimitExceededError`
- `src/logger.ts`
- `@larksuiteoapi/node-sdk`

**输出**：
- `src/feishu_bot.ts`

**接口定义**：
```typescript
export function createFeishuBot(config: Config): FeishuBot;

interface FeishuBot {
  start(onMessage: (event: FeishuMessageEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  sendMarkdown(chatId: string, text: string, title?: string): Promise<void>;
  sendCard(chatId: string, card: FeishuCard): Promise<void>;
}
```

**验收标准**：
- [x] 使用 @larksuiteoapi/node-sdk 建立 WSS 长连接
- [x] 接收消息后验证 sender.open_id === ADMIN_OPEN_ID
- [x] 非管理员消息静默丢弃
- [x] 断线自动重连，最多 RECONNECT_MAX_RETRIES 次
- [x] 超过重连次数抛出 ReconnectLimitExceededError
- [x] sendMarkdown 发送代码块格式的消息卡片
- [x] 支持 CLI 独立测试：`npm run test:feishu`

**依赖**：Task 1.1 (logger.ts)

---

## Phase 4: 整合

### Task 4.1: app.ts - 主入口

**目标**：整合所有模块，实现完整业务流程

**输入**：
- 所有已开发模块
- `src/types.ts` 中的 `Config`, `PollState`

**输出**：
- `src/app.ts`

**核心流程**：
```
1. loadConfig()         - 从环境变量加载配置
2. checkTmuxAvailable() - 检查 tmux
3. 初始化各模块实例
4. registerHandlers()   - 注册指令处理器
5. feishuBot.start()    - 启动 WSS 连接
6. 监听消息 → 解析 → 路由 → 执行 → 轮询 → 推送
7. 优雅退出处理
```

**轮询机制**：
```
命令执行后 → 开始轮询 (每 3s)
  → captureScreen → hash
  → 与上次 hash 比较
  → 相同: stableCount++
  → stableCount >= POLL_STABLE_COUNT 且末尾有提示符 → 推送 → 停止轮询
  → 超过 POLL_TIMEOUT → 强制推送最后一次 → 停止轮询
```

**优雅退出**：
```
SIGINT/SIGTERM → 
  清除所有轮询定时器 →
  feishuBot.stop() →
  process.exit(0)
```

**验收标准**：
- [x] 完整流程可运行
- [x] 发送 `/cmd help` 收到正确回复
- [x] 发送 `/cmd list` 返回 tmux 会话列表
- [x] 发送 `/cmd <session> <command>` 执行命令并推送结果
- [x] 优雅退出不丢失数据
- [x] 未捕获异常记录日志后退出（let it crash）

**依赖**：所有前置 Task

---

## 执行顺序

```
Task 1.1 (logger.ts)
    │
    ├── Task 2.1 (tmux_manager.ts)
    ├── Task 2.2 (parser.ts)
    └── Task 2.3 (command_parser.ts)
              │
              └── Task 3.1 (command_router.ts) ──┐
                                                │
              Task 3.2 (feishu_bot.ts) ─────────┤
                                                │
                                                ▼
                                          Task 4.1 (app.ts)
```

**可并行**：Task 2.1, Task 2.2, Task 2.3
**可并行**：Task 3.1, Task 3.2（需等待 Phase 2 完成）

---

## 环境变量清单

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| FEISHU_APP_ID | ✅ | - | 飞书应用 ID |
| FEISHU_APP_SECRET | ✅ | - | 飞书应用密钥 |
| ADMIN_OPEN_ID | ✅ | - | 管理员 Open ID |
| TMUX_DEFAULT_LINES | ❌ | 50 | 默认抓取行数 |
| POLL_INTERVAL | ❌ | 3000 | 轮询间隔 (ms) |
| POLL_TIMEOUT | ❌ | 60000 | 轮询超时 (ms) |
| POLL_STABLE_COUNT | ❌ | 2 | 稳定计数 |
| RECONNECT_MAX_RETRIES | ❌ | 5 | 最大重连次数 |
| RECONNECT_DELAY | ❌ | 5000 | 重连延迟 (ms) |
| LOG_LEVEL | ❌ | info | 日志级别 |
| LOG_DIR | ❌ | ./logs | 日志目录 |
