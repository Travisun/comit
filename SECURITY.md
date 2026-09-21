# Security Policy / 安全政策

## 现状声明

本项目为个人开发的多用户博客/社交内容平台，已做过一轮系统性的安全审计
（认证与会话、授权与越权、注入/RCE/SSRF、XSS 内容管线、发布卫生），
但**不保证不存在未被发现的安全缺陷**。代码按 MIT 协议「原样（AS IS）」提供，
使用者需自行评估并承担部署风险，详见 README 的「免责声明」。

## 报告漏洞

请不要通过公开的 GitHub Issue 报告安全问题。

- **首选**：仓库页 → Security → **Report a vulnerability**（GitHub 私有漏洞报告，
  仅仓库协作者可见，支持加密附件）
- 若该仓库未开启私有漏洞报告，请开一个**不含漏洞细节**的 Issue（标题仅写
  "security report"），作者在 Issue 内回复引导到私密渠道后再披露细节

我们承诺在 7 天内回复确认。请在公开披露前给我们合理的修复窗口
（协调式披露，Coordinated Disclosure）。

## 部署侧的硬性要求（务必阅读）

以下配置错误会直接导致全局限流失效或账户接管，属于「部署者责任边界」：

1. **永远不要把应用端口（3000）直接暴露到公网**。必须经 nginx/CDN 反代。
   直连暴露时攻击者可伪造 `X-Real-IP` / `X-Forwarded-For` 绕过所有按 IP 的
   限流（登录防爆破、注册、2FA 挑战等）。
2. `TRUST_PROXY` 必须与真实拓扑一致：直连 = `direct`，nginx 前置 = `nginx`。
3. 生产环境必须为 HTTPS（cookie `Secure`、WebAuthn、OAuth 回调均依赖）。
4. `AUTH_SECRET` 使用 ≥32 字符随机值（生产启动时 fail-fast 校验）。
5. 不要在生产环境执行 `pnpm db:seed`（种子管理员密码是公开的）；
   若误执行，立即修改管理员密码。
6. Cloudflare Access 登录必须配置 `CF_ACCESS_AUD`（留空会禁用该登录方式）。
