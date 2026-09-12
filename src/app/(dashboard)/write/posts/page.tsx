import type { Metadata } from "next";
import Link from "next/link";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MyPostsManager } from "@/components/dashboard/my-posts-manager";

export const metadata: Metadata = { title: "我的文章", robots: { index: false, follow: false } };

export default function MyPostsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">我的文章</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理你的全部内容：草稿、审核中、已发布与被驳回，覆盖完整生命周期。
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/write">
            <PenLine className="size-3.5" /> 写文章
          </Link>
        </Button>
      </header>
      <MyPostsManager />
    </div>
  );
}
