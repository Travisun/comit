import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, keywords, posts, type Comment, type Post } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { emit } from "@/core/events";
import { makeExcerpt, markdownToPlain } from "@/lib/utils";
import { llmAvailable, llmChat } from "@/lib/llm";

/**
 * Content moderation pipeline:
 *  1. Hard keyword scan (block/warn lists, admin-managed) — runs pre-submit
 *     and again at publish time.
 *  2. LLM review (OpenAI-compatible endpoint, configurable prompt) when
 *     reviewMode = "llm".
 *  3. Manual review queue when reviewMode = "manual" or LLM flags content.
 * Emits moderation events; notifications/rejections flow from there.
 */
export interface KeywordHit {
  word: string;
  severity: "block" | "warn";
}

export async function scanKeywords(text: string): Promise<KeywordHit[]> {
  const rows = await db.select().from(keywords);
  if (!rows.length) return [];
  const lower = text.toLowerCase();
  const hits: KeywordHit[] = [];
  for (const row of rows) {
    const w = row.word.toLowerCase().trim();
    if (w && lower.includes(w)) hits.push({ word: row.word, severity: row.severity });
  }
  return hits;
}

export interface LlmReviewResult {
  approved: boolean;
  score?: number;
  reason?: string;
  /** RLCD 处置动作：auto_reject 拒绝 / human_review 转人工 / auto_pass 通过 */
  action?: RlcdAction;
  /** RLCD 违规类别（normal/porn/violence/gambling/fraud/contraband/abuse/politics/spam/circumvention） */
  category?: string;
  /** RLCD 严重度（none/low/medium/high） */
  severity?: string;
}


/* ---------------------- Qwen-RLCD 审核服务对接 ----------------------------
 * 对接 ../Qwen-2.5-1B-RLCD 审核服务（OpenAI 兼容协议 + JSON Schema 约束输出）。
 * 接口规格（与 client/moderation_schema.py 严格对齐）：
 *   响应 content 解析为
 *   { violation, category(10 类), severity(4 级), confidence(0-1), reason(≤30字) }
 *   处置策略（client/moderate.py apply_policy 同款阈值）：
 *     violation ∧ confidence ≥ 0.85 → auto_reject（自动拒绝）
 *     violation ∧ confidence < 0.85 → human_review（转人工复核）
 *     ¬violation ∧ confidence ≥ 0.60 → auto_pass（自动通过）
 *     ¬violation ∧ confidence < 0.60 → human_review（转人工复核）
 */
