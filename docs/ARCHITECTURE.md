# 项目架构说明书

本文档说明 Remote IM Controller 的技术架构和模块设计。

---

## 一、架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│                         飞书客户端 (手机/桌面)                      │
└─────────────────────────────┬────────────────────────────────────┘
                              │ WebSocket (WSS)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                         飞书开放平台                               │
│                    (事件推送、消息发送 API)                         │
└─────────────────────────────┬────────────────────────────────────┘
                              │ WebSocket 长连接
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      WSL (Ubuntu)                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Node.js 进程                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │  │
│  │  │feishu_bot   │  │feishu_      │  │  adapters   │        │  │
│  │  │(事件监听)    │◄─┤adapter      │◄─┤  (接口)     │        │  │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────┘        │  │
│  │         │                │                                  │  │
│  │         │         ┌──────┴──────┐                          │  │
│  │         │         │             │                          │  │
│  │         │    ┌────┴────┐  ┌─────┴─────┐                    │  │
│  │         │    │  core   │  │   state   │                    │  │
│  │         │    │processor│  │ _manager  │                    │  │
│  │         │    └────┬────┘  └───────────┘                    │  │
│  │         │         │                                        │  │
│  │         │    ┌────┴────┐                                   │  │
│  │         │    │         │                                   │  │
│  │         │    ▼         ▼                                   │  │
│  │         │ command_  tmux_                                 │  │
│  │         │ router    manager                               │  │
│  │         │    │         │                                   │  │
│  │         │    ▼         │                                   │  │
│  │         │ command_     │                                   │  │
│  │         │ parser       │                                   │  │
│  │         │              │                                   │  │
│  │         ▼              ▼                                   │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │                    logger                            │  │  │
│  │  │              (文件 + 控制台日志)                        │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              │ child_process.exec                │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     tmux sessions                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │  │
│  │  │  opencode   │  │  myproject  │  │  another    │        │  │
│  │  │  (session)  │  │  (session)  │  │  (session)  │        │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘        │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 二、模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **config** | `src/config.ts` | 配置加载，统一环境变量解析 |
| **types** | `src/types.ts` | 类型定义和接口 |
| **errors** | `src/errors.ts` | 自定义错误类 |
| **logger** | `src/logger.ts` | 日志记录（文件 + 控制台） |
| **tmux_manager** | `src/tmux_manager.ts` | 通过 child_process 与 tmux 交互 |
| **command_parser** | `src/command_parser.ts` | 解析用户指令 |
| **command_router** | `src/command_router.ts` | 路由指令到处理器 |
| **state_manager** | `src/state_manager.ts` | 状态机管理（COMMAND/SESSION 模式） |
| **core_processor** | `src/core_processor.ts` | 核心处理器，统一消息路由 |
| **session_output_manager** | `src/session_output_manager.ts` | Session 输出管理，offset 追踪 |
| **feishu_bot** | `src/feishu_bot.ts` | 飞书 WSS 连接和消息发送 |
| **utils/ensure_log_dir** | `src/utils/ensure_log_dir.ts` | 日志目录初始化工具 |
| **utils/error** | `src/utils/error.ts` | 错误转换工具函数 |
| **utils/terminal_cleaner** | `src/utils/terminal_cleaner.ts` | 终端序列清理工具 |
| **services/timeout_checker** | `src/services/timeout_checker.ts` | 会话超时检查服务 |
| **test_utils** | `src/test_utils.ts` | 测试配置工厂函数 |
| **adapters/adapter** | `src/adapters/adapter.ts` | 适配器接口定义 |
| **adapters/feishu_adapter** | `src/adapters/feishu_adapter.ts` | 飞书适配器实现 |
| **adapters/local_adapter** | `src/adapters/local_adapter.ts` | 本地 CLI 适配器 |
| **app** | `src/app.ts` | 主入口（飞书模式） |
| **cli** | `src/cli.ts` | CLI 入口（本地测试） |

---

## 三、状态机设计

### 模式切换

```
┌─────────────────────────────────────────────────────────────┐
│                    状态机模式切换                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  COMMAND 模式（默认）                                        │
│       │                                                     │
│       │  点击"进入会话"按钮                                   │
│       │  或 /click enter <session>                          │
│       ▼                                                     │
│  SESSION 模式                                                │
│       │                                                     │
│       │  点击机器人菜单"退出会话模式"                          │
│       │  或 /menu exit                                       │
│       │  或超时（默认 10 分钟）                                │
│       ▼                                                     │
│  COMMAND 模式                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 超时与续期机制

SESSION 模式下有超时保护，防止用户忘记退出：

- **超时检测**：每 10 秒检查一次 `lastActivityTime`
- **超时退出**：超过 `SESSION_TIMEOUT_MS` 无操作自动退回 COMMAND 模式
- **续期触发**：SESSION 模式下每次处理消息后调用 `renewActivity()` 更新 `lastActivityTime`

| 触发点 | 续期方法 |
|--------|----------|
| SESSION 模式收到 TEXT 消息并处理完成 | `stateManager.renewActivity(userId)` |
| CARD_EVENT 进入 SESSION 模式 | `stateManager.transition()` 自动更新 |
| MENU_EVENT 退出 SESSION 模式 | `stateManager.resetState()` 自动更新 |

### 消息路由

```
用户消息
    │
    ▼
