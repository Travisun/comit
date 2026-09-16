/**
 * Auth route group layout — 结构化"裸页"事实。
 *
 * 登录 / 注册 / 2FA / 邮箱验证等页面原本放在 (site) 组内，靠
 * SiteShell 的客户端字符串前缀判断（BARE_PREFIXES 含 "/auth"）绕过三栏壳；
 * 现移入独立路由组，布局层即是裸页事实，不再依赖客户端前缀匹配。
 *
 * 依赖核查（无需重复提供）：
 *  - I18nProvider / DataProvider / ThemeProvider / TooltipProvider / Toaster
 *    全部挂在根 layout（src/app/layout.tsx），auth 表单的 useI18n 直接可用；
 *  - auth 页面自包含（AuthCard 居中卡片 + 服务端 getT/getAuth 守卫各自取数），
 *    从不消费 (site) layout 的 shell 数据——此前 SiteShell 对 /auth 也是
 *    原样透传 children，本布局保持等效的极简容器，不查询任何业务数据。
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
