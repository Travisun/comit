"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiUpload } from "@/lib/client/api";
import { useApiMutation } from "@/lib/query/mutation";
import {
  Briefcase,
  Building2,
  CircleAlert,
  Hourglass,
  ImagePlus,
  Loader2,
  PenLine,
  Send,
  Trash2,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import {
  VERIFICATION_BADGE_FALLBACK,
  VERIFICATION_BADGE_STYLES,
  VERIFICATION_TYPE_MAP,
  verificationUpgradeTargets,
  type CreateVerificationRequestInput,
  type VerificationMeResponse,
  type VerificationRequestView,
  type VerificationTypeInfo,
  type VerificationType,
} from "@/lib/verification";
import { VerifiedBadge } from "@/components/user-space/verified-badge";
import { apiRequest, mediaUrl } from "./client";

const TYPE_ICONS: Record<VerificationTypeInfo["icon"], LucideIcon> = {
  user: User,
  pen: PenLine,
  briefcase: Briefcase,
  building: Building2,
};

const MAX_ATTACHMENTS = 3;

/** 认证状态查询键 — keys.ts 冻结期内就地字面量，后续可提升进 queryKeys */
const VERIFICATION_KEY = ["me", "verification"] as const;

/** 设置 → 认证：申请 / 撤回 / 徽章展示 / 历史记录。 */
export function VerificationPanel() {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const [applying, setApplying] = useState(false);
  const queryClient = useQueryClient();

  const verificationQ = useQuery({
    queryKey: VERIFICATION_KEY,
    queryFn: () => apiRequest<VerificationMeResponse>("/api/me/verification", "GET"),
  });
  const data = verificationQ.data;
  const error = verificationQ.error instanceof Error ? verificationQ.error.message : null;

  /** 子卡片提交/撤回后的重取（等价原 load()） */
  function refetch() {
    void queryClient.invalidateQueries({ queryKey: VERIFICATION_KEY });
  }

  if (error) {
    return (
      <div className="space-y-4 pt-2">
        <p className="flex items-center gap-2 text-sm text-destructive">
          <CircleAlert className="size-4" /> {error}
        </p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-3 pt-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const upgradeTargets = verificationUpgradeTargets(data.verified?.type ?? null);  const hasPending = data.activeRequest?.status === "pending";
  const showForm = applying || (!data.verified && !hasPending && data.activeRequest === null);

  return (
    <div className="space-y-4">
      {/* 已认证 */}
      {data.verified && <VerifiedCard verified={data.verified} />}

      {/* 审核中 */}
      {hasPending && data.activeRequest && (
        <PendingCard
          request={data.activeRequest}
          onWithdrawn={() => {
            toast.success(zh ? "已撤回申请" : "Request withdrawn");
            refetch();
          }}
        />
      )}

      {/* 被驳回 */}
      {data.activeRequest?.status === "rejected" && (
        <RejectedCard
          request={data.activeRequest}
          onReapply={() => {
            setApplying(true);
            window.scrollTo({ top: 240, behavior: "smooth" });
          }}
        />
      )}

      {/* 申请表单 / 认证类型选择 */}
      {showForm ? (
        <ApplyCard
          allowedTypes={upgradeTargets.length > 0 ? upgradeTargets : undefined}
          upgrading={Boolean(data.verified)}
          onDone={() => {
            setApplying(false);
            refetch();
          }}
          onCancel={data.verified || data.activeRequest?.status === "rejected" ? () => setApplying(false) : undefined}
        />
      ) : (
        !hasPending && (
          <div className="space-y-4">
            <div className="flex flex-col items-start justify-between gap-3 pt-5 sm:flex-row sm:items-center">
              <p className="text-sm text-muted-foreground">
                {zh ? "完善身份信息，获得平台认证徽章。" : "Get a verified badge on your profile."}
              </p>
              <Button size="sm" onClick={() => setApplying(true)}>
                {zh ? "申请认证" : "Apply for verification"}
              </Button>
            </div>
          </div>
        )
      )}

      {/* 申请历史 */}
      {data.myRequests.length > 0 && <HistoryCard requests={data.myRequests} />}
    </div>
  );
}

/* ------------------------------ status cards ------------------------------ */

function VerifiedCard({ verified }: { verified: VerificationMeResponse["verified"] }) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  if (!verified) return null;
  const info = VERIFICATION_TYPE_MAP[verified.type];
  const style = VERIFICATION_BADGE_STYLES[verified.type] ?? VERIFICATION_BADGE_FALLBACK;
  const typeName = info ? (zh ? info.name.zh : info.name.en) : verified.type;
  const canUpgrade = verificationUpgradeTargets(verified.type).length > 0;

  return (
    <div className={cn("rounded-lg bg-card p-6", style.card)}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <span className={cn("grid size-11 place-items-center rounded-lg border", style.chip)}>
            <VerifiedBadge verified={verified} size="md" />
          </span>
          <div>
            <h3 className="text-base font-normal">
              {zh ? "已认证" : "Verified"} · {typeName}
            </h3>
            <p className="text-sm text-muted-foreground">
              {verified.label} · {zh ? "于" : "since"} {formatDate(verified.approvedAt, locale)}
              {zh ? "认证" : ""}
            </p>
          </div>
        </div>
        <Badge variant="success">{zh ? "生效中" : "Active"}</Badge>
      </div>
      {canUpgrade && (
        <p className="text-xs text-muted-foreground">
          {zh
            ? "如需升级到更高类型的认证（如个人 → 机构），可重新提交申请，审核通过后徽章将自动更换。"
            : "Need a higher tier badge (e.g. Personal → Organization)? Submit a new application and the badge will be replaced upon approval."}
        </p>
      )}
    </div>
  );
}

function PendingCard({
  request,
  onWithdrawn,
}: {
  request: VerificationRequestView;
  onWithdrawn: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const info = VERIFICATION_TYPE_MAP[request.type];
  const typeName = info ? (zh ? info.name.zh : info.name.en) : request.type;

  // 撤回申请 — pending 驱动按钮禁用；成功提示与重取由 onWithdrawn 回调负责
  const withdrawMutation = useApiMutation(
    () => apiRequest(`/api/me/verification?id=${request.id}`, "DELETE"),
    { refresh: false, onSuccess: () => onWithdrawn() },
  );

  return (
    <div className="rounded-lg border-amber-500/30 bg-amber-500/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <h3 className="flex items-center gap-2 text-base font-normal">
            <Hourglass className="size-4 text-amber-500" />
            {zh ? "认证审核中" : "Verification under review"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {typeName} · {request.label} · {timeAgo(request.createdAt, locale)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="warning">{zh ? "待审核" : "Pending"}</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={withdrawMutation.pending}
            onClick={() => void withdrawMutation.mutate(undefined)}
          >
            {withdrawMutation.pending ? <Loader2 className="animate-spin" /> : <X />}
            {zh ? "撤回" : "Withdraw"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RejectedCard({
  request,
  onReapply,
}: {
  request: VerificationRequestView;
  onReapply: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const info = VERIFICATION_TYPE_MAP[request.type];
  const typeName = info ? (zh ? info.name.zh : info.name.en) : request.type;

  return (
    <div className="rounded-lg border-destructive/30 bg-destructive/5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="space-y-1.5">
          <h3 className="flex items-center gap-2 text-base font-normal">
            <CircleAlert className="size-4 text-destructive" />
            {zh ? "认证未通过" : "Verification rejected"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {typeName} · {request.label}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReapply}>
          {zh ? "重新申请" : "Re-apply"}
        </Button>
      </div>
      <p className="rounded-lg bg-[var(--muted)] px-3 py-2 text-sm">
        <span className="font-medium">{zh ? "驳回原因：" : "Reason: "}</span>
        {request.rejectReason || (zh ? "未说明" : "Not given")}
      </p>
    </div>
  );
}

/* ------------------------------ apply form -------------------------------- */

function ApplyCard({
  allowedTypes,
  upgrading,
  onDone,
  onCancel,
}: {
  /** 当从已认证状态重新申请时，仅允许升级目标类型；undefined = 全部类型 */
  allowedTypes?: VerificationType[];
  upgrading: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { locale } = useI18n();
  const zh = locale === "zh";
  const catalog = (allowedTypes
    ? Object.values(VERIFICATION_TYPE_MAP).filter((t) => allowedTypes.includes(t.id))
    : Object.values(VERIFICATION_TYPE_MAP)) as VerificationTypeInfo[];
  const [type, setType] = useState<VerificationType>(catalog[0]?.id ?? "personal");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 提交申请 — pending 驱动提交/取消按钮禁用
  const submitMutation = useApiMutation(
    (payload: CreateVerificationRequestInput) => apiRequest("/api/me/verification", "POST", payload),
    {
      // 保持原行为等价：成功只回调 onDone（关表单 + 重取），不触发 RSC 回流
      refresh: false,
      successToast: zh ? "申请已提交，请等待审核" : "Application submitted for review",
      onSuccess: () => onDone(),
    },
  );

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const room = MAX_ATTACHMENTS - attachments.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      for (const file of picked) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("kind", "inline");
        const r = await apiUpload<{ path?: string; url?: string; error?: string }>(
          "/api/media/upload",
          fd,
        );
        if (!r.ok) {
          throw new Error(r.error ?? "图片上传失败 / Upload failed");
        }
        const path =
          (typeof r.data.path === "string" && r.data.path) ||
          (typeof r.data.url === "string" && r.data.url.replace(/^\/api\/media\/file\//, "")) ||
          "";
        if (!path) throw new Error("上传响应缺少路径 / Unexpected upload response");
        setAttachments((prev) => (prev.length >= MAX_ATTACHMENTS ? prev : [...prev, path]));
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function submit() {
    const payload: CreateVerificationRequestInput = {
      type,
      label: label.trim(),
      description: description.trim(),
      attachments,
    };
    if (payload.label.length < 2 || payload.description.length < 10 || attachments.length === 0) {
      toast.error(
        zh
          ? "请完整填写认证名称（≥2 字）、说明（≥10 字）并上传至少 1 张材料"
          : "Label (≥2), description (≥10) and at least 1 attachment are required",
      );
      return;
    }
    void submitMutation.mutate(payload);
  }

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h3 className="text-base font-normal leading-6 text-foreground">{upgrading ? (zh ? "重新认证" : "Re-verify") : zh ? "申请认证" : "Apply for verification"}</h3>
        <p className="text-sm text-muted-foreground">
          {zh
            ? "选择认证类型，填写认证名称并上传证明材料，审核通过后徽章将展示在你的主页。"
            : "Pick a type, fill in the badge title and upload proof materials. The badge appears on your profile once approved."}
        </p>
      </div>
      {/* type cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {catalog.map((t) => {
          const Icon = TYPE_ICONS[t.icon];
          const style = VERIFICATION_BADGE_STYLES[t.id] ?? VERIFICATION_BADGE_FALLBACK;
          const active = type === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                active ? cn(style.chip, "border-current") : "border-border hover:bg-[var(--muted)]",
              )}
            >
              <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border", style.chip)}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{zh ? t.name.zh : t.name.en}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{zh ? t.desc.zh : t.desc.en}</span>
              </span>
            </button>
          );
        })}
      </div>

        <div className="space-y-1.5">
          <Label htmlFor="verification-label">
            {zh ? "认证名称" : "Badge title"} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="verification-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={80}
            placeholder={zh ? "如：前端工程师 / XX 科技 官方账号" : "e.g. Frontend Engineer / Official account"}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="verification-desc">
            {zh ? "认证说明" : "Description"} <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="verification-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder={
              zh
                ? "说明你的身份/资质，供审核人员参考（10–500 字）"
                : "Describe your identity or credential for the reviewers (10–500 chars)"
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label>
            {zh ? "证明材料" : "Attachments"}{" "}
            <span className="text-muted-foreground">
              ({attachments.length}/{MAX_ATTACHMENTS})
            </span>
          </Label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void uploadFiles(e.target.files)}
          />
          <div className="flex flex-wrap gap-2">
            {attachments.map((path) => {
              const url = mediaUrl(path);
              return (
                <div key={path} className="group relative size-20 overflow-hidden rounded-lg border border-border">
                  {url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt="" className="size-full object-cover" />
                  )}
                  <button
                    type="button"
                    aria-label="remove"
                    onClick={() => setAttachments((prev) => prev.filter((p) => p !== path))}
                    className="absolute inset-0 grid place-items-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
            {attachments.length < MAX_ATTACHMENTS && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="grid size-20 place-items-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
              >
                {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {zh
              ? "最多 3 张：身份证/工作证/资质证书等截图（仅审核人员可见）"
              : "Up to 3 images: ID card, work badge, certificate… (visible to reviewers only)"}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={submitMutation.pending}>
              {zh ? "取消" : "Cancel"}
            </Button>
          )}
          <Button onClick={() => void submit()} disabled={submitMutation.pending || uploading}>
            {submitMutation.pending ? <Loader2 className="animate-spin" /> : <Send />}
            {zh ? "提交申请" : "Submit"}
          </Button>
        </div>
    </div>
  );
}

/* -------------------------------- history --------------------------------- */

function HistoryCard({ requests }: { requests: VerificationRequestView[] }) {
  const { locale } = useI18n();
  const zh = locale === "zh";

  return (
    <div className="space-y-4">
      <h3 className="mb-4 text-base font-normal">{zh ? "申请记录" : "Application history"}</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {requests.map((r) => {
          const info = VERIFICATION_TYPE_MAP[r.type];
          const typeName = info ? (zh ? info.name.zh : info.name.en) : r.type;
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {typeName} · {r.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDate(r.createdAt, locale)}
                  {r.reviewedAt
                    ? ` · ${zh ? "审核于" : "reviewed"} ${formatDate(r.reviewedAt, locale)}`
                    : ""}
                  {r.status === "rejected" && r.rejectReason
                    ? ` · ${zh ? "原因" : "reason"}: ${r.rejectReason}`
                    : ""}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: VerificationRequestView["status"] }) {
  const { locale } = useI18n();
  if (status === "approved") return <Badge variant="success">{locale === "zh" ? "已通过" : "Approved"}</Badge>;
  if (status === "rejected") return <Badge variant="destructive">{locale === "zh" ? "已驳回" : "Rejected"}</Badge>;
  return <Badge variant="warning">{locale === "zh" ? "审核中" : "Pending"}</Badge>;
}
