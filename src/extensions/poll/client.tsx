"use client";

import { PollCard } from "./components/poll-card";
import { registerUiPlugin } from "@/lib/plugins/ui";
import type { PostSlotContext } from "@/lib/plugins/ui";

/**
 * 投票插件 — 前端第一个 UI 插件：把投票卡片挂进时间线行尾与帖子详情。
 * hasPoll 标记由 feed/详情查询 leftJoin polls 一次性下发，插件无需逐行探测。
 */
function PollAttachment({ postId, hasPoll }: PostSlotContext) {
  return <PollCard poll={hasPoll ? postId : null} />;
}

registerUiPlugin({
  name: "poll",
  version: "1.0.0",
  registrations: [
    { slot: "feed:row:after", component: PollAttachment },
    { slot: "post:detail:after", component: PollAttachment },
  ],
});
