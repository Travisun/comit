import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, keywords, posts, type Comment, type Post } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { emit } from "@/core/events";
import { makeExcerpt, markdownToPlain } from "@/lib/utils";
import { mentionTokensToPlainText } from "@/lib/mentions";
import {
  llmAvailable,
  llmChat,
  llmComplete,
  type LlmLogprobToken,
} from "@/lib/llm";

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
  /** logprobs 提取的真实 P(violation)（0-1；替代模型自报 confidence） */
  pViolation?: number;
  /** RLCD 处置动作：auto_reject 拒绝 / human_review 转人工 / auto_pass 通过 */
  action?: RlcdAction;
  /** RLCD 违规类别（normal/porn/violence/gambling/fraud/contraband/abuse/politics/spam/circumvention） */
  category?: string;
  /** RLCD 严重度（none/low/medium/high） */
  severity?: string;
}


/* ---------------------- Qwen-RLCD 审核服务对接（v7.3） ----------------------
 * 对接 ../Qwen-2.5-1B-RLCD 审核逻辑（与 client/moderation_schema.py v7.3 对齐）。
 *  - 中篇提示词：要点规则 + 紧凑对比示例（RLCD 对比范式，~700 tokens）
 *  - 真实概率：logprobs 提取 P(violation)（true/false 候选子集 softmax），
 *    替代模型自报 confidence（实测恒虚高 0.9+，不可信）
 *  - 多证据处置路由（宁转人工、不误杀、不漏判）：
 *      violation ∧ 交易型类别 ∧ P≥0.95 ∧ 词表命中 ∧ 非通报语境 → auto_reject
 *      violation 其余（灰区 / abuse·violence·politics 解读型类别）→ human_review
 *      ¬violation ∧ 词表命中（黑话盲区）                         → human_review
 *      ¬violation ∧ 无词表命中                                   → auto_pass
 */
export const RLCD_SYSTEM_PROMPT = `你是社交平台内容安全审核系统，判断内容是否违规并分类，只输出JSON。
类别：porn 色情招嫖与性资源买卖；violence 暴力恐怖/虐待/传授伤害/教唆自残约死；gambling 赌博博彩/赌场开户/赌球跟单/赌博外挂；fraud 诈骗/传销/刷单兼职骗局/虚假中奖/冒充诱导转账；contraband 毒品/武器/管制器具/处方药滥用/个人信息买卖；abuse 辱骂歧视/仇恨诅咒/人肉威胁；politics 政治谣言/煽动聚集/攻击英烈/分裂/伪造公文；spam 垃圾广告/代刷量/迷信转发；circumvention 售卖翻墙工具(VPN/机场/节点/梯子)；normal 正常内容。
判定要点：
1. 色情资源买卖归 porn；有博彩要素归 gambling 优先于 fraud；翻墙售卖归 circumvention；违禁品实物交易归 contraband
2. severity: normal 必为 none；涉刑案类(porn/violence/gambling/fraud/contraband/circumvention)不低于 medium
3. 对话与短文本：疑问/反问/追问/澄清/敷衍/无指向情绪宣泄都是 normal；abuse 必须有明确侮辱歧视诅咒词汇
4. 新闻/警方通报/法律科普/影评/游戏测评/心理援助等讨论敏感话题的正常内容是 normal
5. reason 不超过15字
示例：
内容：网盘资源合集，高清完整版，学生妹资源，看头像私我
{"violation": true, "category": "porn", "severity": "high", "reason": "售卖色情资源"}
内容：高速稳定机场推荐，不限流包月30，附各平台下载教程
{"violation": true, "category": "circumvention", "severity": "high", "reason": "售卖翻墙机场订阅"}
内容：加薇 xxx88 每天稳定500，导师一对一带你做任务，日结秒到
{"violation": true, "category": "fraud", "severity": "high", "reason": "刷单诈骗话术"}
内容：澳门赌场线上开户，首存优惠，百家乐龙虎斗，秒提现
{"violation": true, "category": "gambling", "severity": "high", "reason": "赌场开户揽客"}
内容：出售处方药曲马多和止咳水，散装零售均可，发货隐蔽
{"violation": true, "category": "contraband", "severity": "high", "reason": "违禁处方药交易"}
内容：全网最低价代刷粉丝点赞，十万粉只要三天，需要私聊
{"violation": true, "category": "spam", "severity": "medium", "reason": "代刷垃圾广告"}
内容：警方通报破获一起刷单诈骗案，提醒群众切勿轻信兼职刷单
{"violation": false, "category": "normal", "severity": "none", "reason": "警方反诈通报"}
内容：我并没有说什么啊，你到底说的什么呢？
{"violation": false, "category": "normal", "severity": "none", "reason": "对话澄清追问"}
内容：你到底，你说啥？
{"violation": false, "category": "normal", "severity": "none", "reason": "不耐烦追问，无辱骂"}
内容：我来试试吧。
{"violation": false, "category": "normal", "severity": "none", "reason": "正常交流"}`;