export const RLCD_SYSTEM_PROMPT = "你是社交平台与自媒体文章的内容安全审核系统。对用户提交的内容做违规判定，只输出一个 JSON 对象。\n\n分类标准（category，十选一）：\n- normal: 正常内容。新闻转述、警方通报、法律条文科普、天气预报、学术/技术讨论、求助咨询、心理援助、文艺创作讨论、商品正常买卖等。即使话题涉及违规现象（如反诈宣传、报道赌博案、讲VPN技术原理），只要不是发布、推广、教唆或交易，就是 normal\n- porn: 色情低俗、招嫖（含表述含蓄的\"上门服务/约\"）、约炮交友、福利视频群、成人资源/写真售卖分发\n- violence: 暴力恐怖。血腥视频、打架/伤害手法教学、教唆报复、约死自残、虐待动物/儿童、恐怖组织宣传招募、美化恐怖袭击、暴恐音视频\n- gambling: 赌博。赌场开户揽客、百家乐/时时彩/六和彩平台、竞彩票跟单合买、德扑现金局返水、棋牌房卡代理、麻将透视开挂——只要出现赌博玩法、平台、跟单、返水任一要素，就归 gambling，即使同时承诺\"稳赚/月入过万\"（那只是揽客话术）\n- fraud: 诈骗、传销、刷单兼职骗局、虚假中奖领奖链接、冒充客服/领导诱导转账办事、原始股/虚拟币骗局——以\"编造身份或利益、骗取钱财\"为核心且无赌博要素\n- contraband: 毒品（含隐语\"四件套/原料\"）、枪支仿真武器、管制刀具弩箭、处方药滥用（曲马多/止咳水）、公民个人信息（开房记录/定位）买卖\n- abuse: 纯语言性攻击：辱骂、地域歧视、仇恨言论、恶意诅咒、人肉开盒、线下堵门威胁\n- politics: 涉政有害。政治谣言（\"官方隐瞒/真相被压\"类阴谋论、囤盐式恐慌煽动）、煽动线下聚集堵门、恶毒攻击英烈、煽动分裂、伪造官方文件/红头文件、\"境外势力\"名单类阴谋论传播\n- spam: 垃圾广告、代刷量、迷信转发诅咒链、论文代写、招聘打字员等引流刷屏（不涉欺诈）\n- circumvention: 仅限翻墙工具本身的售卖/推广：明确提到 VPN 账号买卖、\"机场\"节点订阅、翻墙APP安装包、科学上网服务收费带教。注意：普通的软件下载、教程视频、课程推荐、硬件买卖都不是 circumvention；不含\"翻墙/VPN/机场/节点/科学上网\"字样就绝不判此类\n\n判定优先级（从高到低）：\n1. 涉性交易/色情资源/约炮 → porn（即使同时在售卖）\n2. 恐怖主义宣传、虐待动物/儿童、伤害教学、约死 → violence\n3. 出现赌博玩法/平台/跟单/返水要素 → gambling（优先于 fraud）\n4. 政治谣言/煽动/攻击英烈/伪造公文 → politics（纯骂人无政治要素才是 abuse）\n5. 冒充身份诱导转账、刷单、虚假中奖、传销 → fraud\n6. 明确的翻墙工具售卖（VPN/机场/节点/梯子）→ circumvention\n7. 违禁品实物或个人信息交易 → contraband\n8. 只有纯辱骂诅咒 → abuse；只有纯广告刷量 → spam\n\nseverity（违规严重度）: normal 内容必须为 \"none\"；违规内容按 low / medium / high 判断，涉刑案类(porn、violence、gambling、fraud、contraband、circumvention、分裂国家)不得低于 \"medium\"。\n\nconfidence 为 0 到 1 的小数，表示判定把握。reason 用不超过 30 字说明判定依据。\n\n示例：\n内容: \"周末爬山拍了好多照片，山顶风景太美了，下次带爸妈一起来\"\n{\"violation\": false, \"category\": \"normal\", \"severity\": \"none\", \"confidence\": 0.98, \"reason\": \"日常生活分享，无违规\"}\n\n内容: \"警方通报破获一起刷单诈骗案，提醒群众切勿轻信兼职刷单\"\n{\"violation\": false, \"category\": \"normal\", \"severity\": \"none\", \"confidence\": 0.95, \"reason\": \"警方反诈通报，非诈骗发布\"}\n\n内容: \"加薇 xxx88 每天稳定500，导师一对一带你做任务，日结秒到\"\n{\"violation\": true, \"category\": \"fraud\", \"severity\": \"high\", \"confidence\": 0.9, \"reason\": \"典型刷单兼职诈骗话术\"}\n\n内容: \"网盘资源合集，高清完整版，学生妹资源，看头像私我\"\n{\"violation\": true, \"category\": \"porn\", \"severity\": \"high\", \"confidence\": 0.9, \"reason\": \"售卖色情资源归porn\"}\n\n内容: \"上门服务本人180有腹肌，预约微聊，价格面议\"\n{\"violation\": true, \"category\": \"porn\", \"severity\": \"high\", \"confidence\": 0.85, \"reason\": \"含蓄招嫖话术归porn\"}\n\n内容: \"足球内部稳胆消息，跟单十中九，输了包赔，进群上车\"\n{\"violation\": true, \"category\": \"gambling\", \"severity\": \"high\", \"confidence\": 0.9, \"reason\": \"赌球揽客，博彩链条归gambling\"}\n\n内容: \"转发：某地的事官方根本没报，真相被压着，别信媒体，懂的都懂\"\n{\"violation\": true, \"category\": \"politics\", \"severity\": \"medium\", \"confidence\": 0.8, \"reason\": \"政治谣言阴谋论调\"}\n\n内容: \"求推荐适合初学者的吉他教程，最好有视频的那种\"\n{\"violation\": false, \"category\": \"normal\", \"severity\": \"none\", \"confidence\": 0.98, \"reason\": \"正常课程求推荐\"}\n\n内容: \"澳门赌场线上开户，首存优惠，百家乐龙虎斗，秒提现\"\n{\"violation\": true, \"category\": \"gambling\", \"severity\": \"high\", \"confidence\": 0.9, \"reason\": \"赌场开户揽客，有博彩平台要素\"}\n\n内容: \"高速稳定机场推荐，不限流包月30，附各平台下载教程\"\n{\"violation\": true, \"category\": \"circumvention\", \"severity\": \"high\", \"confidence\": 0.9, \"reason\": \"售卖翻墙机场订阅\"}";

