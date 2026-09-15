"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { CircleUser, ImageUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import {
  SectionTabs,
  SettingField,
  SettingsFooter,
  SettingsSection,
  SettingsSectionHeader,
} from "@/components/ui/settings";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { apiRequest, mediaUrl, uploadImage } from "./client";

export interface ProfileInitial {
  displayName: string;
  bio: string;
  github: string | null;
  orcid: string | null;
  website: string | null;
  locale: "zh" | "en";
  avatarPath: string | null;
  coverPath: string | null;
  hideFollowers: boolean;
  hideFollowing: boolean;
}

export function ProfileForm({ initial }: { initial: ProfileInitial }) {
  const { t, locale } = useI18n();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [github, setGithub] = useState(initial.github ?? "");
  const [orcid, setOrcid] = useState(initial.orcid ?? "");
  const [website, setWebsite] = useState(initial.website ?? "");
  const [uiLocale, setUiLocale] = useState<"zh" | "en">(initial.locale);
  const [avatarPath, setAvatarPath] = useState(initial.avatarPath);
  const [coverPath, setCoverPath] = useState(initial.coverPath);
  const [uploading, setUploading] = useState<"avatar" | "cover" | null>(null);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"profile" | "social" | "cover">("profile");
  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function onPickImage(target: "avatar" | "cover", file: File | undefined) {
    if (!file) return;
    setUploading(target);
    setProgress(0);
    try {
      const path = await uploadImage(file, target, setProgress);
      // 传完即生效：只提交图片字段，避免把表单里未保存的文字改动一起带上去。
      // 若等手动保存，用户会以为上传即应用，回头看到主页没变以为出 bug。
      await apiRequest("/api/me/profile", "PUT", {
        [target === "avatar" ? "avatarPath" : "coverPath"]: path,
      });
      if (target === "avatar") setAvatarPath(path);
      else setCoverPath(path);
      toast.success(locale === "zh" ? "已上传并保存" : "Uploaded and saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      // 资料与社交分开保存：只提交本 tab 的字段，互不携带对方未保存的改动
      await apiRequest("/api/me/profile", "PUT", {
        displayName,
        bio,
        locale: uiLocale,
        avatarPath,
        coverPath,
      });
      toast.success(t("settings.profile.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveSocial() {
    setSaving(true);
    try {
      await apiRequest("/api/me/profile", "PUT", {
        github: github || null,
        orcid: orcid || null,
        website: website || null,
      });
      toast.success(t("settings.profile.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const avatarSrc = mediaUrl(avatarPath);
  const coverSrc = mediaUrl(coverPath);

  const profileDirty =
    displayName !== initial.displayName ||
    bio !== (initial.bio ?? "") ||
    uiLocale !== initial.locale ||
    avatarPath !== initial.avatarPath ||
    coverPath !== initial.coverPath;
  const socialDirty =
    github !== (initial.github ?? "") ||
    orcid !== (initial.orcid ?? "") ||
    website !== (initial.website ?? "");

  /* 资料页与社交页各自的保存按钮（封面 tab 上传即自动保存，无需按钮） */
  const footerFor = (dirty: boolean, onClick: () => void) => (
    <SettingsFooter
      hint={dirty ? undefined : locale === "zh" ? "没有未保存的更改" : "No unsaved changes"}
    >
      <Button
        type="button"
        disabled={saving || !dirty || (onClick === saveProfile && !displayName.trim())}
        onClick={onClick}
      >
        {saving && <Loader2 className="animate-spin" />}
        {saving ? (locale === "zh" ? "保存中…" : "Saving…") : t("common.save")}
      </Button>
    </SettingsFooter>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (tab === "social") void saveSocial();
        else void saveProfile();
      }}
      className="space-y-6"
    >
      <SectionTabs
        value={tab}
        onChange={(id) => setTab(id as "cover" | "profile" | "social")}
        tabs={[
          { id: "profile", label: t("settings.tab.profile") },
          { id: "social", label: t("settings.tab.social") },
          { id: "cover", label: t("settings.profile.cover") },
        ]}
      />
      {tab === "cover" && <SettingsSection>
        <p className="text-sm text-muted-foreground">
          {locale === "zh"
            ? "建议 1920×840。上传时在本地压缩为 WebP，上传成功即自动保存并生效。"
            : "Recommended 1920×840. Compressed to WebP in your browser; saved automatically on upload."}
        </p>
        <button
          type="button"
          onClick={() => coverInput.current?.click()}
          className={cn(
            "group relative block h-32 w-full overflow-hidden rounded-md border border-dashed border-border sm:h-40",
            "bg-[var(--muted)] transition-colors hover:border-primary/50",
          )}
        >
          {coverSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverSrc} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <ImageUp className="size-5" />
              {t("settings.profile.cover")}
            </span>
          )}
          {uploading === "cover" && (
            <span className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-sm font-medium">
              <Loader2 className="size-5 animate-spin" />
              {progress > 0 ? `${progress}%` : "…"}
            </span>
          )}
        </button>
        <input
          ref={coverInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void onPickImage("cover", e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </SettingsSection>}

      {tab === "profile" && <SettingsSection>
        <p className="text-sm text-muted-foreground">
          {locale === "zh" ? "头像、昵称与个人资料会展示在你的主页。" : "Avatar, name and profile details appear on your public page."}
        </p>
        {/* avatar */}
        <div className="mb-5 flex items-center gap-4">
          <Avatar className="size-20">
            {avatarSrc ? (
              <AvatarImage src={avatarSrc} />
            ) : (
              <AvatarFallback className="text-xl">
                {displayName.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            )}
          </Avatar>
          <div className="space-y-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => avatarInput.current?.click()}
              disabled={uploading === "avatar"}
            >
              {uploading === "avatar" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <CircleUser />
              )}
              {t("settings.profile.avatar")}
            </Button>
            {avatarPath && (
              <button
                type="button"
                className="block text-xs text-muted-foreground hover:text-destructive"
                onClick={() => setAvatarPath(null)}
              >
                {t("common.delete")}
              </button>
            )}
          </div>
          <input
            ref={avatarInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void onPickImage("avatar", e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <div className="grid max-w-2xl gap-4">
          <SettingField label={t("auth.displayName")} htmlFor="displayName">
            <Input
              id="displayName"
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </SettingField>

          <SettingField
            label={t("settings.profile.bio")}
            htmlFor="bio"
            hint={<span className="block text-right">{bio.length}/200</span>}
          >
            <Textarea
              id="bio"
              value={bio}
              maxLength={200}
              rows={3}
              placeholder={t("settings.profile.bioPlaceholder")}
              onChange={(e) => setBio(e.target.value)}
            />
          </SettingField>

          <SettingField label={t("settings.profile.locale")}>
            <div className="inline-flex w-fit rounded-md bg-[var(--muted)] p-[3px] shadow-[0_0_0_1px_var(--border)]">
              {(["zh", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setUiLocale(l)}
                  className={cn(
                    "inline-flex h-[30px] items-center rounded-[5px] px-4 text-sm transition-colors",
                    uiLocale === l
                      ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_rgba(42,47,69,0.1),0_2px_5px_rgba(42,47,69,0.08)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l === "zh" ? "简体中文" : "English"}
                </button>
              ))}
            </div>
          </SettingField>
        </div>

        {footerFor(profileDirty, () => void saveProfile())}
      </SettingsSection>}

      {tab === "social" && (
        <SettingsSection>
          <SettingsSectionHeader
            description={
              locale === "zh"
                ? "第三方账号与主页链接，展示在你的个人主页上。"
                : "Third-party profiles and links shown on your public page."
            }
          />
          <div className="max-w-2xl space-y-5">
            <SettingField
              label={t("settings.profile.github")}
              htmlFor="github"
              hint={undefined}
              description={locale === "zh" ? "你的 GitHub 用户名，将展示为主页链接。" : "Shown as a link on your profile."}
            >
              <Input
                id="github"
                value={github}
                placeholder="octocat"
                onChange={(e) => setGithub(e.target.value)}
              />
            </SettingField>
            <SettingField
              label={t("settings.profile.orcid")}
              htmlFor="orcid"
              description={locale === "zh" ? "学术身份标识（ORCID iD），用于关联你的科研成果。" : "Your ORCID iD linking research outputs."}
            >
              <Input
                id="orcid"
                value={orcid}
                placeholder="0000-0002-1825-0097"
                onChange={(e) => setOrcid(e.target.value)}
              />
            </SettingField>
            <SettingField
              label={t("settings.profile.website")}
              htmlFor="website"
              description={locale === "zh" ? "个人网站或主页，将以链接展示。" : "A personal site shown as a link."}
            >
              <Input
                id="website"
                value={website}
                placeholder="https://example.com"
                onChange={(e) => setWebsite(e.target.value)}
              />
            </SettingField>
          </div>
          {footerFor(socialDirty, () => void saveSocial())}
        </SettingsSection>
      )}
    </form>
  );
}

