"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bookmark, Users } from "lucide-react";
import { SettingsSection, SettingsSectionHeader } from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { apiRequest } from "./client";

type Visibility = "public" | "followers" | "friends" | "private";

interface PrivacyInitial {
  followersVisibility: Visibility;
  followingVisibility: Visibility;
  bookmarksVisibility: Visibility;
}

const VISIBILITY_OPTIONS: { value: Visibility; zh: string; en: string }[] = [
  { value: "public", zh: "公开", en: "Public" },
  { value: "followers", zh: "粉丝可见", en: "Followers" },
  { value: "friends", zh: "好友可见（互关）", en: "Mutual follows" },
  { value: "private", zh: "仅自己", en: "Only me" },
];

/** 隐私设置 — 控制主页上的关注列表对其他人是否可见。开关即保存。 */
export function PrivacyPanel({ initial }: { initial: PrivacyInitial }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [visibility, setVisibility] = useState<PrivacyInitial>(initial);

  function save(key: keyof PrivacyInitial, value: Visibility) {
    const rollback = () => setVisibility((s) => ({ ...s, [key]: s[key] }));
    setVisibility((s) => ({ ...s, [key]: value }));
    apiRequest("/api/me/profile", "PUT", { [key]: value })
      .then(() => toast.success(zh ? "隐私设置已保存" : "Privacy setting saved"))
      .catch((err) => {
        rollback();
        toast.error((err as Error).message);
      });
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader
        description={
          zh
            ? "控制你的主页上哪些内容对其他访客可见。开关即时生效。"
            : "Control what visitors can see on your profile. Changes apply instantly."
        }
      />
      <div className="divide-y divide-border rounded-lg border border-border">
        <SelectRow
          zh={zh}
          icon={<Users className="size-4" />}
          label={zh ? "关注中列表" : "Following list"}
          desc={zh ? "谁可以在你的主页查看你关注了谁。" : "Who can see who you follow."}
          value={visibility.followingVisibility}
          onChange={(v) => save("followingVisibility", v as Visibility)}
        />
        <SelectRow
          zh={zh}
          icon={<Users className="size-4" />}
          label={zh ? "粉丝列表" : "Followers list"}
          desc={zh ? "谁可以在你的主页查看你的粉丝。" : "Who can see your followers."}
          value={visibility.followersVisibility}
          onChange={(v) => save("followersVisibility", v as Visibility)}
        />
        <SelectRow
          zh={zh}
          icon={<Bookmark className="size-4" />}
          label={zh ? "收藏" : "Bookmarks"}
          desc={zh ? "谁可以在你的主页查看你的收藏内容。" : "Who can see your bookmarked posts."}
          value={visibility.bookmarksVisibility}
          onChange={(v) => save("bookmarksVisibility", v as Visibility)}
        />
      </div>
    </SettingsSection>
  );
}
function SelectRow({
  icon,
  label,
  desc,
  value,
  zh,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  value: string;
  zh: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border-0 bg-[var(--muted)] px-2.5 text-sm text-foreground shadow-[0_0_0_1px_var(--field-line)] outline-none focus-visible:shadow-[0_0_0_1px_var(--field-focus-a),0_0_0_2px_var(--field-focus-b)]"
        aria-label={label}
      >
        {VISIBILITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {zh ? o.zh : o.en}
          </option>
        ))}
      </select>
    </div>
  );
}
