import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { TimelineHeader } from "@/components/site-shell";
import { MyPostsManager } from "@/components/dashboard/my-posts-manager";

export const metadata: Metadata = { title: "我的文章", robots: { index: false, follow: false } };

export default async function MyPostsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/login");

  return (
    <div className="w-full">
      <TimelineHeader
        title="我的文章"
        subtitle="草稿、审核中、已发布与被驳回"
        right={
          <Button asChild size="sm">
            <Link href="/write">
              <PenLine className="size-3.5" /> 写文章
            </Link>
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-4xl px-4 pb-10 pt-4">
        <MyPostsManager />
      </div>
    </div>
  );
}
