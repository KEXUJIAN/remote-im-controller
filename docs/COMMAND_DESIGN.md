# 指令系统设计说明书

本文档说明远程控制器的指令格式设计、解析方案和飞书端输入优化建议。

---

## 一、指令格式设计

### 推荐格式

```
/cmd <session> <command...>
```

或带子命令的格式：

```
/cmd <action> [session] [args...] [--options]
```

### 设计原则

1. **前缀固定**：`/cmd` 作为固定前缀，便于识别和过滤
2. **会话标识**：tmux session 名称，便于多会话管理
3. **命令体**：剩余部分作为要执行的命令

### 示例

```bash
# 执行命令
/cmd opencode ls -la
/cmd opencode npm run dev

# 会话管理
/cmd list                    # 列出所有 tmux 会话
/cmd create mysession        # 创建新会话
/cmd kill opencode           # 终止会话

# 帮助
/cmd help                    # 显示帮助信息
```

---

## 二、解析方案

### 方案对比

| 方案 | 优点 | 缺点 | 推荐场景 |
|------|------|------|----------|
| **正则表达式** | 无依赖、轻量 | 复杂格式难维护 | 简单指令 |
| **Minimist** | 体积小、速度快 | 无命令路由 | 标准 CLI |
| **自定义解析器** | 完全灵活 | 需自行实现 | 复杂场景 |

### 推荐方案：自定义解析器 + Minimist

原因：
1. 场景相对简单（session + command）
2. 需要灵活处理命令中的空格和特殊字符
3. 体积小，依赖少

### 解析器实现

```javascript
// src/command_parser.js

/**
 * 解析飞书消息指令
 * @param {string} input - 原始消息文本
 * @returns {ParsedCommand|null} 解析结果
 */
export function parseCommand(input) {
  // 去除首尾空白
  const text = input.trim();
  
  // 检查是否为指令
  if (!text.startsWith('/cmd')) {
    return null;
  }
  
  // 提取命令体（/cmd 之后的部分）
  const body = text.slice(4).trim();
  
  if (!body) {
    return { action: 'help', args: [], options: {} };
  }
  
  // 内置动作列表
  const builtInActions = ['list', 'create', 'kill', 'help', 'status'];
  
  // 解析为 tokens
  const tokens = tokenize(body);
  const [first, ...rest] = tokens;
  
  // 判断是否为内置动作
  if (builtInActions.includes(first)) {
    return {
      action: first,
      session: rest[0],
      args: rest.slice(1),
      options: {}
    };
  }
  
  // 否则认为是 session + command 格式
  return {
    action: 'exec',
    session: first,
    args: rest,
    command: rest.join(' '),
    options: {}
  };
}

/**
 * 分词器 - 处理引号和转义
 * @param {string} str - 输入字符串
 * @returns {string[]} tokens
 */
function tokenize(str) {
  const tokens = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
        quoteChar = '';
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === ' ') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    tokens.push(current);
  }
  
  return tokens;
}

/**
 * @typedef {Object} ParsedCommand
 * @property {string} action - 动作类型 (exec, list, create, kill, help, status)
 * @property {string} [session] - tmux 会话名
 * @property {string[]} args - 参数列表
 * @property {string} [command] - 要执行的命令（仅 exec 动作）
 * @property {Object} options - 选项
 */
```

---

## 三、指令路由

### 路由表

```javascript
// src/command_router.js

import { parseCommand } from './command_parser.js';

/**
 * 指令处理器映射
 */
const handlers = new Map();

/**
 * 注册指令处理器
 */
export function registerHandler(action, handler) {
  handlers.set(action, handler);
}

/**
 * 路由指令到对应处理器
 */
export async function routeCommand(input, context) {
  const parsed = parseCommand(input);
  
  if (!parsed) {
    return null; // 非指令，忽略
  }
  
  const handler = handlers.get(parsed.action);
  
  if (!handler) {
    return {
      success: false,
      message: `未知动作: ${parsed.action}\n输入 /cmd help 查看帮助`
    };
  }
  
  try {
    const result = await handler(parsed, context);
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      message: `执行失败: ${error.message}`,
      error
    };
  }
}
```

---

## 四、飞书端输入优化

### 问题

在飞书聊天框中输入命令有以下不便：
1. 需要手动输入 session 名
2. 命令历史不易查看
3. 复杂命令容易出错

### 优化方案

#### 方案一：会话状态记忆（推荐实现）

机器人记住最后操作的 session，后续命令可省略：

```bash
# 首次指定 session
/cmd opencode ls

# 后续命令自动使用上一个 session
/cmd pwd
/cmd npm run dev

# 切换 session
/cmd mysession ls
```

**实现要点**：
- 在 context 中维护 `lastSession` 状态
- 解析时检查是否有 session，无则使用 `lastSession`

#### 方案二：消息卡片快捷按钮（后续优化）

发送带有按钮的消息卡片，点击即可执行命令：

```json
{
  "elements": [
    { "tag": "markdown", "content": "**会话: opencode**" },
    { "tag": "action", "actions": [
      { "tag": "button", "text": { "content": "ls -la" }, "value": "cmd:opencode:ls -la" },
      { "tag": "button", "text": { "content": "status" }, "value": "cmd:opencode:status" }
    ]}
  ]
}
```

#### 方案三：命令补全提示（后续优化）

输入 `/cmd ` 后，机器人返回可选 session 列表：

```
📍 可用会话:
- opencode
- myproject

输入 session 名后继续输入命令，如:
/cmd opencode ls -la
```

---

## 五、错误处理

### 错误类型

| 错误 | 提示语 | 处理方式 |
|------|--------|----------|
| 会话不存在 | `会话 "{session}" 不存在` | 列出可用会话 |
| 命令为空 | `请输入要执行的命令` | 显示帮助 |
| 鉴权失败 | `无权限执行此操作` | 静默丢弃 |
| 执行超时 | `命令执行超时` | 建议 kill 会话 |

### 错误消息格式

```javascript
function formatError(error, context) {
  return {
    success: false,
    message: error.message,
    hint: error.hint || null,
    stack: process.env.LOG_LEVEL === 'debug' ? error.stack : undefined
  };
}
```

---

## 六、完整指令列表

| 指令 | 说明 | 示例 |
|------|------|------|
| `/cmd help` | 显示帮助 | `/cmd help` |
| `/cmd list` | 列出所有会话 | `/cmd list` |
| `/cmd create <name>` | 创建会话 | `/cmd create opencode` |
| `/cmd kill <name>` | 终止会话 | `/cmd kill opencode` |
| `/cmd status [name]` | 查看会话状态 | `/cmd status opencode` |
| `/cmd <session> <command>` | 执行命令 | `/cmd opencode ls -la` |

---

## 七、参考实现

- [Slack Bolt - 命令处理](https://github.com/slackapi/bolt-js)
- [Discord.js - 命令注册](https://github.com/discordjs/discord.js)
- [Telegraf - Telegram Bot](https://github.com/telegraf/telegraf)
