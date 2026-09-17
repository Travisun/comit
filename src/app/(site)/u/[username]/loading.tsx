import { ListSkeleton } from "@/components/user-space/list-skeleton";

/**
 * 用户空间（/u/[username] 及其 posts/collections 子段）专属流式边界。
 *
 * 组级 (site)/loading.tsx 已能兜底，这里细化到段：个人主页是站内高频
 * 导航目标，也是历史上 flight 竞态错误的高发路由（/u/* 长飞行 RSC 请求
 * 与悬停预取交叠）。更近的边界让骨架更贴合页面形态（信息流列表），
 * 并进一步收窄该子树导航的在途请求窗口。
 */
export default function Loading() {
  return <ListSkeleton rows={4} />;
}
