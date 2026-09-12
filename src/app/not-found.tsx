import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { routes } from "@/core/routes";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-xl place-items-center px-4 py-24 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
        <FileQuestion className="size-8" />
      </span>
      <h1 className="mt-6 text-5xl font-black tracking-tight">404</h1>
      <p className="mt-3 text-lg font-semibold">页面不存在 / Page not found</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        你访问的页面可能已被删除、移动，或者从未存在过。
        <br />
        The page you are looking for does not exist or has been moved.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href={routes.home}>返回首页 / Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={routes.explore}>去发现 / Explore</Link>
        </Button>
      </div>
    </div>
  );
}
