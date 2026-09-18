"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Sparkles,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { apiUpload, mediaPathFromUrl, postJsonSafe, putJsonSafe } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";

/**
 * 注册后引导向导：4 步（资料 → 头像 → 封面 → 第一条动态），每步可跳过。
 * 所有保存走既有端点（PATCH /api/me/profile、POST /api/media/upload、
 * POST /api/posts），完成时 POST /api/me/onboarding/complete 落 onboardedAt。
 */

const STEPS = [
  { id: 0, title: "认识你", desc: "昵称与一句话签名" },
  { id: 1, title: "选个头像", desc: "让大家记住你" },
  { id: 2, title: "主页封面", desc: "你的门面担当" },
  { id: 3, title: "第一条动态", desc: "开启你的记录之旅" },
] as const;

/** 第一条动态灵感池（随机抽 3 条；AI 不可用时也足够多样） */
const IDEAS = [
  "Hello World！我刚在 comit.sh 安了家，以后就在这里记录每一天。",
  "今天迈出了第一步：注册了这个主页。目标是用动态写下 100 条想法。",
  "深夜报到处。打算把这个地方当成公开的笔记本，写点代码之外的生活。",
  "入伙打卡。以后技术笔记、碎碎念都会丢在这里，欢迎常来逛逛。",
  "新邻居报到 🎉 正在把个人主页布置成自己喜欢的样子。",
  "第一次记录：注册账号。希望多年后回看，这里已经积攒了一整个仓库的回忆。",
  "从今天起做一个爱记录的人。动态、文章、评论，都算数。",
  "试运营我的主页中……先立个 flag：每周至少发一条动态。",
  "迁移完成：过去的笔记会慢慢搬过来，未来的灵感将在这里首发。",
  "初次见面！我是用三分钟注册的，但可能会在这里待很久。",
  "打卡 Day 1。把这里当作时间胶囊，写给未来的自己。",
  "开工大吉。第一个关注的人、第一条动态、第一次被点赞，都从这里开始。",
];

