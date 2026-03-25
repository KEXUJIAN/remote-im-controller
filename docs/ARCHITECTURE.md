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
| **types** | `src/types.ts` | 类型定义和接口 |
| **logger** | `src/logger.ts` | 日志记录（文件 + 控制台） |
| **tmux_manager** | `src/tmux_manager.ts` | 通过 child_process 与 tmux 交互 |
| **parser** | `src/parser.ts` | 清洗终端输出，去除 ANSI 代码 |
| **command_parser** | `src/command_parser.ts` | 解析用户指令 |
| **command_router** | `src/command_router.ts` | 路由指令到处理器 |
| **state_manager** | `src/state_manager.ts` | 状态机管理（COMMAND/SESSION 模式） |
| **core_processor** | `src/core_processor.ts` | 核心处理器，统一消息路由 |
| **card_builder** | `src/card_builder.ts` | 飞书卡片构建器 |
| **feishu_bot** | `src/feishu_bot.ts` | 飞书 WSS 连接和消息发送 |
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
│       │  或 30 分钟无操作                                     │
│       ▼                                                     │
│  COMMAND 模式                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

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

## 五、日志系统

### 日志输出策略

| 模式 | 控制台 | 文件 |
|------|--------|------|
| `npm run local` (CLI) | ❌ 干净 | ✅ `./logs/cli.log` |
| `npm run dev` (开发) | ✅ 显示 | ✅ `./logs/dev.log` |
| `npm run start` / PM2 | ✅ PM2 管理 | ✅ PM2 管理 |

---

## 六、配置管理

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

# 重连配置
RECONNECT_MAX_RETRIES=5        # 最大重连次数
RECONNECT_DELAY=5000           # 重连延迟 (ms)

# 日志配置
LOG_LEVEL=debug                # 日志级别
LOG_DIR=./logs                 # 日志目录
NODE_ENV=development           # development 时启用文件日志
```

---

## 七、优雅退出

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

## 八、依赖关系

```
app.ts (飞书模式)
  ├── feishu_bot.ts
  │     └── @larksuiteoapi/node-sdk
  ├── feishu_adapter.ts
  │     └── adapter.ts (接口)
  ├── core_processor.ts
  │     ├── state_manager.ts
  │     ├── command_router.ts
  │     │     └── command_parser.ts
  │     └── tmux_manager.ts
  ├── card_builder.ts
  └── logger.ts

cli.ts (本地测试)
  ├── local_adapter.ts
  │     └── adapter.ts (接口)
  ├── core_processor.ts
  └── logger.ts
```

---

## 九、测试策略

### 模块独立测试

```bash
# 测试各模块
npm run test:tmux        # tmux 管理器
npm run test:parser      # 文本解析
npm run test:feishu      # 飞书模块
npm run test:state       # 状态机
npm run test:core        # 核心处理器

# 本地 CLI 测试
npm run local
```

### 运行模式

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build
npm run start

# PM2 部署
pm2 start ecosystem.config.cjs
```
