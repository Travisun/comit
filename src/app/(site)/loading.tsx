import { ListSkeleton } from "@/components/user-space/list-skeleton";

/**
 * 路由级流式边界 — (site) 组内全部页面共用。
 *
 * 之前全站 force-dynamic 且无任何 loading 边界，每次导航都是一次
 * 「完整等待 → 整树替换」的长飞行 RSC 请求；快速连续导航/悬停预取
 * 叠加时，两个在途 RSC 流交叠会触发 flight 客户端竞态
 * （chunk.reason.enqueueModel 崩溃，整页落入错误边界，刷新才恢复）。
 * 有了该边界，导航立刻呈现骨架、内容由 RSC 流式填充，在途请求窗口
 * 大幅缩短，竞态窗口随之收窄。
 */
export default function Loading() {
  return <ListSkeleton rows={4} />;
}