export const RLCD_JSON_SCHEMA = {"type": "object", "properties": {"violation": {"type": "boolean"}, "category": {"type": "string", "enum": ["normal", "porn", "violence", "gambling", "fraud", "contraband", "abuse", "politics", "spam", "circumvention"]}, "severity": {"type": "string", "enum": ["none", "low", "medium", "high"]}, "confidence": {"type": "number"}, "reason": {"type": "string"}}, "required": ["violation", "category", "severity", "confidence", "reason"], "additionalProperties": false};

export const RLCD_AUTO_REJECT_CONFIDENCE = 0.85;
export const RLCD_AUTO_PASS_CONFIDENCE = 0.6;

export type RlcdAction = "auto_reject" | "human_review" | "auto_pass";

/** RLCD 响应 → 统一审核结果（含处置动作）；非法形状返回 null。 */
export function normalizeRlcdReview(parsed: Record<string, unknown>): LlmReviewResult | null {
  if (typeof parsed.violation !== "boolean") return null;
  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
  const action: RlcdAction = parsed.violation
    ? confidence >= RLCD_AUTO_REJECT_CONFIDENCE
      ? "auto_reject"
      : "human_review"
    : confidence >= RLCD_AUTO_PASS_CONFIDENCE
      ? "auto_pass"
      : "human_review";
  return {
    approved: action === "auto_pass",
    action,
    score: confidence,
    category: typeof parsed.category === "string" ? parsed.category : undefined,
    severity: typeof parsed.severity === "string" ? parsed.severity : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
  };
}

export async function llmReview(text: string): Promise<LlmReviewResult | null> {
  const cfg = await getSetting("moderation.llm");
  // 审核接入系统 LLM 能力：接口与密钥统一在 站点设置 → AI 模型
  // （llm.providers）维护，这里只做模型选择（providerId/model，空 = 平台
  // 默认）与提示词；providers 全未配置时回退旧版 moderation.llm 凭证，
  // 两侧都不可用则视为"LLM 不可用"。
  if (!(await llmAvailable(cfg.providerId || undefined))) return null;
  const rlcd = Boolean((cfg as { rlcd?: boolean }).rlcd);
  try {
    const content = await llmChat({
      messages: rlcd
        ? [
            { role: "system", content: RLCD_SYSTEM_PROMPT },
            { role: "user", content: `审核以下内容：\n${text.slice(0, 8000)}` },
          ]
        : [
            { role: "system", content: cfg.prompt },
            { role: "user", content: `请审核以下内容并只返回 JSON：\n\n${text.slice(0, 8000)}` },
          ],
      providerId: cfg.providerId || undefined,
      model: cfg.model || undefined,
      // RLCD 服务规格要求 temperature=0 的受约束输出
      temperature: rlcd ? 0 : cfg.temperature,
      maxTokens: rlcd ? 120 : undefined,
      ...(rlcd
        ? { responseFormat: "json_schema" as const, jsonSchema: { name: "moderation_result", schema: RLCD_JSON_SCHEMA } }
        : { json: true }),
    });
    const parsed = JSON.parse(content || "{}") as Record<string, unknown>;
    return (
      normalizeRlcdReview(parsed) ?? {
        // 旧版通用格式 {approved, score, reason}
        approved: Boolean(parsed.approved),
        score: parsed.score as number | undefined,
        reason: parsed.reason as string | undefined,
      }
    );
  } catch (err) {
    console.error("[moderation] llm review failed:", err);
    return null;
  }
}

export interface ReviewOutcome {
  status: "published" | "pending_review" | "rejected";
  keywordHits: KeywordHit[];
  llm?: LlmReviewResult | null;
  reason?: string;
}

