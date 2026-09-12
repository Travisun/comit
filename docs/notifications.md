# 通知系统（Notifications）

多频道通知架构 + 可管理可定制的邮件模板中心。覆盖三块能力：

1. **事件 → 通知**：领域事件由 `notifications` 插件监听，经 `notifySend` 按用户偏好分发到频道；
2. **邮件模板中心**（`/admin/templates`）：管理员可定制 / 停用每封邮件的主题与正文，支持变量占位与在线预览；
3. **操作通知助手**（`@/lib/operation-notify`）：管理侧操作（封禁、警告、认证审核等）向用户发通知的统一入口。

---

## 1. 架构总览

```
┌─────────────┐   emit()   ┌──────────────┐  sendOperationNotification / 直接 notifySend
│ 业务/管理侧  │ ─────────▶ │  bus (Emittery)│ ────────────────┐
│ (routes/代理)│            └──────────────┘                  │
└─────────────┘                     │ ctx.events.on(...)    ▼
                          src/plugins/notifications.ts  notifySend(userId, message)
                                                        │
                                     users.notificationPrefs[key] ?? ["database","mail"]
                                     + 站点级开关 notify.emailEnabled（过滤 mail 频道）
                                                        │
              ┌──────────────────┬──────────────────────┼──────────────────┐
              ▼                  ▼                      ▼                  ▼
        database 频道        mail 频道            webhook 频道         其他自定义频道
     写 notifications 表   renderTemplate()     webhooks 插件注册      （任何插件可
     （站内标题/正文由      / renderSystemMail()  HMAC 签名投递          registerChannel）
       发送处直接生成）      → queue "mail.send"
                                │
                          workers.ts → sendMail()（SMTP；未配置 SMTP_HOST 时 console.warn）
```

关键文件：

| 文件 | 职责 |
| --- | --- |
| `src/core/events.ts` | 事件类型 `AppEventPayloads` 与 `emit()` |
| `src/plugins/notifications.ts` | database / mail 频道、`notifySend`、操作事件监听 |
| `src/core/plugins/types.ts` | `NotificationMessage` / `NotificationChannel` / 频道注册表 |
| `src/lib/operation-notify.ts` | `sendOperationNotification(userId, notice)`（不抛错的统一入口） |
| `src/lib/mail-templates.ts` | 模板注册表 `MAIL_TEMPLATES`、覆盖层存取、`renderTemplate` / `renderSystemMail` |
| `src/lib/mail.ts` | SMTP 发送、品牌布局 `layout()`、内置文案 `renderBuiltinMail`、覆盖感知的 `renderMail` |
| `src/app/admin/templates/**`、`src/app/api/admin/templates/**` | 模板管理中心（页面 + API，权限 `admin.templates`，仅 admin） |

## 2. 用户级偏好与站点级开关

- **用户级**：`users.notificationPrefs`（jsonb）：`{ [notificationKey]: string[] }`，值为频道 id 列表
  （`database` / `mail` / `webhook`…）。未配置的 key 回落 `DEFAULT_CHANNELS = ["database", "mail"]`。
  用户在 `/settings` 通知面板自行调整。
- **站点级**：settings 键 `notify.emailEnabled`（`/admin/settings`）。为 `false` 时 `notifySend` 会把
  `mail` 频道从投递目标中过滤掉（站内/webhook 不受影响）。

## 3. 邮件模板中心

### 3.1 覆盖存储

settings 键 **`mailTemplateOverrides`**（jsonb）：

```jsonc
{
  "verifyEmail": {
    "subjectZh": "【{{siteName}}】请验证邮箱",
    "subjectEn": "",
    "bodyZh": "<p>感谢注册，点击下方按钮完成验证。</p>",
    "bodyEn": "",
    "enabled": true
  }
}
```

- 字段均可选；**空串 / 未提供 → 回落内置文案**；
- `enabled: false` → 模板整体停用：`renderMail` 返回空串，邮件频道跳过投递并输出
  `console.info("[notify] mail skipped: …")`；