export const RLCD_JSON_SCHEMA = {
  type: "object",
  properties: {
    violation: { type: "boolean" },
    category: {
      type: "string",
      enum: ["normal", "porn", "violence", "gambling", "fraud", "contraband", "abuse", "politics", "spam", "circumvention"],
    },
    severity: { type: "string", enum: ["none", "low", "medium", "high"] },
    reason: { type: "string" },
  },
  required: ["violation", "category", "severity", "reason"],
  additionalProperties: false,
};

/** 自动拒绝概率门槛（logprobs 真实 P(violation)，在标注集上标定） */
export const RLCD_T_REJECT = 0.95;

/** 各类别确定性标记词：auto_reject 的证据门槛（命中词表 ∩ 模型判定才机器处置） */
const CATEGORY_MARKERS: Record<string, string[]> = {
  abuse: ["操你", "草你", "妈的", "他妈", "傻逼", "煞笔", "傻B", "傻b", "脑残", "白痴", "废物", "滚蛋", "滚吧", "去死", "该死", "找死", "打死你", "弄死你", "全家", "畜生", "贱人", "婊", "杂种", "断子绝孙", "不得好死", "暴毙", "人肉", "开盒", "查他住址", "堵他", "滚出", "丑逼", "蠢货", "低能", "弱智"],
  violence: ["炸弹", "爆炸装置", "自制土炸", "枪支出售", "砍人", "捅穿", "处刑", "砍头", "教你打", "失去反抗", "约死", "一起跳", "自残方法", "虐待动物", "虐猫", "虐童", "活剥", "圣战", "恐怖组织", "殉教", "发动袭击", "招募兄弟", "报复渣男", "毁掉他的生活", "让他生不如死", "验伤都验不出", "血腥处刑"],
  politics: ["官方根本没报", "官方隐瞒", "真相被压", "别信媒体", "煽动", "线下聚集", "市政府门口", "攻击英烈", "分裂分子", "捐款通道", "境外势力", "红头文件", "伪造", "囤粮囤盐", "慢性投毒", "政府隐瞒", "把事情闹大"],
  gambling: ["百家乐", "时时彩", "六和彩", "六合彩", "赌球", "跟单", "押注", "外围", "返水", "竞彩", "德扑", "棋牌代理", "房卡代理", "开挂", "透视", "注册送体验金", "开户", "赌场", "倍投", "稳胆", "博彩", "赌资", "下注"],
  fraud: ["刷单", "垫付", "佣金", "中奖", "安全账户", "保证金", "原始股", "带做任务", "日结", "资金盘", "拉人头", "返利", "钓鱼链接", "冒充客服", "我是你领导", "虚拟币搬砖", "入门费", "包过", "代考", "解冻金", "稳赚不赔"],
  porn: ["无码", "粉嫩", "上门服务", "约炮", "一夜情", "福利姬", "福利视频", "成人APP", "破解版免费", "私密舞", "招嫖", "嫖", "写真私人订制", "资源打包", "学生妹"],
  contraband: ["曲马多", "止咳水", "处方药", "仿真枪", "弩", "开锁工具", "开房记录", "定位查询", "四件套", "烟弹", "毒品", "冰毒", "摇头丸", "迷药", "出售枪"],
  circumvention: ["VPN", "vpn", "机场推荐", "机场订阅", "节点订阅", "梯子", "科学上网", "翻墙", "Clash", "clash", "加速器账号", "跨境加速"],
  spam: ["代刷", "涨粉", "互赞", "互关", "锦鲤", "转发这条", "代写", "论文代发", "流量卡免费送", "扣1", "评论区扣", "招代理", "一件代发"],
};

/** 自动拒绝仅限交易型类别（证据可词表化）；解读型类别一律人工 */
const AUTO_REJECT_CATEGORIES = new Set(["porn", "gambling", "fraud", "contraband", "circumvention", "spam"]);

/** 新闻/通报/科普语境线索：命中则抑制自动拒绝（通报含"刷单"命中词表属假证据） */
const REPORT_CUES = ["警方通报", "警方提示", "警方破获", "新闻报道", "记者", "据报道", "通报", "科普", "普法", "法律咨询", "律师", "提醒群众", "预警", "答疑", "反诈宣传", "禁毒宣传", "纪录片", "影评", "测评", "倡议书"];

function hasMarker(text: string, markers: string[]): boolean {
  return markers.some((m) => text.includes(m));
}

