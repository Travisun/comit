"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BadgeChip } from "@/extensions/badges/badge-ui";
import { cn } from "@/lib/utils";
import { putJsonSafe } from "@/lib/client/api";

export interface ProfileBadge {
  id: string;
  name: string;
  text: string;
  icon: string;
  style: string;
  description: string | null;
  worn: boolean;
}

/**
 * 徽章 · 荣誉墙 — 展示用户获得的全部徽章；
 * 本人视角点击即可佩戴/取下（最多 3 枚，服务端强约束）。
 */
export function ProfileBadges({ initial, isSelf }: { initial: ProfileBadge[]; isSelf: boolean }) {
  const [badges, setBadges] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (badges.length === 0) return null;
  const wornCount = badges.filter((b) => b.worn).length;

  async function toggle(id: string) {
    const wornIds = badges.filter((b) => b.worn && b.id !== id).map((b) => b.id);
    const target = badges.find((b) => b.id === id);
    const nextIds = target?.worn ? wornIds : [...wornIds, id];
    setBusyId(id);
    const r = await putJsonSafe<{ granted: ProfileBadge[] }>("/api/me/badges", { badgeIds: nextIds });
    setBusyId(null);
    if (!r.ok) {
      toast.error(r.error ?? "操作失败");
      return;
    }
    if (r.data?.granted) setBadges(r.data.granted);
  }

  return (
    <section className="mt-4 px-4">
      <h2 className="text-sm font-semibold text-foreground">
        徽章 · 荣誉墙{" "}
        <span className="text-xs font-normal text-muted-foreground">
          {wornCount > 0 ? `佩戴 ${wornCount}/3` : ""}
          {isSelf && " · 点击佩戴或取下（最多佩戴 3 枚）"}
        </span>
      </h2>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        {badges.map((b) => (
          <button
            key={b.id}
            type="button"
            title={b.description ?? b.name}
            onClick={isSelf ? () => void toggle(b.id) : undefined}
            disabled={busyId === b.id}
            className={cn(
              "rounded-xl transition-all",
              isSelf && "cursor-pointer hover:scale-[1.03] active:scale-[0.97]",
              !isSelf && "cursor-default",
              busyId === b.id && "opacity-50",
            )}
          >
            <BadgeChip
              badge={b}
              size="md"
              className={cn(b.worn ? "ring-2 ring-primary/40" : "opacity-60 grayscale-[0.4]")}
            />
          </button>
        ))}
      </div>
      {badges.some((b) => b.worn) && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {badges
            .filter((b) => b.worn)
            .map((b) => `「${b.name}」`)
            .join(" ")}
          {isSelf ? " 佩戴中的徽章会展示在你的所有内容旁。" : ""}
        </p>
      )}
    </section>
  );
}