- 覆盖正文为 **HTML 片段**，渲染后嵌入 `layout()` 品牌布局（页头站点名 + 页脚免责与链接）。

### 3.2 变量与渲染规则

- 占位语法 `{{variable}}`，未提供的变量替换为空串；所有模板额外可用 `{{siteName}}`；
- 覆盖主题同样支持 `{{variable}}` 替换；
- `layout(locale, body, { heading })` 与内置文案 `renderBuiltinMail()` 均在 `src/lib/mail.ts` 导出。

### 3.3 模板变量表

| key | 名称 | 变量 | 触发点 |
| --- | --- | --- | --- |
| `verifyEmail` | 邮箱验证 | `siteName`, `url` | 注册 / 重发验证邮件 |
| `resetPassword` | 重置密码 | `siteName`, `url` | 忘记密码（链接 30 分钟有效） |
| `commentReply` | 评论回复 | `siteName`, `actor`, `post`, `excerpt`, `url` | 评论文章 / 回复评论 |
| `newFollower` | 新的关注者 | `siteName`, `actor`, `url` | 被关注 |
| `newMessage` | 新私信 | `siteName`, `actor`, `excerpt`, `url` | 收到私信 |
| `moderationRejected` | 审核未通过 | `siteName`, `post`, `reason`, `url` | 文章审核驳回 |
| `accountDeleted` | 账户已删除 | `siteName` | 注销完成 |
| `test` | SMTP 测试 | `siteName` | 管理员测试 SMTP |
| `system` | 系统/操作通知 | `siteName`, `title`, `body`, `url`, `reason` | 所有 `system.*` / `verification.*` 通知（见 §5） |

各变量在预览 API 中使用 `SAMPLE_TEMPLATE_DATA`（`src/lib/mail-templates.ts`）中的示例值，如
`actor=演示用户`、`url=${config.app.url}/…`。

### 3.4 system 模板（通用操作通知）

通知 key 前缀为 `system.` 或 `verification.` 的消息不走专属模板，而是统一渲染 **system** 模板：

- 入参来自通知消息本身：`title` / `body`（按收件人 locale 取 zh/en）、`url`（`message.url`）、
  `reason`（`message.payload.reason`，存在时以引用块展示）；
- 内置组合：标题行 + 正文 + 可选原因引用块 + 可选「查看详情」链接；覆盖后则完全以覆盖正文为准；
- 停用 system 模板会同时停用全部操作通知邮件（站内通知不受影响）。

### 3.5 管理中心（/admin/templates，仅 admin）

- 左侧模板列表：名称 / key / 状态 Badge（默认 · 已定制 · 已停用）；
- 右侧编辑器：启用 Switch、中英主题、中英正文（等宽字体）、变量 chips（点击插入到最近聚焦的输入框）、
  「保存」「重置为默认」「预览」；
- 预览 Dialog：中英 Tab 切换 + 桌面/手机宽度切换，iframe `sandbox` 沙箱渲染 HTML；
  预览包含未保存的编辑内容（随请求发送），保存后方实际生效。

### 3.6 API

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/admin/templates` | `{ templates: MAIL_TEMPLATES + override/customized/enabled 合并态 }` |
| `POST /api/admin/templates/[key]` | body `{ subjectZh?, subjectEn?, bodyZh?, bodyEn?, enabled? }`，增量合并保存 |
| `POST /api/admin/templates/[key]/reset` | 删除覆盖，回落内置 |
| `POST /api/admin/templates/[key]/preview` | body `{ locale, data?, subjectZh?…bodyEn? }` → `{ subject, html }`（示例变量 + 覆盖合并渲染） |

全部经 `withPermission(req, "admin.templates")` 校验（仅 admin），写操作记录 `mod_logs` 审计。

### 3.7 新增邮件模板的开发步骤

1. `src/lib/mail.ts`：在 `MailTemplateKey` 联合类型中加入新 key，并在 `renderBuiltinMail` 的
   switch 中实现内置主题/正文（使用 `layout()` / `button()`）；
2. `src/lib/mail-templates.ts`：在 `MAIL_TEMPLATES` 注册 `MailTemplateDef`（名称、描述、变量表），
   并在 `SAMPLE_TEMPLATE_DATA` 中补预览示例值；
3. 发送处调用 `renderMail(key, locale, data)`（直接调用）或经通知频道映射
   （`src/plugins/notifications.ts` 的 mailChannel key 前缀映射）；
4. 管理中心与覆盖层自动生效，无需额外接线；补充本文档变量表。

## 4. 操作通知事件 → 通知映射

监听注册于 `src/plugins/notifications.ts#register`，统一经
`sendOperationNotification(userId, notice)`（`@/lib/operation-notify`）投递——内部调
`notifySend`，全程 try/catch，**通知失败不影响主流程**。