/** Full pipeline for a post being submitted for publication. */
export async function reviewPost(post: Post): Promise<ReviewOutcome> {
  const reviewMode = await getSetting("moderation.reviewMode");
  const keywordsEnabled = await getSetting("moderation.keywordsEnabled");
  const failMode = await getSetting("moderation.llmFailMode");
  const text = `${post.title ?? ""}\n${post.content}`;

  const keywordHits = keywordsEnabled ? await scanKeywords(text) : [];
  if (keywordHits.some((h) => h.severity === "block")) {
    await finish(post.id, "rejected", keywordHits, null, "包含被禁止的关键词 / contains blocked keywords", "keyword");
    return { status: "rejected", keywordHits, reason: "包含被禁止的关键词 / blocked keywords detected" };
  }

  const warned = keywordHits.length > 0;
  let llm: LlmReviewResult | null = null;

  if (reviewMode === "llm" && !warned) {
    llm = await llmReview(markdownToPlain(post.content).slice(0, 8000) || (post.title ?? ""));
    if (!llm) {
      // provider failure → fail-open or fail-closed per settings
      if (failMode === "closed") {
        await finish(post.id, "pending_review", keywordHits, llm, "LLM 审核暂时不可用", "llm");
        return { status: "pending_review", keywordHits, llm };
      }
    } else if (llm.action === "human_review") {
      // RLCD 处置：违规但置信不足（或正常但置信过低）→ 转人工复核
      await finish(post.id, "pending_review", keywordHits, llm, "LLM 置信度不足，转人工复核", "llm");
      return { status: "pending_review", keywordHits, llm };
    } else if (!llm.approved) {
      await finish(post.id, "rejected", keywordHits, llm, llm.reason ?? "LLM 审核未通过", "llm");
      return { status: "rejected", keywordHits, llm, reason: llm.reason };
    }
  }

  if (reviewMode === "manual" || warned || (reviewMode === "llm" && !llm)) {
    await finish(post.id, "pending_review", keywordHits, llm, warned ? "命中警告关键词，转人工审核" : undefined, "manual");
    return { status: "pending_review", keywordHits, llm };
  }

  // approved → publish
  await db
    .update(posts)
    .set({
      status: "published",
      publishedAt: new Date(),
      moderation: {
        keyword: keywordHits.length ? { severity: "warn", hits: keywordHits.map((h) => h.word) } : undefined,
        llm: llm ?? undefined,
        reviewedAt: new Date().toISOString(),
      },
    })
    .where(eq(posts.id, post.id));
  await emit("moderation:review.completed", { postId: post.id, approved: true, by: reviewMode === "llm" ? "llm" : "keyword" });
  // 过审即正式发布：与 reviewMode=off 的直发路径一致，补发 post:published
  // （webhooks/后续监听者依赖该事件感知发布）
  const [published] = await db
    .select({ publicId: posts.publicId, title: posts.title, type: posts.type })
    .from(posts)
    .where(eq(posts.id, post.id))
    .limit(1);
  if (published) {
    await emit("post:published", {
      postId: post.id,
      authorId: post.authorId,
      publicId: published.publicId,
      title: published.title ?? "",
      type: published.type,
    });
  }
  return { status: "published", keywordHits, llm };
}

/* --------------------------- comment review ------------------------------- */

export interface CommentReviewOutcome {
  status: "visible" | "pending_review" | "rejected";
  keywordHits: KeywordHit[];
  llm?: LlmReviewResult | null;
  reason?: string;
}

/**
 * Full pipeline for a comment awaiting review (status = pending_review)。
 * 与 reviewPost 同构：关键词 → LLM（reviewMode=llm）→ 人工兜底；
 * 通过时才转 visible + commentCount 自增 + emit comment:created
 * （通知/webhook 只在过审后感知到这条评论）。
 */
export async function reviewComment(comment: Comment): Promise<CommentReviewOutcome> {
  const reviewMode = await getSetting("moderation.reviewMode");
  const keywordsEnabled = await getSetting("moderation.keywordsEnabled");
  const failMode = await getSetting("moderation.llmFailMode");

  const keywordHits = keywordsEnabled ? await scanKeywords(comment.body) : [];
  if (keywordHits.some((h) => h.severity === "block")) {
    const reason = "包含被禁止的关键词 / contains blocked keywords";
    await finishComment(comment, "rejected", keywordHits, null, reason, "keyword");
    return { status: "rejected", keywordHits, reason };
  }

  const warned = keywordHits.length > 0;
  let llm: LlmReviewResult | null = null;

  if (reviewMode === "llm" && !warned) {
    llm = await llmReview(comment.body.slice(0, 8000));
    if (!llm) {
      if (failMode === "closed") {
        await finishComment(comment, "pending_review", keywordHits, llm, "LLM 审核暂时不可用", "llm");
        return { status: "pending_review", keywordHits, llm };
      }
    } else if (llm.action === "human_review") {
      await finishComment(comment, "pending_review", keywordHits, llm, "LLM 置信度不足，转人工复核", "llm");
      return { status: "pending_review", keywordHits, llm };
    } else if (!llm.approved) {
      const reason = llm.reason ?? "LLM 审核未通过";
      await finishComment(comment, "rejected", keywordHits, llm, reason, "llm");
      return { status: "rejected", keywordHits, llm, reason };
    }
  }

  if (reviewMode === "manual" || warned || (reviewMode === "llm" && !llm)) {
    await finishComment(comment, "pending_review", keywordHits, llm, warned ? "命中警告关键词，转人工审核" : undefined, "manual");
    return { status: "pending_review", keywordHits, llm };
  }

  // approved → visible + 计数 + 事件（与直发路径同一组副作用）
  await publishComment(comment, {
    keyword: keywordHits.length ? { severity: "warn", hits: keywordHits.map((h) => h.word) } : undefined,
    llm: llm ?? undefined,
    reviewedBy: reviewMode === "llm" ? "llm" : "keyword",
  });
  return { status: "visible", keywordHits, llm };
}

