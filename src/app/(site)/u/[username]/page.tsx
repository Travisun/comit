import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { getCurrentUser } from "@/lib/auth/session";
import { getActiveUserByUsername } from "@/components/user-space/queries";
import { UserProfileView, type ProfileTab } from "@/components/user-space/profile-view";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; page?: string }>;
};

const TAB_IDS: ProfileTab[] = ["posts", "short", "collections", "followers", "following", "about"];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const user = await getActiveUserByUsername(decodeURIComponent(username));
  if (!user) return { title: "用户不存在" };
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

  const user = await getActiveUserByUsername(decodeURIComponent(username));
  if (!user) notFound();

  const viewer = await getCurrentUser();
  const tab = (TAB_IDS as string[]).includes(tabParam ?? "")
    ? (tabParam as ProfileTab)
    : "posts";
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);

  return <UserProfileView user={user} viewer={viewer} tab={tab} page={page} />;
}