function matchedCategories(text: string): string[] {
  return Object.entries(CATEGORY_MARKERS)
    .filter(([, markers]) => hasMarker(text, markers))
    .map(([cat]) => cat);
}

/**
 * 从 logprobs 提取真实 P(violation)：找到第一个同时含 true/false 候选的位置，
 * 在两候选上做子集 softmax（受约束解码下即校准概率）。无 logprobs 时返回 null。
 */
export function extractViolationProbability(logprobs?: LlmLogprobToken[]): number | null {
  for (const tok of logprobs ?? []) {
    const lps = new Map(tok.topLogprobs.map((c) => [c.token, c.logprob] as const));
    const lt = lps.get("true");
    const lf = lps.get("false");
    if (lt !== undefined && lf !== undefined) {
      const m = Math.max(lt, lf);
      const et = Math.exp(lt - m);
      const ef = Math.exp(lf - m);
      return et / (et + ef);
    }
  }
  return null;
}

/** RLCD 响应 + 真实概率 → 统一审核结果（v7.3 处置路由）；非法形状返回 null。 */
export function normalizeRlcdReview(
  parsed: Record<string, unknown>,
  text: string,
  p: number,
): LlmReviewResult | null {
  if (typeof parsed.violation !== "boolean") return null;
  const violation = parsed.violation;
  const category = typeof parsed.category === "string" ? parsed.category : "normal";
  const severity = typeof parsed.severity === "string" ? parsed.severity : undefined;
  const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;

  let action: RlcdAction;
  if (violation) {
    action =
      AUTO_REJECT_CATEGORIES.has(category) &&
      p >= RLCD_T_REJECT &&
      hasMarker(text, CATEGORY_MARKERS[category] ?? []) &&
      !REPORT_CUES.some((cue) => text.includes(cue))
        ? "auto_reject"
        : "human_review";
  } else {
    action = matchedCategories(text).length > 0 ? "human_review" : "auto_pass";
  }

  return {
    approved: action === "auto_pass",
    action,
    score: violation ? p : 1 - p,
    pViolation: p,
    category,
    severity,
    reason,
  };
}

export type RlcdAction = "auto_reject" | "human_review" | "auto_pass";

export async function llmReview(text: string): Promise<LlmReviewResult | null> {
  const cfg = await getSetting("moderation.llm");
  // 审核接入系统 LLM 能力：接口与密钥统一在 站点设置 → AI 模型
  // （llm.providers）维护，这里只做模型选择（providerId/model，空 = 平台
  // 默认）与提示词；providers 全未配置时回退旧版 moderation.llm 凭证，
  // 两侧都不可用则视为"LLM 不可用"。
  if (!(await llmAvailable(cfg.providerId || undefined))) {
    return null;
  }
  const rlcd = Boolean((cfg as { rlcd?: boolean }).rlcd);
  try {
    if (rlcd) {
      // RLCD v7.3：受约束输出 + logprobs 真实概率（温度必须 0）
      const result = await llmComplete({
        messages: [
          { role: "system", content: RLCD_SYSTEM_PROMPT },
          { role: "user", content: `内容：${text.slice(0, 8000)}` },
        ],
        providerId: cfg.providerId || undefined,
        model: cfg.model || undefined,
        temperature: 0,
        maxTokens: 200,
        responseFormat: "json_schema",
        jsonSchema: { name: "moderation_result", schema: RLCD_JSON_SCHEMA },
        logprobs: true,
        topLogprobs: 20,
      });
      const parsed = JSON.parse(result.text || "{}") as Record<string, unknown>;
      const p =
        extractViolationProbability(result.logprobsContent) ??
        (typeof parsed.violation === "boolean" && parsed.violation ? 1 : 0);
      return normalizeRlcdReview(parsed, text, p);
    }
    const content = await llmChat({
      messages: [
        { role: "system", content: cfg.prompt },
        { role: "user", content: `请审核以下内容并只返回 JSON：\n\n${text.slice(0, 8000)}` },
      ],
      providerId: cfg.providerId || undefined,
      model: cfg.model || undefined,
      json: true,
    });
    const parsed = JSON.parse(content || "{}") as Record<string, unknown>;
    // 旧版通用格式 {approved, score, reason}
    return {
      approved: Boolean(parsed.approved),
      score: parsed.score as number | undefined,
      reason: parsed.reason as string | undefined,
    };
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
    // 与帖子同口径：喂给模型的永远是拉平后的纯文本（mention 引用语法会把它
    // 稀释成一串 uuid，既干扰判定也白烧 token）
    llm = await llmReview(
      markdownToPlain(await mentionTokensToPlainText(comment.body)).slice(0, 8000),
    );
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
