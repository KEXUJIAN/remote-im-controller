# 指令系统设计说明书

本文档说明远程控制器的指令格式设计、解析方案和交互模式。

---

## 一、指令格式

### 基础指令（无前缀）

用户直接输入指令，无需任何前缀：

```
<action> [args...] [--options]
<session> <command...>
```

### 内置指令列表

| 指令 | 说明 | 示例 |
|------|------|------|
| `help` | 显示帮助 | `help` |
| `list` | 列出所有会话 | `list` |
| `create <name>` | 创建会话 | `create opencode` |
| `kill <name>` | 终止会话 | `kill opencode` |
| `status [name]` | 查看会话状态 | `status opencode` |
| `<session> <command>` | 在会话中执行命令 | `opencode ls -la` |

---

## 二、交互模式

### COMMAND 模式（默认）

用户发送文本消息，机器人解析并执行：

```
用户: list
机器人: 当前会话 (2):
        - opencode
        - myproject
```

### SESSION 模式

用户通过点击卡片按钮进入 SESSION 模式，后续消息直接透传到 tmux：

```
用户: [点击"进入会话"按钮]
机器人: ✅ 已进入会话模式：opencode

用户: ls -la
机器人: [屏幕输出]

用户: pwd
机器人: [屏幕输出]
```

---

## 三、卡片交互

### 会话列表卡片

发送 `list` 指令后返回带按钮的卡片：

```json
{
  "config": { "wide_screen_mode": true },
  "elements": [
    { "tag": "markdown", "content": "**会话列表**" },
    { "tag": "hr" },
    {
      "tag": "action",
      "actions": [
        { "tag": "button", "text": { "content": "opencode" } },
        { "tag": "button", "text": { "content": "进入" } },
        { "tag": "button", "text": { "content": "关闭" } }
      ]
    }
  ]
}
```

### 卡片按钮动作

| 按钮 | 动作 | 行为 |
|------|------|------|
| 会话名 | `enter` | 进入 SESSION 模式 |
| 进入 | `enter` | 进入 SESSION 模式 |
| 关闭 | `kill` | 终止会话 |

---

## 四、机器人菜单

飞书机器人菜单提供快捷操作：

| 菜单项 | 事件 Key | 行为 |
|--------|----------|------|
| 退出会话模式 | `exit_wsl_session_mode` | 退出 SESSION 模式 |

---

## 五、SESSION 模式特性

### 透传命令

SESSION 模式下，用户输入的任何文本都会直接发送到 tmux 会话：

```
用户输入: npm run dev
    │
    ▼
tmux send-keys -t opencode "npm run dev" C-m
    │
    ▼
轮询等待屏幕稳定
    │
    ▼
返回屏幕输出
```

### 轮询等待

命令执行后，系统会轮询等待屏幕稳定：

1. **初始延迟**：500ms 后开始抓取
2. **轮询间隔**：每 3 秒抓取一次（可配置）
3. **稳定判定**：连续 2 次 hash 相同（可配置）
4. **超时保护**：最长等待 60 秒（可配置）

### 流式输出支持

内容变化时持续等待，适用于：
- LLM 流式响应（如 `opencode run "你好"`）
- 长时间运行的命令
- 实时日志输出

---

## 六、解析器实现

### 分词器

处理引号包裹的参数：

```typescript
tokenize('opencode echo "hello world"')
// => ['opencode', 'echo', 'hello world']
```

### 动作识别

```typescript
// 内置动作
['help', 'list', 'create', 'kill', 'status'].includes(first)
  ? { action: first, ... }
  : { action: 'exec', session: first, command: rest.join(' ') }
```

---

## 七、会话状态记忆

机器人记住最后操作的 session：

```
用户: opencode ls          # 首次指定 session
机器人: [输出]

用户: pwd                  # 自动使用上一个 session
机器人: [输出]

用户: myproject ls         # 切换 session
机器人: [输出]
```

---

## 八、错误处理

### 错误类型

| 错误 | 提示语 | 处理方式 |
|------|--------|----------|
| 会话不存在 | `会话 "{session}" 不存在` | 列出可用会话 |
| 命令为空 | `请输入要执行的命令` | 显示帮助 |
| 已在 SESSION 模式 | `当前已在会话模式` | 提示先退出 |
| 执行超时 | `⏱️ 等待超时` | 返回当前内容 |

---

## 九、CLI 测试入口

本地 CLI 支持完整的指令测试：

```bash
npm run local

> help              # 显示帮助
> list              # 列出会话
> create demo       # 创建会话
> /click enter demo # 进入 SESSION 模式（模拟卡片点击）
> ls -la            # 透传命令
> /menu exit        # 退出 SESSION 模式（模拟菜单点击）
> kill demo         # 终止会话
```

**特殊指令**：
- `/click enter <session>` - 模拟卡片"进入"按钮
- `/click kill <session>` - 模拟卡片"关闭"按钮
- `/menu exit` - 模拟菜单"退出会话模式"

**退出 CLI**：`Ctrl+C`