CoreProcessor.process()
    │
    ├── TEXT 消息
    │       │
    │       ├── COMMAND 模式 → CommandRouter → 执行指令
    │       │
    │       └── SESSION 模式 → TmuxManager → 透传命令
    │                                    → 轮询等待稳定
    │                                    → 返回屏幕输出
    │
    ├── CARD_EVENT 消息
    │       │
    │       ├── enter → 切换到 SESSION 模式
    │       └── kill  → 终止会话
    │
    └── MENU_EVENT 消息
            │
            └── exit_session_mode → 退出 SESSION 模式
```

### ID 职责分离

`UnifiedMessage` 包含两个 ID 字段，职责不同：

| 字段 | 用途 | 来源 |
|------|------|------|
| `userId` | 状态管理 key（跨事件类型一致） | `open_id` |
| `chatId` | 消息回复目标 | TEXT/CARD: `chat_id`，MENU: `open_id` |

**各事件类型的 ID 映射**：

| 事件类型 | userId | chatId | 消息回复方式 |
|----------|--------|--------|--------------|
| TEXT | `event.sender.sender_id.open_id` | `event.message.chat_id` | `sendMessage(chatId, ...)` |
| CARD | `data.operator.open_id` | `context.open_chat_id` | `sendMessage(chatId, ...)` |
| MENU | `data.operator.operator_id.open_id` | 同 userId | `sendToUser(userId, ...)` |

**设计理由**：
- TEXT/CARD 消息需要回复到原聊天室（使用 `chat_id`）
- MENU 事件没有 `chat_id`，只能私聊回复（使用 `open_id`）
- 状态管理需要跨事件类型一致的用户标识（使用 `open_id`）

---

## 四、SESSION 模式轮询机制

SESSION 模式下，命令发送后使用轮询等待屏幕稳定：

```
┌─────────────────────────────────────────────────────────────┐
│                    轮询等待流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  发送命令到 tmux                                             │
│       │                                                     │
│       ▼                                                     │
│  初始延迟 (500ms)                                            │
│       │                                                     │
│       ▼                                                     │
│  抓取屏幕 ────┬─── 计算 hash                                 │
│       │       │                                             │
│       │       ▼                                             │
│       │   与上次 hash 比较                                   │
│       │       │                                             │
│       │   ┌───┴───┐                                         │
│       │   │       │                                         │
│       │  不同    相同                                        │
│       │   │       │                                         │
│       │   ▼       ▼                                         │
│       │ 重置计数  增加计数                                    │
│       │   │       │                                         │
│       │   │   达到稳定阈值?                                   │
│       │   │       │                                         │
│       │   │   ┌───┴───┐                                     │
│       │   │   │       │                                     │
│       │   │  是      否                                     │
│       │   │   │       │                                     │
│       │   │   ▼       ▼                                     │
│       │   │ 返回    继续轮询                                  │
│       │   │                                                 │
│       │   └── 检查超时 ─── 超时? → 返回当前内容               │
│       │                                                     │
│       └── 等待 POLL_INTERVAL 后继续                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**关键特性**：
- 内容变化时持续等待（支持流式输出）
- 连续 N 次 hash 相同视为稳定
- 超时后返回当前内容（不丢失）

---

## 五、SESSION 输出管理

### 概述

Session 输出管理模块 (`session_output_manager.ts`) 负责追踪 tmux 会话的输出偏移量，实现增量读取。

### Offset 追踪机制

每次读取 tmux 输出后，记录当前文件偏移量，下次只读取新增内容：

