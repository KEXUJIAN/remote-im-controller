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
- 使用 `interface` 定义对象结构
- 使用 `type` 定义联合类型、工具类型
- JSDoc 注释使用中文

```typescript
export interface Config {
  /** 飞书应用 ID */
  feishuAppId: string;
  /** 日志级别 */
  logLevel: LogLevel;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
```

### 错误处理

**自定义错误类**：继承 `Error`，添加上下文属性

```typescript
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

**错误转换**：始终转换为 `Error` 实例

```typescript
const error = err instanceof Error ? err : new Error(String(err));
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
├── app.ts              # 主入口（飞书模式）
├── cli.ts              # 本地 CLI 入口
├── types.ts            # 类型定义、自定义错误类
├── logger.ts           # 日志模块（文件 + 控制台）
├── state_manager.ts    # 状态机模块（COMMAND/SESSION 模式）
├── core_processor.ts   # 核心处理器（消息路由 + 轮询等待）
├── tmux_manager.ts     # tmux 控制模块
├── command_parser.ts   # 指令解析模块
├── command_router.ts   # 指令路由模块
├── feishu_bot.ts       # 飞书通信模块
└── adapters/
    ├── adapter.ts          # 适配器接口
    ├── feishu_adapter.ts   # 飞书适配器
    └── local_adapter.ts    # 本地适配器（CLI）
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `FEISHU_APP_ID` | 是 | - | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 是 | - | 飞书应用密钥 |
| `ADMIN_OPEN_ID` | 是 | - | 管理员 Open ID |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `LOG_DIR` | 否 | `./logs` | 日志目录 |
| `TMUX_DEFAULT_LINES` | 否 | `200` | tmux 抓取行数 |
| `TMUX_DEBUG` | 否 | `false` | tmux 详细日志 |
| `TMUX_TMPDIR` | 否 | `$LOG_DIR` | tmux 临时文件目录 |
| `POLL_INTERVAL` | 否 | `3000` | 轮询间隔 (ms) |
| `POLL_TIMEOUT` | 否 | `60000` | 轮询超时 (ms) |
| `POLL_STABLE_COUNT` | 否 | `2` | 稳定计数 |
| `RECONNECT_MAX_RETRIES` | 否 | `5` | 最大重连次数 |
| `RECONNECT_DELAY` | 否 | `5000` | 重连延迟 (ms) |
| `NODE_ENV` | 否 | - | `development` 时启用文件日志 |

## SESSION 模式轮询机制

SESSION 模式下命令发送后，使用轮询等待屏幕稳定：

1. **初始延迟**：500ms 后开始抓取
2. **轮询间隔**：每 `POLL_INTERVAL` ms 抓取一次
3. **稳定判定**：连续 `POLL_STABLE_COUNT` 次 hash 相同
4. **超时保护**：最长等待 `POLL_TIMEOUT` ms
5. **流式支持**：内容变化时持续等待

适用于：
- LLM 流式响应（如 `opencode run "你好"`）
- 长时间运行的命令
- 实时日志输出

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
4. 在 `types.ts` 添加相关类型定义

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
