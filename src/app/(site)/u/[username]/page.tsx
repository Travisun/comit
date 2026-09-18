import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserByUsernameAnyStatus } from "@/components/user-space/queries";
import {
  BannedProfileView,
  UserProfileView,
  type ProfileTab,
} from "@/components/user-space/profile-view";
import { isBanned } from "@/lib/banned";
import { routeParam } from "@/lib/route-params";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
};

const TAB_IDS: ProfileTab[] = ["posts", "short", "bookmarks", "collections", "followers", "following"];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  // 用户名统一小写存储与比较；/u/Admin 这类大写直连与 /Admin（proxy 已
  // 小写重写）行为对齐，否则前者 404 后者 200 不对称
  const user = await getUserByUsernameAnyStatus(routeParam(username).toLowerCase());
  // 流式边界下 notFound() 无法改写状态码（soft-404），用 noindex 防搜索引擎收录
  if (!user || user.status === "deleted") {
    return { title: "用户不存在", robots: { index: false, follow: false } };
  }
  // 封禁主页：标注态不收录，也不泄露原昵称
  if (isBanned(user)) {
    return {
      title: `已封禁用户 (@${user.username})`,
      robots: { index: false, follow: false },
    };
  }
  const images = user.avatarPath ? [`${routes.media(user.avatarPath)}`] : undefined;
  return {
    title: `${user.displayName} (@${user.username})`,
    description: user.bio || `${user.displayName} 的主页`,
    alternates: { canonical: routes.profile(user.username) },
    openGraph: { images: images?.map((url) => ({ url })) },
  };
}

export default async function UserProfilePage({ params, searchParams }: Props) {
  const { username } = await params;
  const { tab: tabParam, page: pageParam } = await searchParams;

  const user = await getUserByUsernameAnyStatus(routeParam(username).toLowerCase());
  if (!user || user.status === "deleted") notFound();

  // 封禁用户：主页标注视图（没收头像/昵称 + 停用内容展示），不进正常主页
  if (isBanned(user)) return <BannedProfileView user={user} />;

  const viewer = await getCurrentUser();
  const tab = (TAB_IDS as string[]).includes(tabParam ?? "")
    ? (tabParam as ProfileTab)
    : "posts";
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);

  return <UserProfileView user={user} viewer={viewer} tab={tab} page={page} />;
}
