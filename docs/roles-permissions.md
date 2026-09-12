# 角色与权限体系（Roles & Permissions）

> 代码入口：`src/lib/permissions.ts`（RBAC）、`src/lib/tiers.ts`（会员等级）、`src/lib/verification.ts` + `src/lib/verification.server.ts`（V 认证）。
> 数据模型：`users.role`（user/editor/admin）、`users.tier`（1..3）、`users.verified`（jsonb 徽章）、`verification_requests`（申请流水）、`mod_logs`（审核审计）。

---

## 1. 角色（Roles）

| 能力 | user | editor | admin |
| --- | :-: | :-: | :-: |
| 注册/登录/写作/评论/私信等前台功能 | ✅ | ✅ | ✅ |
| 进入后台 `/admin`（`admin.access`） | ❌ | ✅ | ✅ |
| 内容审核队列（机审转人工） | ❌ | ✅ | ✅ |
| 评论管理 / 举报处理 | ❌ | ✅ | ✅ |
| **V 认证审核台** `/admin/verification` | ❌ | ✅ | ✅ |
| 文章管理（全站） | ❌ | ✅ | ✅ |
| 站点设置 / 关键词 / LLM 策略 | ❌ | ❌ | ✅ |
| 用户管理（封禁、角色、tier） | ❌ | ❌ | ✅ |
| 全站媒体 / 审计日志 / 运维面板 | ❌ | ❌ | ✅ |

- 页面守卫：`await requirePageRole("admin.verification")`（无权限时 redirect 到 `/admin`）。
- API 守卫：`withPermission(req, "admin.verification", handler)`（无权限时 403）。
- 后台布局 `src/app/admin/layout.tsx` 按 `can(role, "admin.access")` 放行，侧边栏 `admin-nav.tsx` 按 role 过滤入口（`/admin/verification` 对 admin+editor 可见）。

### editor 的边界

editor 是**内容运营**角色，不是管理员：

1. 可以做一切"审内容 + 审认证"的事：待审队列、评论、举报、V 认证（通过/驳回/撤销）。
2. 不能动"站点与用户"：`admin.settings`、`admin.users`、`admin.templates`、`admin.media`、`admin.audit`、`admin.ops` 均为 admin 专属。
3. editor 执行的审核动作同样写入 `mod_logs`（`adminId` 记录实际操作人），可被 admin 在审计日志中追溯。

## 2. 权限点全表（`PERMISSIONS`）

| 权限点 | 允许角色 | 用途 |
| --- | --- | --- |
| `admin.access` | admin, editor | 进入后台 |
| `admin.dashboard` | admin, editor | 后台首页/统计 |
| `admin.moderate` | admin, editor | 内容审核（机审转人工、通过/驳回文章） |
| `admin.comments` | admin, editor | 评论管理（隐藏/恢复/删除） |
| `admin.reports` | admin, editor | 举报处理 |
| `admin.verification` | admin, editor | **V 认证审核**（列表/通过/驳回/撤销） |
| `admin.posts` | admin, editor | 全站文章管理 |
| `admin.settings` | admin | 站点设置 |
| `admin.users` | admin | 用户管理（角色/封禁/tier） |
| `admin.templates` | admin | 主题模板管理 |
| `admin.media` | admin | 全站媒体管理 |
| `admin.audit` | admin | 审计日志（mod_logs） |
| `admin.ops` | admin | 运维面板（队列、缓存等） |

新增权限点时同步：`PERMISSIONS` 表 → `admin-nav.tsx`（如需入口）→ 本文档。

## 3. 会员等级（VIP Tiers）

定义在 `src/lib/tiers.ts`（纯数据 + 钩子，无升级入口，为付费插件预留）。

| Tier | 免费 | 邀请码上限 | 单图上限 | 视频上传 | 专属客服 |
| --- | :-: | :-: | :-: | :-: | :-: |
| VIP 1 · 标准 | ✅（注册默认） | 5 | 200 MB | 预留（暂未开放） | ❌ |
| VIP 2 · 进阶 | 预留 | 15 | 1 GB | 预留 | ❌ |
| VIP 3 · 尊享 | 预留 | 50 | 4 GB | 预留 | ✅ |

### 升级钩子（未来付费插件接入路径）

```
支付插件（Stripe/虎皮椒…）
  → 支付回调校验
  → db：users.tier = 2|3
  → emit("user:tier.changed", { userId, from, to })   ← 事件名预留
  → 所有读取限额的地方即时生效
```

- 限额读取统一走 `applyTierLimits(tierId)`：先取 `TIERS` 基础限额，再依次套用 `tierHooks.resolveLimits` 注册的钩子。付费插件在启动时 `registerTierLimitHook((tierId, limits) => ({ ...limits, maxInvites: 999 }))` 即可改写限额，无需改业务代码。
- **主代集成 TODO**：`src/lib/auth/invite.ts` 的 `MAX_INVITES_PER_USER` 常量应替换为 `applyTierLimits(user.tier).maxInvites`（`createInvite` 与 `/api/me/invites` 的 remaining/max 计算同步）；媒体上传 `/api/media/upload` 的体积上限同理替换为 `applyTierLimits(...).maxMediaMb`。为避免多代理冲突，本次未改动这两个文件。

