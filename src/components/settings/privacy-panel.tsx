"use client";

import { useState } from "react";
import { toast } from "sonner";
import { EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/primitives";
import { SettingsSection, SettingsSectionHeader } from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { apiRequest } from "./client";

interface PrivacyInitial {
  hideFollowers: boolean;
  hideFollowing: boolean;
}

/** 隐私设置 — 控制主页上的关注列表对其他人是否可见。开关即保存。 */
export function PrivacyPanel({ initial }: { initial: PrivacyInitial }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [hideFollowing, setHideFollowing] = useState(initial.hideFollowing);
  const [hideFollowers, setHideFollowers] = useState(initial.hideFollowers);

  function save(key: "hideFollowers" | "hideFollowing", value: boolean, rollback: () => void) {
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
        <Row
          icon={<EyeOff className="size-4" />}
          label={zh ? "隐藏「关注中」列表" : "Hide following list"}
          desc={zh ? "关闭后其他人无法在你的主页查看你关注了谁。" : "Others can't see who you follow."}
          checked={hideFollowing}
          onChange={(v) => {
            setHideFollowing(v);
            save("hideFollowing", v, () => setHideFollowing(!v));
          }}
        />
        <Row
          icon={<EyeOff className="size-4" />}
          label={zh ? "隐藏「粉丝」列表" : "Hide followers list"}
          desc={zh ? "关闭后其他人无法在你的主页查看你的粉丝。" : "Others can't see your followers."}
          checked={hideFollowers}
          onChange={(v) => {
            setHideFollowers(v);
            save("hideFollowers", v, () => setHideFollowers(!v));
          }}
        />
      </div>
    </SettingsSection>
  );
}

function Row({
  icon,
  label,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
