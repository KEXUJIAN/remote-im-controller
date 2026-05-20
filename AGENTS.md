# Remote IM Controller - AI Agent 指南

## 参考文档

本文档是 AI Agent 的**索引入口**。完整的项目信息分布在：

| 文档 | 包含内容 |
|------|---------|
| `README.md` | 项目概览、快速开始、指令说明、omo 脚本用法 |
| `docs/FEISHU_SETUP.md` | 飞书应用配置步骤 |
| `docs/ARCHITECTURE.md` | 技术架构和模块设计 |
| `docs/OMO_BOT_ARCH.md` | omo 命令处理逻辑、会话隔离机制 |
| `.env.example` | 环境变量模板 |
| `package.json` | 全部 npm 脚本 |

**本文档补充上述文档未覆盖的、AI Agent 特有需要的信息**。

## 项目概述

通过飞书 WebSocket 长连接远程控制 WSL 终端的 Node.js 实守进程。支持 COMMAND/SESSION 双模式，飞书卡片交互，本地 CLI 测试。

**架构特点**：
- 单进程架构（PM2 fork 模式），状态存储在内存中
- instanceId 前缀实现多实例隔离：CLI/dev/prod 模式可同时运行，互不干扰
- 用户输入会话名 `op` → 内部名 `cli-op` / `dev-op` / `prod-op`
- `src/bootstrap.ts` 提供共享启动逻辑（锁、信号注册、优雅退出），`app.ts` 和 `cli.ts` 各自组装自己的 DI 和适配器

## 构建与测试命令

### 构建
```bash
npm run build          # TypeScript 编译到 dist/
npm run typecheck      # 仅类型检查，不生成文件
```

### 开发
```bash
npm run dev            # 开发模式（tsx watch 热重载）
npm run local          # 本地 CLI 测试入口
```

### 测试

测试文件位于 `src/test/`，通过 `npm run test:<name>` 运行。**全部脚本见 `package.json`**。

### 生产部署

```bash
# 交互式菜单
npm run pm2

# 非交互式命令
npm run pm2 start       # 生产环境启动
npm run pm2 start --dev # 开发环境启动（LOG_LEVEL=debug）
npm run pm2 stop        # 停止
npm run pm2 restart     # 重启
npm run pm2 logs        # 查看日志
npm run pm2 status      # 查看状态
npm run pm2 delete      # 删除进程
```

**注意**：项目使用 `fork` 模式（单进程架构，状态存储在内存中），不适合 cluster 多进程。

## 测试编写规范

项目使用裸 tsx 脚本做测试，位于 `src/test/`，**无测试框架**（无 jest/vitest）。

### 编写新测试
1. 创建 `src/test/<模块名>.test.ts`，遵循已有文件结构
2. 文件结构：文件头注释 → import → 测试函数 → `async function main()` → `main().catch(console.error)`
3. 断言方式：`if (!condition) { console.log('✗ 失败'); process.exit(1); }`
4. 在 `package.json` 添加对应的 `test:<name>` 脚本

### 注意事项
- 测试顺序执行，每个测试自行管理状态（创建/清理），避免耦合
- 部分测试依赖 tmux 环境（`test:tmux`、`test:router`）
- 成功以 `✓` 标记，失败以 `✗` 标记

## 代码风格规范

| 维度 | 约定 |
|------|------|
| 模块系统 | ESM（`"type": "module"`），导入必须带 `.js` 扩展名 |
| 架构模式 | 工厂函数 `createXxx` 返回实现接口的对象（非 class） |
| 文件命名 | `snake_case.ts` |
| 变量/函数 | `camelCase` |
| 类型/接口 | `PascalCase` |
| 类型定义 | 集中在 `src/types.ts`，错误类在 `src/errors.ts` |
| 注释 | 中文；保留解释"为什么"的注释，删除解释"是什么"的 |
| 变量缩写 | 社区惯用缩写可接受（`rl`/`proc`/`res`/`temp`），不需要全称 |
| 常量提取 | 仅当值重复出现、含义不清、可能变化时才提取；字面值（API 参数、配置分支值）不需要封装 |
| 导入语句 | `import type` 和值导入分开写是 TypeScript 语法要求，不是重复 |
| 模块耦合 | 模块间调用分散在清晰逻辑区块时，不强行封装组合 API |
| 变量命名 | 类型注解明确时，通用名称（`result`）不强制重命名 |
| 禁止 | `as any`、`@ts-ignore`、`@ts-expect-error`；空 catch 块需加 debug 日志，不可静默吞异常 |

```typescript
// 工厂函数模式 — 模块导出 createXxx 函数，返回实现接口的对象
export interface TmuxManager {
  createSession(name: string): Promise<void>;
}
export function createTmuxManager(...): TmuxManager {
  return { async createSession(name) { /* ... */ } };
}
```

