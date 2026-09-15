"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bookmark, Users } from "lucide-react";
import { VirtualSelect, type SelectOption } from "@/components/ui/virtual-select";
import {
  SettingsPanelList,
  SettingsPanelRow,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
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

/** 隐私设置 — 控制主页上的关注列表对其他人是否可见。选择即保存。 */
export function PrivacyPanel({ initial }: { initial: PrivacyInitial }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [visibility, setVisibility] = useState<PrivacyInitial>(initial);

  const options: SelectOption[] = VISIBILITY_OPTIONS.map((o) => ({
    value: o.value,
    label: zh ? o.zh : o.en,
  }));

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
            ? "控制你的主页上哪些内容对其他访客可见。选择即时生效。"
            : "Control what visitors can see on your profile. Changes apply instantly."
        }
      />
      <SettingsPanelList>
        <SettingsPanelRow
          icon={<Users className="size-4" />}
          title={zh ? "关注中列表" : "Following list"}
          description={zh ? "谁可以在你的主页查看你关注了谁。" : "Who can see who you follow."}
          control={
            <VirtualSelect
              value={visibility.followingVisibility}
              options={options}
              onChange={(v) => save("followingVisibility", v as Visibility)}
              className="w-44"
            />
          }
        />
        <SettingsPanelRow
          icon={<Users className="size-4" />}
          title={zh ? "粉丝列表" : "Followers list"}
          description={zh ? "谁可以在你的主页查看你的粉丝。" : "Who can see your followers."}
          control={
            <VirtualSelect
              value={visibility.followersVisibility}
              options={options}
              onChange={(v) => save("followersVisibility", v as Visibility)}
              className="w-44"
            />
          }
        />
        <SettingsPanelRow
          icon={<Bookmark className="size-4" />}
          title={zh ? "收藏" : "Bookmarks"}
          description={zh ? "谁可以在你的主页查看你的收藏内容。" : "Who can see your bookmarked posts."}
          control={
            <VirtualSelect
              value={visibility.bookmarksVisibility}
              options={options}
              onChange={(v) => save("bookmarksVisibility", v as Visibility)}
              className="w-44"
            />
          }
        />
      </SettingsPanelList>
    </SettingsSection>
  );
}