/**
 * 评论过审落库：pending_review/rejected → visible + commentCount 自增 +
 * emit comment:created（通知/webhook 挂在该事件上）。人工过审（管理端）与
 * 自动过审共用，保证计数与事件副作用只有这一处实现。
 */
export async function publishComment(
  comment: Comment,
  moderation?: { keyword?: { severity: string; hits: string[] }; llm?: { approved: boolean; score?: number; reason?: string }; reviewedBy?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(comments)
      .set({
        status: "visible",
        moderation: {
          ...moderation,
          reviewedAt: new Date().toISOString(),
          reviewedBy: moderation?.reviewedBy ?? "manual",
        },
      })
      .where(eq(comments.id, comment.id));
    await tx
      .update(posts)
      .set({ commentCount: sql`${posts.commentCount} + 1` })
      .where(eq(posts.id, comment.postId));
  });
  const [post] = await db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, comment.postId))
    .limit(1);
  if (post) {
    void emit("comment:created", {
      commentId: comment.id,
      postId: comment.postId,
      postAuthorId: post.authorId,
      commenterId: comment.userId,
      replyToUserId: comment.replyToUserId ?? null,
      excerpt: makeExcerpt(comment.body, 120),
    });
    // 评论过审（LLM 自动 / 管理员人工）→ 通知评论作者「已通过审核并公开」
    void emit("moderation:review.completed", {
      postId: comment.postId,
      commentId: comment.id,
      approved: true,
      by: moderation?.reviewedBy === "llm" ? "llm" : "manual",
    });
  }
}

async function finishComment(
  comment: Comment,
  status: "pending_review" | "rejected",
  keywordHits: KeywordHit[],
  llm: LlmReviewResult | null,
  reason: string | undefined,
  by: "keyword" | "llm" | "manual",
) {
  // pending → pending 无需回写（无状态变化）；rejected 落状态供作者自见
  if (status === "pending_review" && !reason) return;
  await db
    .update(comments)
    .set({
      status,
      moderation: {
        keyword: keywordHits.length ? { severity: "warn", hits: keywordHits.map((h) => h.word) } : undefined,
        llm: llm ?? undefined,
        reviewedAt: new Date().toISOString(),
        reviewedBy: by,
      },
    })
    .where(eq(comments.id, comment.id));
  if (status === "rejected") {
    await emit("moderation:review.completed", { postId: comment.postId, approved: false, by, reason, commentId: comment.id });
  }
}

async function finish(
  postId: string,
  status: "pending_review" | "rejected",
  keywordHits: KeywordHit[],
  llm: LlmReviewResult | null,
  reason: string | undefined,
  by: "keyword" | "llm" | "manual",
) {
  await db
    .update(posts)
    .set({
      status,
      rejectReason: status === "rejected" ? (reason ?? null) : null,
      moderation: {
        keyword: keywordHits.length ? { severity: "warn", hits: keywordHits.map((h) => h.word) } : undefined,
        llm: llm ?? undefined,
        reviewedAt: new Date().toISOString(),
        reviewedBy: by,
      },
    })
    .where(eq(posts.id, postId));
  if (status === "rejected") {
    const [row] = await db
      .select({ authorId: posts.authorId, title: posts.title, publicId: posts.publicId })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (row) {
      await emit("moderation:review.completed", { postId, approved: false, by, reason });
    }
  }
}

/** Pre-submit check used by the editor API (soft feedback to the author). */
export async function preSubmitCheck(title: string, content: string) {
  const keywordsEnabled = await getSetting("moderation.keywordsEnabled");
  if (!keywordsEnabled) return { blocked: [] as string[], warned: [] as string[] };
  const hits = await scanKeywords(`${title}\n${content}`);
  return {
    blocked: hits.filter((h) => h.severity === "block").map((h) => h.word),
    warned: hits.filter((h) => h.severity === "warn").map((h) => h.word),
  };
}

export async function pendingReviewCount(): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(posts)
    .where(eq(posts.status, "pending_review"));
  return n;
}