## 4. V 认证机制（Verification）

### 4.1 认证类型

定义在 `src/lib/verification.ts` 的 `VERIFICATION_TYPES`：

| type | 名称 | 说明 | 徽章颜色 |
| --- | --- | --- | --- |
| `personal` | 个人认证 | 实名/身份类认证 | 蓝（blue-500） |
| `creator` | 创作者认证 | 持续产出优质内容 | 紫（purple-500） |
| `professional` | 职业认证 | 职业资质/公司职位 | 青绿（teal-500） |
| `organization` | 机构认证 | 企业/团队/组织号 | 金（amber-500） |

升级路径（`VERIFICATION_UPGRADE_PATHS`）：personal → creator/professional/organization；creator → professional/organization；professional → organization；organization 为终点。设置页的「重新认证」入口只在存在可升级目标时展示。

### 4.2 流程：申请 → 审核 → 展示

```
用户（/settings?tab=verification）
  选择类型 → 认证名称(2..80) + 说明(10..500) + 附件(1..3，必须是本人媒体库 path)
  → POST /api/me/verification            （已有 pending → 409）
  → 审核台（/admin/verification，admin+editor）
     ├ 通过  POST /api/admin/verification/[id]/approve
     │    事务：请求行 → approved + users.verified={type,label,approvedAt}
     │    emit("verification:approved") + sendOperationNotification("verification.approved") + mod_logs
     ├ 驳回  POST /api/admin/verification/[id]/reject   （必填原因 ≤300）
     │    事务：请求行 → rejected（不动 users.verified）
     │    emit("verification:rejected") + notification + mod_logs
     └ 撤销  POST /api/admin/verification/[id]/revoke   （仅已通过列表）
          事务：users.verified → null + notification("verification.revoked") + mod_logs
  → 用户可 DELETE /api/me/verification?id= 撤回自己的 pending
  → 展示：<VerifiedBadge verified={user.verified}/>，hover 显示「{类型} · {名称} · 于 {date} 认证」
```

### 4.3 徽章语义与颜色

- `<VerifiedBadge>`（`src/components/user-space/verified-badge.tsx`）用 lucide `BadgeCheck` 实心填充对应颜色 + 白色对勾，外包 Tooltip；`verified` 为空时不渲染。
- 颜色即类型：**蓝=个人、紫=创作者、青绿=职业、金=机构**（`VERIFICATION_BADGE_STYLES`，含 chip/card 变体供卡片复用）。
- 前台插入建议（主代集成）：
  - **profile-view.tsx `ProfileHero`**：`<h1>` 的 displayName 之后加 `<VerifiedBadge verified={user.verified} size="md" />`（与名字同行，参照微博/B站主页）；
  - `article-card.tsx` / `short-card.tsx` 作者行：作者名后加 `size="sm"`；
  - 私信/评论作者等处同样以 `sm` 尺寸插入。注意这些是 server 组件，直接渲染 client 组件即可（Badge 自带 Tooltip Provider 已挂在根布局）。

### 4.4 数据模型

```
users.verified  jsonb | null   → { type: string, label: string, approvedAt: ISO }
verification_requests
  id uuid, userId → users, type varchar(32), label varchar(80),
  description varchar(500), attachments jsonb string[]（本人 media.path）,
  status varchar(16) pending|approved|rejected, rejectReason varchar(300),
  reviewedBy uuid → users, reviewedAt timestamptz, createdAt timestamptz
mod_logs                        → action: verification.approve|verification.reject|verification.revoke
```

审核事务封装在 `src/lib/verification.server.ts`（`approveRequest` / `rejectRequest` / `revokeVerification`，`SELECT … FOR UPDATE` 防并发双审）；`src/lib/verification.ts` 为纯常量/视图模型（client 安全，VerifiedBadge 从这里复用 `VERIFICATION_TYPE_MAP`）。

### 4.5 与平台信誉体系的展望

认证徽章是信誉体系的身份锚点，后续可叠加：

1. **信誉分**：以 `verification:approved/rejected`、内容通过率、举报核实率等事件累积信誉分（`@/core/events` 已具备全部钩子）；
2. **认证与 tier 联动**：VIP2+ 可走快速审核通道（`tierHooks` 思路的审核侧镜像）；
3. **机构号子成员**：organization 认证持有者可绑定子账号，徽章继承；
4. **徽章历史**：`verification_requests` 已保留完整流水，可在公开主页展示"认证于 xxxx 年" heritage 信息或撤销记录。
