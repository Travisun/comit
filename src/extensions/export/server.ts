import { ZipArchive } from "archiver";
import path from "path";
import fs from "fs";
import { eq, inArray, desc } from "drizzle-orm";
import { db } from "@/db";
import { posts, exportJobs, users, postTopics, topics, collections, media } from "@/db/schema";
import { readMediaFile } from "@/lib/media";
import { asStorageTag, type StorageTag } from "@/lib/storage";
import { config } from "@/core/config";
import type { Plugin } from "@/core/plugins/types";

/**
 * Export plugin — GDPR-friendly full data export: every post becomes
 * `<yyyy>/<MM>/<slug>/index.md` with its media beside it in `media/`,
 * bundled into a single ZIP available for download.
 */
const EXPORT_ROOT = path.join(process.cwd(), "storage", "exports");

async function buildExport(userId: string, requestId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("user gone");

  // 一次预取 media 行驱动：读文件经存储抽象按行分派（local 读盘 / r2 拉 R2），
  // 正文里的路径若不在 media 表（异常历史数据）按 local 兜底，缺失容忍跳过
  const storageByPath = new Map<string, StorageTag>(
    (
      await db
        .select({ path: media.path, storage: media.storage })
        .from(media)
        .where(eq(media.userId, userId))
    ).map((m) => [m.path, asStorageTag(m.storage)]),
  );

  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.authorId, userId))
    .orderBy(desc(posts.publishedAt), desc(posts.createdAt));

  await fs.promises.mkdir(EXPORT_ROOT, { recursive: true });
  const workDir = path.join(EXPORT_ROOT, requestId);
  await fs.promises.mkdir(workDir, { recursive: true });

  let index = `# ${user.displayName} (@${user.username}) — comit.sh 导出\n\n`;
  const copyMedia = async (relPath: string, destDir: string): Promise<string> => {
    await fs.promises.mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, path.basename(relPath));
    await readMediaFile(relPath, storageByPath.get(relPath) ?? "local")
      .then((buf) => fs.promises.writeFile(dest, buf))
      .catch(() => {});
    return `media/${path.basename(relPath)}`;
  };

  // 批量预取 topics / collections（历史 N+1：每篇 2 查询 → 全程最多 2 查询）
  const postIds = rows.map((p) => p.id);
  const topicsByPost = new Map<string, string[]>();
  if (postIds.length) {
    // inArray 空数组会生成非法 SQL → 空集直接跳过查询
    const topicRows = await db
      .select({ postId: postTopics.postId, name: topics.name })
      .from(postTopics)
      .innerJoin(topics, eq(topics.id, postTopics.topicId))
      .where(inArray(postTopics.postId, postIds))
      .orderBy(topics.name); // 确定性输出：同一文章的 topics 顺序稳定
    for (const t of topicRows) {
      const list = topicsByPost.get(t.postId);
      if (list) list.push(t.name);
      else topicsByPost.set(t.postId, [t.name]);
    }
  }
  const collectionNames = new Map<string, string>();
  const collectionIds = [
    ...new Set(rows.map((p) => p.collectionId).filter((id): id is string => id !== null)),
  ];
  if (collectionIds.length) {
    const cRows = await db
      .select({ id: collections.id, name: collections.name })
      .from(collections)
      .where(inArray(collections.id, collectionIds));
    for (const c of cRows) collectionNames.set(c.id, c.name);
  }

  for (const post of rows) {
    const d = post.publishedAt ?? post.createdAt;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const slug = post.publicId;
    const dir = path.join(workDir, String(yyyy), mm, slug);
    await fs.promises.mkdir(dir, { recursive: true });

    // media referenced by cover + inline images in content
    const mediaRefs = new Set<string>();
    if (post.coverPath) mediaRefs.add(post.coverPath);
    for (const m of contentImagePaths(post.content)) mediaRefs.add(m);

    const mediaDir = path.join(dir, "media");
    let body = post.content;
    for (const rel of mediaRefs) {
      const local = await copyMedia(rel, mediaDir);
      body = body.replaceAll(`/api/media/file/${rel}`, local).replaceAll(rel, local);
    }

    // 内存组装（批量预取结果），导出产物与逐篇查询时完全一致
    const postTopicNames = topicsByPost.get(post.id) ?? [];
    const collectionName = post.collectionId ? (collectionNames.get(post.collectionId) ?? null) : null;

    const fm = [
      "---",
      `title: ${JSON.stringify(post.title ?? "")}`,
      `type: ${post.type}`,
      `status: ${post.status}`,
      `slug: ${slug}`,
      post.publishedAt ? `published: ${post.publishedAt.toISOString()}` : null,
      `created: ${post.createdAt.toISOString()}`,
      collectionName ? `collection: ${JSON.stringify(collectionName)}` : null,
      postTopicNames.length ? `topics: [${postTopicNames.map((n) => JSON.stringify(n)).join(", ")}]` : null,
      post.coverPath ? `cover: media/${path.basename(post.coverPath)}` : null,
      `url: ${config.app.url}/u/${user.username}/posts/${slug}`,
      "---",
    ]
      .filter(Boolean)
      .join("\n");

    await fs.promises.writeFile(
      path.join(dir, "index.md"),
      `${fm}\n\n# ${post.title ?? ""}\n\n${body}\n`,
      "utf8",
    );
    index += `- [${yyyy}-${mm}] ${post.title ?? "(untitled)"} — ${post.status}\n`;
  }
  await fs.promises.writeFile(path.join(workDir, "README.md"), index, "utf8");

  const zipPath = path.join(EXPORT_ROOT, `${requestId}.zip`);
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(workDir, "");
    void archive.finalize();
  });
  await fs.promises.rm(workDir, { recursive: true, force: true });

  const size = fs.statSync(zipPath).size;
  await db
    .update(exportJobs)
    .set({ status: "done", filePath: path.relative(process.cwd(), zipPath), sizeBytes: size, finishedAt: new Date() })
    .where(eq(exportJobs.id, requestId));
}

function contentImagePaths(md: string): string[] {
  const out = new Set<string>();
  const re = /\/api\/media\/file\/([A-Za-z0-9/_\\.-]+\.webp)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.add(m[1]);
  return [...out];
}

const plugin: Plugin = {
  name: "export",
  description: "Full data export (markdown + media, zipped)",
  version: "1.0.0",
  register() {
    /* workers call processExportJob directly */
  },
};

export default plugin;

export async function processExportJob(userId: string, requestId: string): Promise<void> {
  try {
    await db.update(exportJobs).set({ status: "building" }).where(eq(exportJobs.id, requestId));
    await buildExport(userId, requestId);
  } catch (err) {
    console.error("[export] failed:", err);
    await db
      .update(exportJobs)
      .set({ status: "failed", error: String(err) })
      .where(eq(exportJobs.id, requestId));
  }
}

export { EXPORT_ROOT };
