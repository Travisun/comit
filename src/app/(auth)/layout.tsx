import { getT } from "@/lib/i18n";
import { getSetting } from "@/lib/settings";

/**
 * Auth route group layout — 产品级分屏裸页：
 *  - 左侧（≥lg）品牌面板：CSS 动效（渐变光斑漂移 / 提交图路径流光 / 节点
 *    脉冲 / 网格底纹）+ 主张与社区三件事文案，登录注册共用一套品牌叙事；
 *  - 右侧表单区：AuthCard 居中卡片（各页面自包含）。
 *
 * 依赖核查（无需重复提供）：全局 providers 挂在根 layout（I18nProvider /
 * DataProvider / Theme 等），auth 表单的 useI18n 直接可用；本布局仅取
 * 文案（getT）与站点名（getSetting，双层缓存），不查询其他业务数据。
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [{ t }, siteName] = await Promise.all([getT(), getSetting("site.name")]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* ------------------------- 品牌面板（≥lg） ------------------------- */}
      <aside className="relative hidden overflow-hidden bg-[#0b0e14] lg:flex lg:w-[46%] lg:flex-col lg:justify-between xl:w-[44%]">
        {/* 网格底纹 */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
            maskImage: "radial-gradient(ellipse 90% 70% at 50% 40%, black 40%, transparent 100%)",
          }}
        />
        {/* 漂移渐变光斑 */}
        <div aria-hidden className="auth-blob absolute -left-24 top-16 size-96 rounded-full blur-3xl" />
        <div aria-hidden className="auth-blob auth-blob-b absolute -right-20 bottom-10 size-[26rem] rounded-full blur-3xl" />

        {/* 品牌头部 */}
        <div className="relative z-10 px-12 pt-12">
          <p className="inline-flex items-center gap-2 font-mono text-sm text-white/80">
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="8" cy="8" r="2.2" fill="currentColor" />
            </svg>
            {siteName}
          </p>
        </div>

        {/* 提交图 SVG 动画 + 主文案 */}
        <div className="relative z-10 px-12">
          <svg viewBox="0 0 520 220" className="mb-8 w-full max-w-lg" aria-hidden>
            {/* 主干与分支路径：流光 */}
            <path d="M20 170 C 120 170, 140 60, 250 60 S 400 120, 500 40" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
            <path d="M20 170 C 120 170, 140 60, 250 60 S 400 120, 500 40" fill="none" stroke="url(#authFlow)" strokeWidth="2" className="auth-flow" strokeDasharray="6 190" />
            <path d="M90 170 C 150 170, 170 120, 230 118" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
            <path d="M90 170 C 150 170, 170 120, 230 118" fill="none" stroke="url(#authFlow)" strokeWidth="2" className="auth-flow auth-flow-slow" strokeDasharray="4 150" />
            <path d="M250 60 C 330 60, 350 150, 430 152" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2" />
            <path d="M250 60 C 330 60, 350 150, 430 152" fill="none" stroke="url(#authFlow)" strokeWidth="2" className="auth-flow auth-flow-slow" strokeDasharray="5 170" />
            <defs>
              <linearGradient id="authFlow" x1="0" x2="1">
                <stop offset="0%" stopColor="rgba(96,165,250,0)" />
                <stop offset="60%" stopColor="rgba(96,165,250,0.9)" />
                <stop offset="100%" stopColor="rgba(167,139,250,0.95)" />
              </linearGradient>
            </defs>
            {/* 提交节点：脉冲 */}
            <g fill="rgba(255,255,255,0.85)">
              <circle cx="20" cy="170" r="4" />
              <circle cx="90" cy="170" r="4" />
              <circle cx="230" cy="118" r="4" />
              <circle cx="250" cy="60" r="5" className="auth-pulse" />
              <circle cx="430" cy="152" r="4" />
              <circle cx="500" cy="40" r="4.5" className="auth-pulse auth-pulse-late" />
            </g>
            {/* 节点光晕 */}
            <g>
              <circle cx="250" cy="60" r="10" fill="none" stroke="rgba(96,165,250,0.5)" className="auth-ring" />
              <circle cx="500" cy="40" r="10" fill="none" stroke="rgba(167,139,250,0.5)" className="auth-ring auth-ring-late" />
            </g>
          </svg>

          <h2 className="max-w-md text-3xl font-bold leading-snug tracking-tight text-white">
            {t("about.hero.title")}
          </h2>
          <p className="mt-3 max-w-md font-mono text-xs leading-relaxed text-white/50">
            {t("brand.commit.mantra")}
          </p>
        </div>

        {/* 三件事 */}
        <ul className="relative z-10 grid gap-3 px-12 pb-12">
          {(
            [
              { k: "home", n: "01" },
              { k: "daily", n: "02" },
              { k: "feed", n: "03" },
            ] as const
          ).map((x) => (
            <li key={x.k} className="flex items-baseline gap-3">
              <span className="font-mono text-xs text-white/35">{x.n}</span>
              <span className="text-sm font-medium text-white/85">{t(`about.things.${x.k}.title`)}</span>
            </li>
          ))}
        </ul>

        {/* 动效样式（类名均带 auth- 前缀，作用域限本面板） */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
.auth-blob { background: radial-gradient(circle at 30% 30%, rgba(59,130,246,0.35), transparent 65%); animation: auth-drift 14s ease-in-out infinite alternate; }
.auth-blob-b { background: radial-gradient(circle at 70% 60%, rgba(139,92,246,0.28), transparent 65%); animation-duration: 18s; animation-direction: alternate-reverse; }
@keyframes auth-drift { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(60px,-40px,0) scale(1.15); } }
.auth-flow { animation: auth-flow 3.2s linear infinite; }
.auth-flow-slow { animation-duration: 4.6s; }
@keyframes auth-flow { from { stroke-dashoffset: 196; } to { stroke-dashoffset: 0; } }
.auth-pulse { animation: auth-pulse 2.6s ease-in-out infinite; }
.auth-pulse-late { animation-delay: 1.1s; }
@keyframes auth-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.auth-ring { transform-origin: center; transform-box: fill-box; animation: auth-ring 2.6s ease-out infinite; }
.auth-ring-late { animation-delay: 1.1s; }
@keyframes auth-ring { 0% { transform: scale(0.6); opacity: 0.9; } 100% { transform: scale(1.9); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .auth-blob, .auth-flow, .auth-pulse, .auth-ring { animation: none !important; } }
`,
          }}
        />
      </aside>

      {/* ---------------------------- 表单区 ---------------------------- */}
      <main className="flex flex-1 items-center justify-center bg-background px-4 py-10 sm:py-14">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
