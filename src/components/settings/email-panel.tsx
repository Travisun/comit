"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MailCheck, MailQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  SettingsPanelList,
  SettingsPanelRow,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { apiRequest } from "./client";
import { queryKeys } from "@/lib/query/keys";

interface EmailState {
  email: string | null;
  pendingEmail: string | null;
  hasPassword: boolean;
}

/** 邮箱 — 展示当前（脱敏）邮箱，支持换绑：密码验证 → 新邮箱收确认邮件。 */
export function EmailPanel() {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const router = useRouter();
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const emailQ = useQuery({
    queryKey: queryKeys.emailStatus(),
    queryFn: async () => apiRequest<EmailState>("/api/me/email", "GET"),
  });
  const state: EmailState = emailQ.data ?? { email: null, pendingEmail: null, hasPassword: false };

  useEffect(() => {
    // 换绑确认后返回时带 ?updated=1
    const params = new URLSearchParams(window.location.search);
    if (params.get("updated")) toast.success(zh ? "邮箱已更新" : "Email updated");
    if (params.get("error")) toast.error(zh ? "确认链接无效或已过期" : "Invalid or expired link");
  }, [zh]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiRequest<{ message: string }>("/api/me/email", "POST", {
        newEmail: newEmail.trim(),
        password: password || undefined,
      });
      toast.success(res.message ?? (zh ? "确认邮件已发送" : "Confirmation email sent"));
      setNewEmail("");
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.emailStatus() });
      setBusy(false);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载中…
      </div>
    );
  }

  return (
    <SettingsSection>
      <SettingsSectionHeader
        description={
          zh
            ? "更换邮箱需要验证：提交后系统会向新邮箱发送确认邮件，点击邮件中的链接完成换绑。"
            : "Changing your email requires confirmation — we'll send a link to the new address."
        }
      />
      <div className="max-w-md space-y-5">
        <SettingsPanelList>
          <SettingsPanelRow
            icon={<MailCheck className="size-4" />}
            title={zh ? "当前邮箱" : "Current email"}
            control={<span className="font-mono text-sm text-foreground">{state.email ?? "—"}</span>}
          />
          {state.pendingEmail && (
            <SettingsPanelRow
              icon={<MailQuestion className="size-4" />}
              title={zh ? "待确认的新邮箱" : "Pending new email"}
              description={
                zh ? "点击确认邮件中的链接后生效。" : "Takes effect via the link in the confirmation email."
              }
              control={<span className="font-mono text-sm text-foreground">{state.pendingEmail}</span>}
            />
          )}
        </SettingsPanelList>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="newEmail">{zh ? "新邮箱" : "New email"}</Label>
            <Input
              id="newEmail"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
            />
          </div>
          {state.hasPassword && (
            <div className="grid gap-2">
              <Label htmlFor="emailPw">{zh ? "当前密码" : "Current password"}</Label>
              <Input
                id="emailPw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
          )}
          <Button type="submit" disabled={busy || !newEmail.trim()}>
            {busy && <Loader2 className="animate-spin" />}
            {zh ? "发送确认邮件" : "Send confirmation email"}
          </Button>
        </form>
      </div>
    </SettingsSection>
  );
}