function pickIdeas(): string[] {
  const pool = [...IDEAS];
  const out: string[] = [];
  while (out.length < 3 && pool.length > 0) {
    out.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return out;
}

interface Initial {
  displayName: string;
  bio: string;
  username: string;
  avatarPath: string | null;
  coverPath: string | null;
}

export function OnboardingWizard({ initial }: { initial: Initial }) {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [avatarPath, setAvatarPath] = useState(initial.avatarPath);
  const [coverPath, setCoverPath] = useState(initial.coverPath);
  const [firstPost, setFirstPost] = useState("");
  const [ideas, setIdeas] = useState(() => pickIdeas());
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  const finishMutation = useApiMutation(
    () => postJsonSafe("/api/me/onboarding/complete", {}),
    { silent: true, refresh: false },
  );

  async function saveProfile(patch: Record<string, unknown>) {
    // PUT /api/me/profile（该路由只有 PUT；旧实现用 POST 恒 405，资料静默丢失）
    const r = await putJsonSafe("/api/me/profile", patch);
    return r.ok;
  }

  async function uploadImage(file: File): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await apiUpload<{ url?: string }>("/api/media/upload", fd);
    if (!r.ok) {
      toast.error(r.error ?? "上传失败，请换张图片试试");
      return null;
    }
    return r.data?.url ? mediaPathFromUrl(r.data.url) : null;
  }

  async function next() {
    if (step === 0) {
      if (!displayName.trim()) {
        toast.error("昵称不能为空");
        return;
      }
      if (displayName !== initial.displayName || bio !== initial.bio) {
        await saveProfile({ displayName: displayName.trim(), bio: bio.trim() });
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function finish(publish: boolean) {
    if (doneRef.current) return;
    doneRef.current = true;
    try {
      if (publish && firstPost.trim()) {
        const r = await postJsonSafe("/api/posts", {
          type: "short",
          content: firstPost.trim(),
          action: "submit",
        });
        if (!r.ok) toast.error(r.error ?? "动态发布失败，可稍后手动发布");
      }
      await finishMutation.mutate(undefined).catch(() => undefined);
      toast.success("欢迎加入！你的主页已就绪 🎉");
      window.location.replace("/");
    } catch {
      doneRef.current = false;
    }
  }

  const busy = uploading || finishMutation.pending;

  return (
    <div className="w-full">
      {/* 步骤条 */}
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/70">
          welcome · {initial.username}
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">欢迎加入 comit.sh</h1>
        <div className="mt-4 flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors",
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "bg-primary/15 text-primary ring-2 ring-primary/40"
                      : "bg-[var(--muted)] text-muted-foreground",
                )}
              >
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span className={cn("h-px flex-1", i < step ? "bg-primary/60" : "bg-border")} />
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          第 {step + 1}/{STEPS.length} 步 · {STEPS[step].title} — {STEPS[step].desc}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        {/* ------------------------------ 步骤 1：资料 ------------------------------ */}
        {step === 0 && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ob-name">昵称</Label>
              <Input
                id="ob-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                placeholder="大家怎么称呼你"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ob-bio">个性签名</Label>
              <Textarea
                id="ob-bio"
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={200}
                placeholder="一句话介绍自己（会显示在你的主页）"
              />
            </div>
          </div>
        )}

        {/* ------------------------------ 步骤 2：头像 ------------------------------ */}
        {step === 1 && (
          <div className="flex flex-col items-center gap-4">
            <Avatar className="size-24 ring-4 ring-[var(--muted)]">
              {avatarPath && <AvatarImage src={`/api/media/file/${avatarPath}`} alt={displayName} />}
              <AvatarFallback className="text-2xl font-bold">
                {displayName.slice(0, 1).toUpperCase() || <UserRound className="size-8" />}
              </AvatarFallback>
            </Avatar>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setUploading(true);
                const path = await uploadImage(f);
                if (path && (await saveProfile({ avatarPath: path }))) {
                  setAvatarPath(path);
                  toast.success("头像已更新");
                }
                setUploading(false);
              }}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => avatarInputRef.current?.click()} disabled={busy}>
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                {avatarPath ? "换一张" : "上传头像"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">支持 JPG / PNG / WebP，上传后自动压缩为 WebP。</p>
          </div>
        )}

        {/* ------------------------------ 步骤 3：封面 ------------------------------ */}
        {step === 2 && (
          <div className="flex flex-col items-center gap-4">
            <div className="aspect-[5/2] w-full overflow-hidden rounded-xl border border-border bg-gradient-to-br from-[var(--muted)] to-[var(--selected)]">
              {coverPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media/file/${coverPath}`} alt="" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-muted-foreground">
                  <ImageIcon className="size-8" />
                </div>
              )}
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setUploading(true);
                const path = await uploadImage(f);
                if (path && (await saveProfile({ coverPath: path }))) {
                  setCoverPath(path);
                  toast.success("封面已更新");
                }
                setUploading(false);
              }}
            />
            <Button variant="outline" onClick={() => coverInputRef.current?.click()} disabled={busy}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {coverPath ? "换一张封面" : "上传封面"}
            </Button>
            <p className="text-xs text-muted-foreground">建议横图（约 5:2），会展示在你主页顶部。</p>
          </div>
        )}

        {/* ---------------------------- 步骤 4：第一条动态 ---------------------------- */}
        {step === 3 && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ob-post">写下你的第一条动态</Label>
              <Textarea
                id="ob-post"
                rows={4}
                value={firstPost}
                onChange={(e) => setFirstPost(e.target.value)}
                maxLength={500}
                placeholder="随便说点什么——这是你在这的第一个想法 ✨"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">需要灵感？选一条开场白，或让 AI 帮你想：</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={async () => {
                    const r = await postJsonSafe<{ content?: string }>("/api/me/onboarding/suggest", {});
                    if (r.ok && r.data?.content) {
                      setFirstPost(r.data.content.slice(0, 500));
                    } else {
                      toast.info("AI 暂不可用，已换一批灵感", {
                        description: "可在站点设置中配置 LLM 提供商后使用 AI 生成",
                      });
                      setIdeas(pickIdeas());
                    }
                  }}
                >
                  <Sparkles className="size-3.5" /> AI 帮我想
                </Button>
              </div>
              <div className="grid gap-1.5">
                {ideas.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setFirstPost(idea)}
                    className="rounded-lg border border-border px-3 py-2 text-left text-[13px] leading-relaxed text-muted-foreground transition-colors hover:border-primary/40 hover:bg-[var(--hover)] hover:text-foreground"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------ 底部操作 ------------------------------ */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-5">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              <ArrowLeft className="size-4" /> 上一步
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">每一步都可以跳过</span>
          )}
          {step < STEPS.length - 1 ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep((s) => s + 1)} disabled={busy}>
                跳过
              </Button>
              <Button onClick={() => void next()} disabled={busy || (step === 0 && !displayName.trim())}>
                下一步 <ArrowRight className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => void finish(false)} disabled={busy}>
                跳过
              </Button>
              <Button onClick={() => void finish(true)} disabled={busy || !firstPost.trim()}>
                {finishMutation.pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                发布并完成
              </Button>
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        完成后可随时在「设置」中修改这些内容。
      </p>

    </div>
  );
}
