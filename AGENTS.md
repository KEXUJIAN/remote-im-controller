# Remote IM Controller - AI Agent 指南

## 项目概述

通过飞书 WebSocket 长连接远程控制 WSL 终端的 Node.js 守护进程。支持 COMMAND/SESSION 双模式，飞书卡片交互，本地 CLI 测试。

## 构建与测试命令

### 构建
```bash
npm run build          # TypeScript 编译到 dist/
npm run typecheck      # 仅类型检查，不生成文件
```

### 开发
```bash
npm run dev            # 开发模式（tsx watch 热重载）
npm run start          # 运行编译后的代码
npm run local          # 本地 CLI 测试入口
```

### 测试（模块内联测试）
项目没有使用测试框架，采用模块内联测试模式：

```bash
npm run test:tmux      # 测试 tmux 控制模块
npm run test:feishu    # 测试飞书通信模块
npm run test:state     # 测试状态机模块
npm run test:core      # 测试核心处理器
npm run test:output    # 测试 Session 输出管理模块
```

**运行单个测试**：直接执行对应命令，测试逻辑在模块末尾的 `if (process.argv[2] === 'test')` 块中。

### 生产部署
```bash
pm2 start ecosystem.config.cjs    # 使用 PM2 启动
pm2 logs remote-im-controller     # 查看日志
```

## 日志系统

### 日志输出策略

| 运行模式 | 控制台 | 文件 |
|----------|--------|------|
| `npm run local` (CLI) | ❌ 干净 | ✅ `./logs/cli.log` |
| `npm run dev` (开发) | ✅ 显示 | ✅ `./logs/dev.log` |
| `npm run start` / PM2 | ✅ PM2 管理 | ✅ PM2 管理 |

### 启用开发模式文件日志

```bash
NODE_ENV=development npm run start
```

## 代码风格规范

### TypeScript 配置

项目使用 **strict 模式**，启用以下严格检查：
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`

**禁止使用**：`as any`、`@ts-ignore`、`@ts-expect-error`

### 模块系统

- **ESM 模块**（`"type": "module"`）
- 导入必须带 `.js` 扩展名（TypeScript ESM 约定）

```typescript
// 正确
import { createLogger } from './logger.js';
import type { Config } from './types.js';

// 错误
import { createLogger } from './logger';  // 缺少扩展名
```

### 命名约定

| 类型 | 命名风格 | 示例 |
|------|----------|------|
| 变量/函数 | camelCase | `parseCommand`, `lastSession` |
| 类型/接口 | PascalCase | `TmuxSession`, `CommandResult` |
| 常量 | camelCase 或 UPPER_SNAKE_CASE | `LOG_LEVEL_PRIORITY`, `helpText` |
| 文件 | snake_case.ts | `tmux_manager.ts`, `command_parser.ts` |
| 私有函数 | 下划线前缀可选 | `_unusedParser` |

### 导入顺序

```typescript
// 1. Node.js 内置模块
import { spawn } from 'child_process';
import { createHash } from 'crypto';

// 2. 第三方模块
import 'dotenv/config';

// 3. 项目内模块（相对路径）
import { createLogger } from './logger.js';
import type { TmuxCaptureResult } from './types.js';
```

### 架构模式

**工厂函数模式**：模块导出 `createXxx` 函数而非类

```typescript
// 定义接口
export interface TmuxManager {
  createSession(name: string): Promise<void>;
  killSession(name: string): Promise<void>;
  // ...
}

