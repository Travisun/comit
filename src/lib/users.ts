import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { follows, users, blocks, posts } from "@/db/schema";
import { conflict, forbidden, notFound } from "@/core/errors";
import { slugifyTitle, randomSuffix } from "@/lib/utils";

/**
 * 用户名（主页地址 handle，/{username} 访问）规则：
 *  - 3–30 字符，英文开头，仅英文/数字/下划线，下划线不可开头或结尾；
 *  - 大小写不区分（统一以小写存储与比较）；
 *  - 命中保留字列表即不可用（系统路由冲突 + 官方/权威冒充 + 易混淆词）。
 */
export const USERNAME_COOLDOWN_DAYS = 30;
export const USERNAME_MIN = 5;
export const USERNAME_MAX = 35;
export const USERNAME_RE = /^[a-z](?:[a-z0-9_]*[a-z0-9])?$/;

const RESERVED_SYSTEM_NAMES = new Set([
  "www", "app", "api", "admin", "mail", "smtp", "ftp", "ns1", "ns2",
  "feed", "blog", "help", "support", "about", "login", "logout", "register",
  "signup", "signin", "settings", "notifications", "messages", "write",
  "explore", "topics", "archive", "u", "p", "auth", "legal", "static",
  "assets", "cdn", "status", "docs", "rss", "sitemap", "me", "my", "user",
  "users", "post", "posts", "following", "followers", "collections",
  "account", "profile", "dashboard", "search", "upload", "media",
  "icons", "images", "img", "robots", "manifest", "favicon", "home",
  "index", "main", "new", "edit", "delete", "create", "verify", "reset",
  "forgot", "password", "2fa", "privacy", "terms", "copyright", "abuse",
  "dmca", "security", "report", "reports", "inbox", "console",
  "comit", "comitsh", "comit_sh", "official", "official_account", "staff",
  "team", "mod", "moderator", "sysadmin", "root", "administrator",
  "ceo", "cto", "founder", "owner", "null", "undefined", "none",
  "true", "false",
]);

/** 国家与地区名：英文常用名 + 主要拼音 */
const RESERVED_COUNTRY_NAMES = new Set([
  "china", "prc", "taiwan", "hongkong", "macau", "macao", "taiwan_region",
  "japan", "korea", "southkorea", "northkorea", "vietnam", "thailand",
  "myanmar", "burma", "cambodia", "laos", "malaysia", "singapore",
  "indonesia", "philippines", "india", "pakistan", "bangladesh",
  "srilanka", "nepal", "mongolia", "kazakhstan", "afghanistan",
  "iran", "iraq", "syria", "jordan", "lebanon", "israel", "palestine",
  "saudi", "saudiarabia", "uae", "qatar", "kuwait", "oman", "yemen",
  "turkey", "turkiye", "russia", "ukraine", "belarus", "poland",
  "germany", "france", "spain", "portugal", "italy", "greece",
  "netherlands", "holland", "belgium", "switzerland", "austria",
  "sweden", "norway", "denmark", "finland", "iceland", "ireland",
  "uk", "britain", "greatbritain", "england", "scotland", "wales",
  "usa", "america", "mexico", "cuba", "canada", "brazil", "argentina",
  "chile", "peru", "colombia", "venezuela", "bolivia", "ecuador",
  "egypt", "libya", "tunisia", "morocco", "algeria", "nigeria",
  "kenya", "ethiopia", "southafrica", "ghana", "sudan",
  "australia", "newzealand", "fiji",
  // 拼音
  "zhongguo", "meiguo", "yingguo", "faguo", "deguo", "eluosi", "eguo",
  "riben", "hanguo", "chaoxian", "yuenan", "taiguo", "miandian",
  "laowo", "xinjiapo", "malaixiya", "yinni", "feilvbin", "yindu",
  "bajisitan", "yilang", "yilake", "xuliya", "tuerqi", "bolan",
  "xibanya", "putaoya", "yidali", "xila", "helan", "bilishi",
  "ruidian", "nuowei", "danmai", "fenlan", "bingdao", "aodili",
  "ruishi", "jianada", "moxige", "guba", "baxi", "agenting", "zhili",
  "bilu", "gelunbiya", "weineiruila", "aiji", "nanfei", "keniya",
  "aodaliya", "xinxilan",
]);

