"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { CircleUser, ImageUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
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
  const [saving, setSaving] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function onPickImage(target: "avatar" | "cover", file: File | undefined) {
    if (!file) return;
    setUploading(target);
    try {
      const path = await uploadImage(file, target);
      if (target === "avatar") setAvatarPath(path);
      else setCoverPath(path);
      toast.success(locale === "zh" ? "图片已上传" : "Image uploaded");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await apiRequest("/api/me/profile", "PUT", {
        displayName,
        bio,
        github: github || null,
        orcid: orcid || null,
        website: website || null,
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

  const avatarSrc = mediaUrl(avatarPath);
  const coverSrc = mediaUrl(coverPath);

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-[var(--muted)] p-6 space-y-3">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{t("settings.profile.cover")}</h3>
          <p className="text-sm text-muted-foreground">1920×840 · WebP</p>
        </div>
        <button
          type="button"
          onClick={() => coverInput.current?.click()}
          className={cn(
            "group relative block h-32 w-full overflow-hidden rounded-lg border border-dashed border-border sm:h-40",
            "bg-muted transition-colors hover:border-primary/50",
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
              <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Loader2 className="size-5 animate-spin" />
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
        </div>

      <div className="rounded-lg bg-[var(--muted)] p-6 space-y-5">
          {/* avatar */}
          <div className="flex items-center gap-4">
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

          <div className="grid gap-2">
            <Label htmlFor="displayName">{t("auth.displayName")}</Label>
            <Input
              id="displayName"
              value={displayName}
              maxLength={80}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="bio">{t("settings.profile.bio")}</Label>
            <Textarea
              id="bio"
              value={bio}
              maxLength={200}
              rows={3}
              placeholder={t("settings.profile.bioPlaceholder")}
              onChange={(e) => setBio(e.target.value)}
            />
            <span className="self-end text-xs text-muted-foreground">{bio.length}/200</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="github">{t("settings.profile.github")}</Label>
              <Input
                id="github"
                value={github}
                placeholder="octocat"
                onChange={(e) => setGithub(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="orcid">{t("settings.profile.orcid")}</Label>
              <Input
                id="orcid"
                value={orcid}
                placeholder="0000-0002-1825-0097"
                onChange={(e) => setOrcid(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="website">{t("settings.profile.website")}</Label>
              <Input
                id="website"
                value={website}
                placeholder="https://example.com"
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("settings.profile.locale")}</Label>
            <div className="inline-flex w-fit rounded-lg bg-[var(--muted)] p-1">
              {(["zh", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setUiLocale(l)}
                  className={cn(
                    "rounded-md border px-4 py-1.5 text-sm font-medium transition-colors",
                    uiLocale === l
                      ? "border-border bg-white text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l === "zh" ? "简体中文" : "English"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={save} disabled={saving || !displayName.trim()}>
              {saving && <Loader2 className="animate-spin" />}
              {t("common.save")}
            </Button>
          </div>
      </div>
    </div>
  );
}