```
┌─────────────────────────────────────────────────────────────┐
│                    Offset 追踪流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  初始化 offset = 0                                          │
│       │                                                     │
│       ▼                                                     │
│  读取文件 ──── 记录文件大小                                   │
│       │                                                     │
│       ▼                                                     │
│  检测文件轮转 ─── 文件变小? → 从头读取                         │
│       │                                                     │
│       ▼                                                     │
│  从 offset 开始读取                                          │
│       │                                                     │
│       ▼                                                     │
│  清理终端序列 ─── 使用 terminal_cleaner.ts                    │
│       │                                                     │
│       ▼                                                     │
│  更新 offset = 当前文件大小                                   │
│       │                                                     │
│       ▼                                                     │
│  返回增量输出                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 终端序列清理

`utils/terminal_cleaner.ts` 负责清理终端输出中的控制序列：

- OSC 序列 (`\x1b]...`)：窗口标题、超链接等
- 私有模式序列 (`\x1b[?...`)：bracket paste mode 等
- CSI 序列 (`\x1b[...`)：颜色、光标移动等
- 退格符 (`\x08`)：模拟退格删除
- 回车符 (`\r`)：换行处理

### 行缓冲机制

为了支持流式输出场景，实现行缓冲：

- 不完整的行保留在缓冲区
- 下次读取时合并
- 遇到换行符时输出完整行

---

## 六、日志系统

### 日志输出策略

| 模式 | 控制台 | 文件 |
|------|--------|------|
| `npm run local` (CLI) | ❌ 干净 | ✅ `./logs/cli.log` |
| `npm run dev` (开发) | ✅ 显示 | ✅ `./logs/dev.log` |
| `npm run pm2` (生产) | ✅ PM2 管理 | ✅ PM2 管理 |

---

## 七、配置管理

### 配置加载

配置通过 `src/config.ts` 模块统一加载，支持两种模式：

```typescript
import { loadConfig } from './config.js';

// 飞书模式：验证飞书配置
const config = loadConfig(true);

// CLI 模式：跳过飞书配置验证
const config = loadConfig(false);
```

### 环境变量

```bash
# 飞书配置
FEISHU_APP_ID=cli_xxx          # 应用 ID
FEISHU_APP_SECRET=xxx          # 应用密钥
ADMIN_OPEN_ID=ou_xxx           # 管理员 Open ID

# tmux 配置
TMUX_DEFAULT_LINES=200         # 默认抓取行数（支持长输出）
TMUX_DEBUG=true                # 开启 tmux 详细日志
TMUX_TMPDIR=./logs             # tmux 临时文件目录

# 轮询配置
POLL_INTERVAL=3000             # 轮询间隔 (ms)
POLL_TIMEOUT=60000             # 轮询超时 (ms)
POLL_STABLE_COUNT=2            # 稳定计数（连续 N 次相同）

# 会话超时配置
SESSION_TIMEOUT_MS=600000      # 会话超时时间 (ms)，默认 10 分钟

# 重连配置
RECONNECT_MAX_RETRIES=5        # 最大重连次数
RECONNECT_DELAY=5000           # 重连延迟 (ms)

# 日志配置
LOG_LEVEL=debug                # 日志级别
LOG_DIR=./logs                 # 日志目录
NODE_ENV=development           # development 时启用文件日志
```

---

## 八、优雅退出

```
┌─────────────────────────────────────────────────────────────┐
│                    优雅退出流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  收到 SIGINT/SIGTERM                                        │
│       │                                                     │
│       ▼                                                     │
│  停止适配器                                                  │
│       │                                                     │
│       ▼                                                     │
│  关闭飞书 WSS 连接                                          │
│       │                                                     │
│       ▼                                                     │
│  记录退出日志                                               │
│       │                                                     │
│       ▼                                                     │
│  process.exit(0)                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 九、依赖关系

```
app.ts (飞书模式)
  ├── config.ts
  ├── feishu_bot.ts
  │     └── @larksuiteoapi/node-sdk
  ├── feishu_adapter.ts
  │     └── adapter.ts (接口)
  ├── core_processor.ts
  │     ├── state_manager.ts
  │     ├── command_router.ts
  │     │     └── command_parser.ts
  │     └── tmux_manager.ts
  │           └── session_output_manager.ts
  │                 └── utils/terminal_cleaner.ts
  ├── services/timeout_checker.ts
  └── logger.ts

cli.ts (本地测试)
  ├── config.ts
  ├── local_adapter.ts
  │     └── adapter.ts (接口)
  ├── core_processor.ts
  │     └── tmux_manager.ts
  │           └── session_output_manager.ts
  ├── services/timeout_checker.ts
  └── logger.ts

utils/
  ├── ensure_log_dir.ts    # 被 app.ts, cli.ts 使用
  ├── error.ts             # 被多个模块使用
  └── terminal_cleaner.ts  # 被 session_output_manager.ts 使用

errors.ts                   # 被 command_router, feishu_bot, tmux_manager 使用
test_utils.ts              # 被各模块内联测试使用
```

---

## 十、测试策略

### 模块独立测试

```bash
# 测试各模块
npm run test:tmux        # tmux 管理器
npm run test:feishu      # 飞书模块
npm run test:state       # 状态机
npm run test:core        # 核心处理器
npm run test:output      # Session 输出管理

# 本地 CLI 测试
npm run local
```

### 运行模式

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run pm2 start
```