TypeScript **strict 模式**，额外启用：`noUnusedLocals`、`noUnusedParameters`、`noImplicitReturns`、`noUncheckedIndexedAccess`。

### 导入顺序
1. Node.js 内置模块 → 2. 第三方模块 → 3. 项目内模块（相对路径）

### 日志规范
```typescript
const logger = createLogger('module_name');
logger.info('action', '描述', { contextKey: 'value' });
logger.error('action', '描述', error, { extra: 'value' });
```
级别：`debug` < `info` < `warn` < `error`

## 文件结构

```
src/
├── app.ts                    # 主入口（飞书模式）
├── cli.ts                    # 本地 CLI 入口
├── bootstrap.ts              # 共享启动基础设施（锁、信号、优雅退出）
├── config.ts                 # 配置加载模块
├── types.ts                  # 类型定义
├── errors.ts                 # 自定义错误类
├── logger.ts                 # 日志模块（文件 + 控制台）
├── state_manager.ts          # 状态机模块（COMMAND/SESSION 模式）
├── core_processor.ts         # 核心处理器（消息路由 + 轮询等待）
├── tmux_manager.ts           # tmux 控制模块
├── command_parser.ts         # 指令解析模块
├── command_router.ts         # 指令路由模块
├── feishu_bot.ts             # 飞书通信模块
├── session_output_manager.ts # Session 输出管理模块（offset 追踪）
├── streaming_session.ts      # 流式推送会话模块（分块推送 + 消息更新）
├── marker_detector.ts        # PS1 边界标记检测模块
├── utils/
│   ├── misc.ts                 # 杂项工具（错误处理、脱敏、日志目录）
│   └── terminal_cleaner.ts     # 终端序列清理工具
├── services/
│   └── timeout_checker.ts    # 会话超时检查服务
└── adapters/
    ├── adapter.ts            # 适配器接口
    ├── feishu_adapter.ts     # 飞书适配器
    └── local_adapter.ts      # 本地适配器（CLI）
src/test/
├── test_utils.ts             # 测试工具函数
├── state_manager.test.ts     # 状态机模块测试
├── process_lock.test.ts      # 进程锁模块测试
├── tmux_manager.test.ts      # tmux 控制模块测试
├── local_adapter.test.ts     # 本地适配器测试
├── command_router.test.ts    # 指令路由模块测试
├── core_processor.test.ts    # 核心处理器测试
├── feishu_adapter.test.ts    # 飞书适配器测试
├── feishu_bot.test.ts        # 飞书通信模块测试
├── session_output_manager.test.ts # 会话输出管理测试
├── marker_detector.test.ts   # PS1 标记检测测试
└── state_persistence.test.ts # 状态持久化测试
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `FEISHU_APP_ID` | 是 | - | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 是 | - | 飞书应用密钥 |
| `ADMIN_OPEN_ID` | 是 | - | 管理员 Open ID |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `LOG_DIR` | 否 | `./logs` | 日志目录 |
| `TMUX_DEFAULT_LINES` | 否 | `50` | tmux 抓取行数 |
| `TMUX_DEBUG` | 否 | `false` | tmux 详细日志 |
| `TMUX_TMPDIR` | 否 | `$LOG_DIR` | tmux 临时文件目录 |
| `POLL_INTERVAL` | 否 | `3000` | 轮询间隔 (ms) |
| `POLL_TIMEOUT` | 否 | `60000` | 轮询超时 (ms) |
| `POLL_FINAL_DELAY` | 否 | `500` | 进程结束后等待时间 (ms) |
| `POLL_TIMEOUT_CHECK_COUNT` | 否 | `3` | 超时后额外检测次数 |
| `RECONNECT_MAX_RETRIES` | 否 | `5` | 最大重连次数 |
| `RECONNECT_DELAY` | 否 | `5000` | 重连延迟 (ms) |
| `SESSION_TIMEOUT_MS` | 否 | `600000` | 会话超时时间 (ms) |
| `STREAM_PUSH_INTERVAL_MS` | 否 | `2000` | 流式推送间隔 (ms) |
| `STREAM_PUSH_MIN_INTERVAL_MS` | 否 | `500` | 流式推送最小间隔 (ms) |
| `CARD_TEMPLATE_ID` | 否 | `-` | 卡片模板 ID（可选） |
| `NODE_ENV` | 否 | - | `development` 时启用文件日志 |

## omo 集成

项目内置 omo-bot 脚本用于 OpenCode CLI 远程调度，支持飞书会话隔离。

**何时查阅详细文档**：
- 需要修改 omo 命令处理逻辑 → 参考 [docs/OMO_BOT_ARCH.md](docs/OMO_BOT_ARCH.md)
- 需要了解会话隔离机制 → 参考 [docs/OMO_BOT_ARCH.md](docs/OMO_BOT_ARCH.md)
- 需要修改 omo-bot.ts → 参考 [docs/OMO_BOT_ARCH.md](docs/OMO_BOT_ARCH.md)

**关键环境变量**：
| 变量 | 说明 |
|------|------|
| `OMO_CHAT_ID` | 飞书会话 ID，用于会话隔离，由 core_processor.ts 自动注入 |

**相关代码**：
- `src/core_processor.ts:156-159` - omo 命令检测与注入
- `scripts/omo-bot.ts` - 主脚本

**npm 命令**：
- `npm run bi [name]` - 安装（默认 omo）
- `npm run br <name>` - 改名
- `npm run bu` - 卸载

## SESSION 模式流式推送机制

SESSION 模式下命令发送后，使用流式推送机制获取输出：

1. **PS1 边界标记**：会话创建时注入 OSC 标记 `\x1b]99;CMD_END\x07`
2. **流式推送**：`startStreaming()` 返回 `Promise<void>`，定时读取 pipe-pane 日志增量输出
3. **完成检测**：检测到 PS1 标记时 resolve Promise，命令完成
4. **消息更新**：`streaming_session.ts` 封装分块推送逻辑，按时间（5000ms）或大小（1024B）阈值更新飞书消息，单条消息上限 8KB
5. **忙碌状态**：命令执行期间锁定，拒绝新命令

### PS1 标记注入

使用 `$'...'` ANSI-C quoting 语法确保转义序列正确解释：

**bash**:
```bash
export PS1=$'\e]99;CMD_END\a$ '
```

**zsh**:
```bash
unset zle_bracket_paste
export PS1=$'%{%f%b%k%}\e]99;CMD_END\a%# '
```

关键点：
- `\e` = ESC 字符 (0x1b)
- `\a` = BEL 字符 (0x07)
- zsh 需要先禁用 `zle_bracket_paste` 避免干扰

### 标记检测顺序

标记检测在终端输出清理**之前**执行：

```
1. readNewOutput() 读取原始内容
2. markerDetector.check() 检测标记 ← 在原始内容上检测
3. cleanTerminalOutput() 清理 OSC 序列
4. 返回 { content, markerFound, markerPosition }
```

### 流式推送配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `STREAM_PUSH_INTERVAL_MS` | 2000 | 流式推送间隔 (ms) |
| `STREAM_PUSH_MIN_INTERVAL_MS` | 500 | 流式推送最小间隔 (ms) |

### 流式推送两层间隔

注意区分两个不同的时间间隔：

| 常量 | 默认值 | 位置 | 作用 |
|------|--------|------|------|
| `config.streamPushIntervalMs` | 2000ms | 环境变量 | `startStreaming` 内部 `setInterval` 的频率 — 读取日志文件的轮询间隔 |
| `UPDATE_INTERVAL_MS` | 5000ms | `streaming_session.ts` 模块常量 | `handleChunk` 回调内累积输出推送到飞书消息的最小间隔 |

### streaming_session 模块架构

`src/streaming_session.ts` 封装了 SESSION 模式下命令输出到飞书消息的完整流程：

- `createStreamingSession(deps)` — 工厂函数，接收 `{ chatId, sessionName, sendMessage, updateMessage }`
- `run(outputManager, markerDetector, intervalMs)` — 调用 `startStreaming`（返回 Promise），完成时格式化最终消息
- 内部私有状态：`accumulatedOutput`、`messageId`、`lastUpdateTime`
- 模块常量：`UPDATE_INTERVAL_MS`（5000ms 消息更新节流）、`UPDATE_SIZE_THRESHOLD`（1024B 最小推送字节）、`MAX_OUTPUT_SIZE`（8KB 单条消息上限）

调用方只需：
```typescript
const session = createStreamingSession({ chatId, sessionName, sendMessage, updateMessage });
await session.run(outputManager, markerDetector, config.streamPushIntervalMs);
```


### 忙碌状态

当用户正在执行命令时，会话处于忙碌状态：
- 新命令会被拒绝，返回 "⏳ 请等待当前命令完成..."
- 忙碌状态通过 `StateManager.isBusy()` 检查

## 常见任务

### 添加新指令
1. 在 `types.ts` 添加 `CommandAction` 类型和 `ParsedCommand` 字段
2. 在 `command_parser.ts` 添加解析逻辑
3. 在 `command_router.ts` 添加处理函数和路由

### 添加新模块
1. 创建 `src/new_module.ts`，定义接口和工厂函数
2. 导出接口类型供其他模块使用
3. 如需新类型/错误类/工具函数，在对应目录下添加

### 调试
```bash
LOG_LEVEL=debug npm run dev        # 详细日志
TMUX_DEBUG=true npm run test:tmux  # tmux 详细日志
```
日志文件：`./logs/cli.log`（CLI 模式）、`./logs/dev.log`（开发模式）。