| 事件（payload） | 通知 key | 站内标题 | 正文要点 | 邮件 |
| --- | --- | --- | --- | --- |
| `user:banned` `{ userId, bannedUntil(ISO\|null), reason, byAdminId }` | `system.ban` | 账号封禁通知 / Account suspended | 原因；`bannedUntil` 存在→解封时间（本地化），否则「永久封禁」 | system 模板 |
| `user:unbanned` `{ userId, byAdminId }` | `system.unban` | 封禁已解除 / Ban lifted | 封禁解除、欢迎回来 | system 模板 |
| `user:warned` `{ userId, message, byAdminId }` | `system.warn` | 警告通知 / Warning notice | `message` 原文 | system 模板 |
| `verification:approved` `{ userId, type, label }` | `verification.approved` | 认证审核通过 / Verification approved | 恭喜 + `label`/`type` | system 模板 |
| `verification:rejected` `{ userId, reason }` | `verification.rejected` | 认证审核未通过 / Verification rejected | 未通过原因 `reason` | system 模板 |

`payload` 字段名与 `src/core/events.ts` 中 `AppEventPayloads` 保持一致；`byAdminId` 只入 payload
（审计可查 mod_logs），不展示给用户。

站内通知（database 频道）主要 key 与触发点：

| key 前缀 / key | 触发点 |
| --- | --- |
| `comment.*` | 评论 / 回复 |
| `follow.*` | 关注 |
| `message.*` | 私信 |
| `moderation.*` | 内容审核结果 |
| `system.ban` / `system.unban` / `system.warn` | 封禁 / 解封 / 警告（管理操作） |
| `verification.approved` / `verification.rejected` | 认证审核结果 |

## 5. 预览与测试建议

1. **管理界面预览**：`/admin/templates` → 选模板 → 编辑 → 「预览」切换中英与手机宽度；
2. **curl 自测**（需 admin 会话/Cookie）：

   ```bash
   # 列表（含合并态）
   curl -s http://localhost:3000/api/admin/templates -H "Cookie: mb_session=…" | jq

   # 覆盖中文主题
   curl -s -X POST http://localhost:3000/api/admin/templates/commentReply \
     -H "Content-Type: application/json" -H "Cookie: mb_session=…" \
     -d '{"subjectZh":"{{actor}} 在 {{siteName}} 回复了你"}'

   # 预览（应输出替换后的主题）
   curl -s -X POST http://localhost:3000/api/admin/templates/commentReply/preview \
     -H "Content-Type: application/json" -H "Cookie: mb_session=…" \
     -d '{"locale":"zh"}' | jq -r .subject

   # 重置
   curl -s -X POST http://localhost:3000/api/admin/templates/commentReply/reset \
     -H "Cookie: mb_session=…"
   ```

3. **双投递自测**：伪造一条操作事件（tsx 临时脚本：`dotenv` + `bootPlugins()` + `emit("user:banned", …)`），
   验证 `notifications` 表新增 `system.ban` 行（站内），且 SMTP 未启用时 worker 输出
   `[mail] would send …`；
4. **停用验证**：将某模板 `enabled: false` 后触发对应邮件，应看到
   `[notify] mail skipped: …`（console.info），站内/webhook 不受影响；
5. 本地开发建议用 Mailpit / Mailhog 类工具监听 `SMTP_PORT`（示例环境为 `localhost:1025`）直接查看渲染效果。
