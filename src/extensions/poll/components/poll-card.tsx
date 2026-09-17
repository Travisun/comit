"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, CheckCheck, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { postJsonSafe } from "@/lib/client/api";
import { apiQueryOptions } from "@/lib/query/options";
import { queryKeys } from "@/lib/query/keys";
import { pollViewSchema, type PollView } from "@/lib/models/poll";

/**
 * 投票卡片 — 附加在短动态行/详情页内（经 feed:row:after /
 * post:detail:after 插件槽位挂载，见 src/extensions/poll/client.tsx）。
 * `pollPostId` 非空时按 postId 自取数据（feed 通过 hasPoll 标记只对投票帖
 * 挂载）；null 时不渲染。
 * 未投：选项为可点击按钮；已投/已结束：结果条（占比+票数）。
 */
export function PollCard({ poll: pollPostId }: { poll: string | null }) {
  const postId = pollPostId;
  const queryClient = useQueryClient();
  // 票数时效性优先于缓存：staleTime 0 ⇒ 挂载即拉最新
  const { data: poll, error, refetch } = useQuery({
    ...apiQueryOptions({
      queryKey: queryKeys.poll(postId ?? "none"),
      url: postId ? `/api/posts/${postId}/poll` : "",
      schema: pollViewSchema,
      enabled: Boolean(postId),
      staleTime: 0,
    }),
  });
  const [picking, setPicking] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  // 改票模式：已投用户点「修改投票」后进入 —— 预选当前票，可调整后整组提交，
  // 也可取消回到结果视图（API 本就支持结束前整组替换，此处补齐 UI 入口）
  const [editing, setEditing] = useState(false);

  // 结束时间到期后自动切到结果视图
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!poll || poll.ended) return;
    const ms = new Date(poll.endsAt).getTime() - Date.now();
    if (ms <= 0 || ms > 86_400_000) return; // 超过一天的不必逐秒盯
    const timer = setTimeout(() => {
      setNow(Date.now());
      void refetch();
    }, Math.max(1000, ms));
    return () => clearTimeout(timer);
  }, [poll, refetch]);

  if (error) return null;
  if (!postId) return null;
  if (!poll) {
    return (
      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" /> 投票加载中…
      </div>
    );
  }

  const total = poll.tallies.reduce((a, b) => a + b, 0);
  const voted = poll.myVotes.length > 0;
  const ended = poll.ended || new Date(poll.endsAt).getTime() <= now;
  // 已投未结束默认看结果；点「修改投票」进入编辑态（选项变回可点选）
  const showResult = ended || (voted && !editing);

  function beginEdit() {
    if (ended || busy) return;
    setPicking(poll!.myVotes);
    setEditing(true);
  }

  function cancelEdit() {
    setPicking([]);
    setEditing(false);
  }

  function togglePick(i: number) {
    if (ended || busy) return;
    setPicking((prev) =>
      poll!.mode === "single" || poll!.mode === "pk"
        ? [i]
        : prev.includes(i)
          ? prev.filter((x) => x !== i)
          : [...prev, i],
    );
  }

  async function submitVote() {
    // 编辑态下必须带着明确选择提交（不允许"清空选择"把旧票原样重交）
    const indexes = editing ? picking : picking.length > 0 ? picking : poll!.myVotes;
    if (indexes.length === 0 || busy || !postId) return;
    setBusy(true);
    try {
      const r = await postJsonSafe<PollView>(`/api/posts/${postId}/poll`, {
        optionIndexes: indexes,
      });
      if (!r.ok) {
        toast.error(r.error ?? "投票失败");
        if (r.status === 410) void refetch(); // 投票已结束 → 拉最新结果态
        return;
      }
      // 服务器返回投票后的最新视图 — 直接写入查询缓存，视图即时切换
      queryClient.setQueryData(queryKeys.poll(postId), r.data);
      setPicking([]);
      setEditing(false);
      toast.success(voted ? "已更新投票" : "投票成功");
    } finally {
      setBusy(false);
    }
  }

  const pendingPick = picking.length > 0;

  return (
    <div className="mt-2 rounded-xl border border-border bg-[var(--muted)]/40 p-3" role="group" aria-label="投票">
      {/* header */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <BarChart3 className="size-3.5" aria-hidden />
          {poll.mode === "pk" ? "PK 对战" : poll.mode === "multiple" ? "多选投票" : "单选投票"}
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" aria-hidden />
            <span className="num">{poll.voters}</span> 人参与
          </span>
        </span>
        <span className="inline-flex items-center gap-2">
          {voted && !ended && !editing && (
            <button
              type="button"
              onClick={beginEdit}
              className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              修改投票
            </button>
          )}
          <span className={cn("num", ended && "text-foreground/70")}>
            {ended ? "投票已结束" : `距结束 ${timeLeft(poll.endsAt, now)}`}
          </span>
        </span>
      </div>

      {/* options —— PK：A/B 双列对战；其余：纵向行 */}
      {poll.mode === "pk" ? (
        <div className="relative mt-2 grid grid-cols-2 gap-2" role="group" aria-label="PK 对战选项">
          {poll.options.map((opt, i) => {
            const n = poll.tallies[i] ?? 0;
            const pct = total > 0 ? Math.round((n / total) * 100) : 0;
            const mine = poll.myVotes.includes(i);
            const pickingThis = picking.includes(i);
            const leader = total > 0 && n === Math.max(...poll.tallies) && n > 0;
            const showBattleResult = showResult;
            return showBattleResult ? (
              <div
                key={i}
                className={cn(
                  "relative overflow-hidden rounded-xl border p-3 text-center transition-colors",
                  mine ? "border-primary" : "border-border",
                  leader && !mine ? "border-emerald-500/40" : "",
                )}
              >
                <div
                  aria-hidden
                  className={cn(
                    "absolute inset-0 transition-[width] duration-500",
                    mine ? "bg-primary/10" : leader ? "bg-emerald-500/10" : "bg-[var(--muted)]/40",
                  )}
                  style={{ width: `${pct}%` }}
                />
                <div className="relative">
                  <div className="num text-2xl font-bold leading-none">
                    {pct}
                    <span className="text-sm">%</span>
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                    <span className="num">{n}</span> 票
                    {mine && <span className="font-medium text-primary">· 你在这方</span>}
                  </div>
                </div>
              </div>
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => togglePick(i)}
                aria-pressed={pickingThis}
                className={cn(
                  "rounded-xl border p-3 text-sm transition-colors",
                  pickingThis
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <span
                  className={cn(
                    "mb-1 block text-[10px] font-bold uppercase tracking-widest",
                    i === 0 ? "text-rose-500" : "text-sky-500",
                  )}
                >
                  {i === 0 ? "A 方" : "B 方"}
                </span>
                <span className="block break-words font-medium">{opt}</span>
              </button>
            );
          })}
          {showResult && (
            <span
              aria-hidden
              className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card text-[10px] font-black text-foreground shadow ring-1 ring-border"
            >
              VS
            </span>
          )}
        </div>
      ) : (
      <div className="mt-2 space-y-1.5">
        {poll.options.map((opt, i) => {
          const n = poll.tallies[i] ?? 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          const mine = poll.myVotes.includes(i);
          const pickingThis = picking.includes(i);
          return showResult ? (
            <div
              key={i}
              className={cn(
                "relative overflow-hidden rounded-lg border px-3 py-2 text-sm transition-colors",
                mine ? "border-primary/50" : "border-border",
              )}
            >
              {/* result bar */}
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("truncate", mine && "font-medium text-foreground")}>{opt}</span>
                  {mine && <CheckCheck className="size-3.5 shrink-0 text-primary" aria-label="我选的" />}
                </span>
                <span className="num shrink-0 text-xs text-muted-foreground tabular-nums">
                  {pct}% · {n}
                </span>
              </div>
            </div>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => togglePick(i)}
              aria-pressed={pickingThis}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                pickingThis
                  ? "border-primary/60 bg-primary/5 text-foreground"
                  : "border-border bg-card hover:border-primary/40 hover:bg-[var(--hover,#f7f8f8)]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-4 shrink-0 place-items-center border",
                  poll.mode === "single" ? "rounded-full" : "rounded-[4px]",
                  pickingThis ? "border-[6px] border-primary" : "border-border-strong border-[1.5px]",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{opt}</span>
            </button>
          );
        })}
      </div>
      )}

      {/* vote action */}
      {!ended && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {editing
              ? "调整选择后保存"
              : voted
                ? "已投票，结束前可修改"
                : poll.mode === "multiple"
                  ? "可多选"
                  : "请选择一项"}
          </span>
          <span className="flex items-center gap-2">
            {editing && (
              <button
                type="button"
                onClick={cancelEdit}
                disabled={busy}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                取消
              </button>
            )}
            {pendingPick && (
              <button
                type="button"
                onClick={() => void submitVote()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
                {voted ? "保存修改" : "投票"}
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function timeLeft(endsAt: string, now: number): string {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return "已结束";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "1 分钟内";
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
}
