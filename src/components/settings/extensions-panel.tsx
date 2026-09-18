"use client";

import Link from "next/link";
import { ChevronRight, Puzzle } from "lucide-react";
import { SettingsSection, SettingsSectionHeader } from "@/components/ui/settings";
import { EXTENSION_MANIFESTS } from "@/extensions/_boot/manifests";
import type { SettingsData } from "./types";

/**
 * 设置 → 扩展 — 三级架构的列表层：仅展示**注册了前台设置项**的扩展
 * （manifest.settingsFields 非空；纯后台能力的扩展不在此出现）。
 * 点击行进入 扩展子设置页 /settings/extensions/[extId]（表单层）。
 * 管理员级扩展配置（启停、全局参数）在管理后台，与本页（用户级、按
 * 用户隔离存储）权限边界互不重叠 —— 详见 core/capabilities/manifest.ts。
 */
export function ExtensionsPanel({ data }: { data: SettingsData }) {
  void data; // 列表层不消费设置值（子页经 /api/me/ext/<id>/settings 拉取）
  const configurable = EXTENSION_MANIFESTS.filter((m) => (m.settingsFields?.length ?? 0) > 0);

  if (configurable.length === 0) {
    return (
      <SettingsSection>
        <SettingsSectionHeader description="当前没有提供前台设置项的扩展。" />
      </SettingsSection>
    );
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader description="以下扩展提供个人偏好设置，数据按扩展命名空间隔离存储；点击进入具体设置。" />
      <ul>
        {configurable.map((m) => (
          <li key={m.id}>
            <Link
              href={`/settings/extensions/${m.id}`}
              className="flex items-center gap-2.5 rounded-lg px-2 py-3 transition-colors hover:bg-[var(--hover)] focus-visible:bg-[var(--hover)] focus-visible:outline-none"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--muted)] text-muted-foreground">
                <Puzzle className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {m.title.zh}
                  <span className="text-xs font-normal text-muted-foreground">
                    {m.id} · v{m.version}
                  </span>
                </span>
                {m.description && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {m.description.zh}
                  </span>
                )}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