// 导出工厂函数
export function createTmuxManager(defaultLines: number, debug?: boolean): TmuxManager {
  // 返回实现接口的对象
  return {
    async createSession(name: string): Promise<void> { /* ... */ },
    async killSession(name: string): Promise<void> { /* ... */ },
  };
}
```

### 类型定义

- 类型集中在 `src/types.ts`
- 自定义错误类在 `src/errors.ts`
- 使用 `interface` 定义对象结构
- 使用 `type` 定义联合类型、工具类型
- JSDoc 注释使用中文

```typescript
// src/types.ts
export interface Config {
  /** 飞书应用 ID */
  feishuAppId: string;
  /** 日志级别 */
  logLevel: LogLevel;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
```

### 错误处理

**自定义错误类**：继承 `Error`，添加上下文属性，定义在 `src/errors.ts`

```typescript
// src/errors.ts
export class SessionNotFoundError extends Error {
  constructor(
    public sessionName: string,
    public availableSessions: string[] = []
  ) {
    super(`tmux session '${sessionName}' not found`);
    this.name = 'SessionNotFoundError';
  }
}
```

**错误转换工具**：使用 `src/utils/error.ts` 中的工具函数

```typescript
import { toError, toErrorMessage } from './utils/error.js';

const error = toError(err);
const errMsg = toErrorMessage(err);
```

**禁止空 catch 块**

### 日志规范

使用 `createLogger(moduleName)` 创建日志器：

```typescript
const logger = createLogger('command_router');

logger.info('action', '操作描述', { contextKey: 'value' });
logger.error('action', '错误描述', error, { extraContext: 'value' });
```

日志级别：`debug` < `info` < `warn` < `error`

### 注释规范

- 文件头注释：模块用途说明
- JSDoc 注释：公共 API
- 行内注释：复杂逻辑说明
- 语言：中文

```typescript
/**
 * Remote IM Controller - 指令解析模块
 */

/**
 * 分词函数 - 处理引号包裹的参数
 * @param body 输入字符串
 * @returns 分词后的字符串数组
 */
export function tokenize(body: string): string[] { /* ... */ }
```

## 文件结构

```
src/
├── app.ts                    # 主入口（飞书模式）
├── cli.ts                    # 本地 CLI 入口
├── config.ts                 # 配置加载模块
├── types.ts                  # 类型定义
├── errors.ts                 # 自定义错误类
├── test_utils.ts             # 测试工具函数
├── logger.ts                 # 日志模块（文件 + 控制台）
├── state_manager.ts          # 状态机模块（COMMAND/SESSION 模式）
├── core_processor.ts         # 核心处理器（消息路由 + 轮询等待）
├── tmux_manager.ts           # tmux 控制模块
├── command_parser.ts         # 指令解析模块
├── command_router.ts         # 指令路由模块
├── feishu_bot.ts             # 飞书通信模块
├── session_output_manager.ts # Session 输出管理模块（offset 追踪）
├── marker_detector.ts        # PS1 边界标记检测模块
├── utils/
│   ├── ensure_log_dir.ts     # 日志目录初始化工具
│   ├── error.ts              # 错误转换工具函数
│   └── terminal_cleaner.ts   # 终端序列清理工具
├── services/
│   └── timeout_checker.ts    # 会话超时检查服务
└── adapters/
    ├── adapter.ts            # 适配器接口
    ├── feishu_adapter.ts     # 飞书适配器
    └── local_adapter.ts      # 本地适配器（CLI）
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
| `STREAM_LOG_DIR` | 否 | `./logs/stream/` | tmux pipe-pane 日志目录 |
| `STREAM_PUSH_INTERVAL_MS` | 否 | `2000` | 流式推送间隔 (ms) |
| `STREAM_PUSH_MIN_INTERVAL_MS` | 否 | `500` | 流式推送最小间隔 (ms) |
| `CARD_TEMPLATE_ID` | 否 | `-` | 卡片模板 ID（可选） |
| `NODE_ENV` | 否 | - | `development` 时启用文件日志 |

## SESSION 模式流式推送机制

SESSION 模式下命令发送后，使用流式推送机制获取输出：

1. **PS1 边界标记**：会话创建时注入 OSC 标记 `\x1b]99;CMD_END\x07`
2. **流式推送**：定时读取 pipe-pane 日志增量输出
3. **完成检测**：检测到 PS1 标记时认为命令完成
4. **忙碌状态**：命令执行期间锁定，拒绝新命令

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

### 忙碌状态

当用户正在执行命令时，会话处于忙碌状态：
- 新命令会被拒绝，返回 "⏳ 请等待当前命令完成..."
- 忙碌状态通过 `StateManager.isBusy()` 检查

## 本地 CLI 测试

```bash
npm run local
```

### 可用指令

| 指令 | 说明 |
|------|------|
| `help` | 显示帮助 |
| `list` | 列出会话 |
| `create <name>` | 创建会话 |
| `kill <name>` | 终止会话 |
| `<session> <cmd>` | 在会话中执行命令 |
| `/click enter <session>` | 模拟卡片"进入"按钮 |
| `/click kill <session>` | 模拟卡片"关闭"按钮 |
| `/menu exit` | 模拟菜单"退出会话模式" |

### 退出 CLI

`Ctrl+C`

## 常见任务

### 添加新指令

1. 在 `types.ts` 添加 `CommandAction` 类型和 `ParsedCommand` 字段
2. 在 `command_parser.ts` 添加解析逻辑
3. 在 `command_router.ts` 添加处理函数和路由

### 添加新模块

1. 创建 `src/new_module.ts`
2. 定义接口和工厂函数
3. 导出接口类型供其他模块使用
4. 如需新类型，在 `src/types.ts` 添加类型定义
5. 如需新错误类，在 `src/errors.ts` 添加错误定义
6. 如需工具函数，在 `src/utils/` 下创建

### 调试

设置环境变量启用详细日志：

```bash
LOG_LEVEL=debug npm run dev
TMUX_DEBUG=true npm run test:tmux
```

### 查看日志文件

```bash
# CLI 模式日志
cat ./logs/cli.log

# 开发模式日志
cat ./logs/dev.log
```