/** 中国省市与行政区划（拼音） */
const RESERVED_CN_REGION_NAMES = new Set([
  "beijing", "shanghai", "tianjin", "chongqing",
  "guangzhou", "shenzhen", "zhuhai", "shantou", "foshan", "dongguan",
  "hangzhou", "ningbo", "wenzhou", "nanjing", "suzhou", "wuxi",
  "wuhan", "changsha", "chengdu", "xian", "xianyang", "zhengzhou",
  "jinan", "qingdao", "yantai", "shenyang", "dalian", "harbin",
  "changchun", "shijiazhuang", "taiyuan", "hefei", "fuzhou", "xiamen",
  "nanchang", "haikou", "kunming", "guiyang", "nanning", "lanzhou",
  "xining", "yinchuan", "urumqi", "lhasa", "hohhot",
  "guangdong", "jiangsu", "zhejiang", "sichuan", "hubei", "hunan",
  "henan", "hebei", "shandong", "shanxi", "shaanxi", "yunnan",
  "guizhou", "gansu", "qinghai", "hainan", "liaoning", "jilin",
  "heilongjiang", "anhui", "fujian", "jiangxi", "guangxi",
  "neimenggu", "ningxia", "xinjiang", "xizang", "xianggang", "aomen",
  "guowuyuan", "waijiaobu", "gonganbu", "minzhengbu", "caizhengbu",
  "jiaoyubu", "kejibu", "junwei", "fayuan", "jianchayuan",
]);

/** 知名企业名 */
const RESERVED_COMPANY_NAMES = new Set([
  "google", "apple", "microsoft", "meta", "facebook", "amazon", "netflix",
  "twitter", "xcorp", "openai", "anthropic", "deepmind", "spacex",
  "tesla", "nvidia", "intel", "amd", "ibm", "oracle", "sap",
  "salesforce", "adobe", "samsung", "sony", "huawei", "xiaomi",
  "tencent", "alibaba", "baidu", "bytedance", "toutiao", "douyin",
  "tiktok", "wechat", "weixin", "alipay", "taobao", "tmall", "jd",
  "jingdong", "meituan", "didi", "netease", "wangyi", "bilibili",
  "zhihu", "weibo", "kuaishou", "pinduoduo", "pdd", "linuxdo",
  "antgroup", "shein", "temu", "lenovo", "dji",
]);

export const RESERVED_USERNAMES = new Set([
  ...RESERVED_SYSTEM_NAMES,
  ...RESERVED_COUNTRY_NAMES,
  ...RESERVED_CN_REGION_NAMES,
  ...RESERVED_COMPANY_NAMES,
]);

/** 系统路由与官方/权威冒充词 */

export interface UsernameCheck {
  ok: boolean;
  reason?: string;
}

/** 格式与保留字检查（不查库）。输入应为用户原始输入，内部统一小写。 */
export function checkUsernameFormat(raw: string): UsernameCheck {
  const u = raw.trim().toLowerCase();
  if (u.length < USERNAME_MIN) {
    return { ok: false, reason: `用户名至少 ${USERNAME_MIN} 个字符 / At least ${USERNAME_MIN} characters` };
  }
  if (u.length > USERNAME_MAX) {
    return { ok: false, reason: `用户名最多 ${USERNAME_MAX} 个字符 / At most ${USERNAME_MAX} characters` };
  }
  if (!/^[a-z]/.test(u)) {
    return { ok: false, reason: "用户名必须以英文开头 / Must start with a letter" };
  }
  if (!USERNAME_RE.test(u)) {
    return {
      ok: false,
      reason: "仅支持英文、数字和下划线，且下划线不可结尾 / Only letters, digits and underscores (no trailing underscore)",
    };
  }
  if (RESERVED_USERNAMES.has(u)) {
    return { ok: false, reason: "该用户名为系统保留字 / This username is reserved" };
  }
  return { ok: true };
}

/** 完整可用性检查：格式 → 保留字 → 占用。 */
export async function checkUsernameAvailable(raw: string): Promise<UsernameCheck> {
  const fmt = checkUsernameFormat(raw);
  if (!fmt.ok) return fmt;
  const u = raw.trim().toLowerCase();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, u))
    .limit(1);
  if (row) return { ok: false, reason: "该用户名已被占用 / Username already taken" };
  return { ok: true };
}

export function isValidUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(u) && RESERVED_USERNAMES.has(u) === false;
}

export function isValidSubdomain(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) && RESERVED_USERNAMES.has(s) === false;
}

export async function assertUsernameAvailable(username: string) {
  if (!isValidUsername(username)) {
    throw conflict("用户名不可用（仅小写字母、数字、连字符）/ Username unavailable");
  }
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
  if (row) throw conflict("用户名已被占用 / Username taken");
}

export async function uniqueSlug(userId: string, title: string): Promise<string> {
  const base = slugifyTitle(title);
  const taken = new Set(
    (await db.select({ slug: posts.slug }).from(posts).where(eq(posts.authorId, userId))).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}-${randomSuffix(4)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function assertNotBlocked(a: string, b: string) {
  const [row] = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(
      and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
      and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
    ))
    .limit(1);
  if (row) throw forbidden("该操作被阻止 / This interaction is blocked");
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ followeeId: follows.followeeId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
    .limit(1);
  return Boolean(row);
}

export async function getUserByUsername(username: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username), eq(users.status, "active")))
    .limit(1);
  if (!user) throw notFound("用户不存在 / User not found");
  return user;
}
