import { FolderOpen } from "lucide-react";
import type { User } from "@/db/schema";
import { ArticleCard } from "./article-card";
import { toFeedItemDTO } from "./queries";
import { TimelineHeader } from "@/components/site-shell";
import type { CollectionCardData } from "./types";

/**
 * X-style collection listing page body, shared by:
 *  - /u/[username]/collections/[slug]
 *  - /__sub/[subdomain]/collections/[slug]
 */
export function CollectionView({
  collection,
  author,
  items,
}: {
  collection: CollectionCardData;
  author: User;
  items: ReturnType<typeof toFeedItemDTO>[];
}) {
  return (
    <div className="min-h-dvh w-full max-w-[600px]">
      <TimelineHeader
        back
        title={collection.name}
        subtitle={`${author.displayName} 的合集 · ${collection.postCount} 篇文章`}
        right={<FolderOpen className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
      />

      {collection.description && (
        <p className="border-b border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {collection.description}
        </p>
      )}

      <div>
        {items.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-muted-foreground">
            该合集下还没有公开文章
          </div>
        ) : (
          items.map((it) => (
            <ArticleCard key={it.post.id} post={it.post} author={it.author} variant="list" />
          ))
        )}
      </div>
    </div>
  );
}
