import Link from "next/link";
import { LogoFull } from "@/components/brand/logo";
import { routes } from "@/core/routes";

/**
 * Auth route group layout — 简约居中单列：
 * 顶部 full logo（横排字标，点击回首页），下方即各页面的表单卡片。
 * 旧版双栏品牌面板（左侧动效深色 aside）已按产品决策移除。
 *
 * 依赖核查（无需重复提供）：全局 providers 挂在根 layout（I18nProvider /
 * DataProvider / Theme 等），auth 表单的 useI18n 直接可用。
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-16 pt-[8vh]">
      <div className="w-full max-w-md">
        {/* 品牌头部：full logo（SVG 黑色填充，深色模式自动反白） */}
        <Link
          href={routes.home}
          aria-label="comit.sh"
          className="mb-8 flex justify-center transition-opacity hover:opacity-80"
        >
          <LogoFull height={34} />
        </Link>
        {children}
      </div>
    </div>
  );
}
