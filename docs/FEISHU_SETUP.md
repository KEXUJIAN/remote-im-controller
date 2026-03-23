# 飞书开放平台配置说明书

本文档详细说明如何配置飞书开放平台，使应用能够通过 WebSocket 长连接接收远程指令。

---

## 一、前置条件

- 拥有飞书管理员权限（用于创建和发布应用）
- 飞书开放平台账号：https://open.feishu.cn

---

## 二、创建应用

### 步骤 1：进入开发者控制台

访问 https://open.feishu.cn/app ，点击「创建企业自建应用」。

### 步骤 2：填写应用信息

| 字段 | 建议值 |
|------|--------|
| 应用名称 | `Remote IM Controller` |
| 应用描述 | `远程终端控制器 - 通过飞书控制 WSL 终端` |
| 应用图标 | 自定义上传 |

### 步骤 3：记录凭证

创建完成后，在「凭证与基础信息」页面记录：

```
App ID: cli_xxxxxxxxxxxx
App Secret: xxxxxxxxxxxxxxxxxxxx
```

> ⚠️ **重要**：App Secret 仅显示一次，请立即保存到 `.env` 文件中。

---

## 三、启用机器人能力

### 步骤 1：添加机器人功能

1. 进入应用详情页
2. 点击「添加功能」
3. 搜索并添加「机器人」

**官方文档**: [如何启用机器人能力](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-enable-bot-ability)

### 步骤 2：配置机器人信息

| 字段 | 建议值 |
|------|--------|
| 机器人名称 | `终端控制器` |
| 机器人描述 | `远程控制 WSL 终端` |
| 机器人头像 | 建议使用终端图标 |

---

## 四、配置权限

### 必需权限清单

| 权限名称 | 权限标识 | 用途 |
|----------|----------|------|
| 获取发送给机器人的私聊消息 | `im:message.p2p_msg:readonly` | 接收私聊指令 |
| 获取群聊中@机器人的消息 | `im:message.group_at_msg:readonly` | 接收群聊指令 |
| 获取用户基本信息 | `contact:user.base:readonly` | 获取发送者信息 |
| 获取用户 ID | `contact:user.employee_id:readonly` | 鉴权验证 |

### 配置步骤

1. 进入「权限管理」页面
2. 搜索上述权限并添加
3. 确认权限范围

**官方文档**: [权限管理概述](https://open.feishu.cn/document/home/introduction-to-scope-and-authorization/authorization-management)

---

## 五、配置事件订阅（WebSocket 长连接）

### 步骤 1：选择订阅方式

1. 进入「事件订阅」页面
2. 选择「使用长连接接收事件」

**官方文档**: [WebSocket 长连接配置](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case)

### 步骤 2：添加事件

搜索并添加以下事件：

| 事件名称 | 事件类型 | 说明 |
|----------|----------|------|
| 接收消息 | `im.message.receive_v1` | 接收用户发送给机器人的消息 |

**官方文档**: [添加事件](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/subscription-event-case)

### 步骤 3：事件版本

推荐使用 **v2.0** 版本，事件结构更完善。

> ⚠️ 避免同时订阅 v1.0 和 v2.0，会导致重复接收事件。

---

## 六、获取管理员 User ID

### 方法一：通过 API 获取

1. 先启动应用（哪怕只是基础框架）
2. 给机器人发送一条测试消息
3. 查看日志中的 `event.sender.sender_id.open_id`

### 方法二：通过控制台

暂无直接查看方式，建议使用方法一。

### 鉴权字段说明

```json
{
  "event": {
    "sender": {
      "sender_id": {
        "open_id": "ou_xxxxxxxxxxxx",   // 推荐：应用内唯一标识
        "user_id": "xxxxxxxxxxxxxx",     // 租户内唯一标识
        "union_id": "on_xxxxxxxxxxxx"    // 跨应用统一标识
      }
    }
  }
}
```

**推荐使用 `open_id` 进行鉴权**，因为它是应用级别的唯一标识。

**官方文档**: [用户身份介绍](https://open.feishu.cn/document/home/user-identity-introduction/introduction)

---

## 七、发布应用

### 步骤 1：创建版本

1. 进入「版本管理与发布」
2. 点击「创建版本」
3. 填写版本说明

### 步骤 2：提交审核

1. 确认权限配置无误
2. 提交审核

### 步骤 3：配置可用范围

审核通过后：
1. 进入「应用可用性」
2. 设置可用范围（建议设为全员可见）

**官方文档**: [应用可用性配置](https://open.feishu.cn/document/home/introduction-to-scope-and-authorization/availability)

---

## 八、环境变量配置

将以下信息填入 `.env` 文件：

```bash
# 飞书应用凭证
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# 管理员 Open ID（用于鉴权）
ADMIN_OPEN_ID=ou_xxxxxxxxxxxx

# 可选：日志级别 (debug, info, warn, error)
LOG_LEVEL=debug
```

---

## 九、验证配置

### 检查清单

- [ ] 应用已创建，App ID 和 App Secret 已记录
- [ ] 机器人功能已启用
- [ ] 权限已配置（`im:message.p2p_msg:readonly` 等）
- [ ] 事件订阅已配置（`im.message.receive_v1`）
- [ ] 应用已发布并配置可用范围
- [ ] 管理员 Open ID 已获取并配置

### 测试连接

启动应用后，给机器人发送消息：
```
hello
```

如果配置正确，日志中会显示收到消息的事件详情。

---

## 十、相关文档链接汇总

| 文档 | 链接 |
|------|------|
| 飞书开放平台首页 | https://open.feishu.cn |
| 开发者控制台 | https://open.feishu.cn/app |
| 事件订阅概述 | https://open.feishu.cn/document/ukTMukTMukTM/uUTNz4SN1MjL1UzM |
| WebSocket 长连接配置 | https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case |
| 接收消息事件 | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive |
| Node.js SDK 文档 | https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/server-side-sdk/nodejs-sdk/preparation-before-development |
| 消息卡片 JSON 结构 | https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-structure |
| 快速开发 Echo Bot | https://open.feishu.cn/document/uAjLw4CM/uMzNwEjLzcDMx4yM3ATM/develop-an-echo-bot/introduction |

---

## 十一、常见问题

### Q1: 收不到消息事件？

检查项：
1. 事件是否已添加并保存
2. 应用是否已发布
3. 是否有正确权限
4. WSS 连接是否成功建立（查看日志）

### Q2: 消息卡片发送失败？

检查项：
1. 是否有 `im:message:send_as_bot` 权限
2. 卡片 JSON 格式是否正确
3. `receive_id_type` 是否与 `receive_id` 类型匹配

### Q3: 如何调试？

设置环境变量 `LOG_LEVEL=debug`，SDK 会输出详细的连接和事件日志。
