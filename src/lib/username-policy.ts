/**
 * 用户名策略（单一来源）— 纯数据与纯函数，无 DB/Node 依赖。
 *
 * 被两处共享：
 *  - src/lib/users.ts（注册/改名/查库可用性）
 *  - src/proxy.ts（/{username} → /u/{username} 重写的保留字判断）
 *
 * ⚠️ 两处必须使用同一份保留字：历史缺陷是 proxy 硬编码了一份独立清单，
 * 与注册校验漂移后出现「sub 可注册但 /sub 被 proxy 保留 → 规范地址永久
 * 404」的路由遮蔽。新增顶级路由时：路由名单进 RESERVED_SYSTEM_NAMES，
 * 本文件是唯一出处。
 */

export const USERNAME_MIN = 5;
export const USERNAME_MAX = 35;
/** 改名口径：字母开头，仅小写字母/数字/下划线，下划线不可结尾。 */
export const USERNAME_RE = /^[a-z](?:[a-z0-9_]*[a-z0-9])?$/;

const RESERVED_SYSTEM_NAMES = new Set([
  "www", "app", "api", "admin", "mail", "smtp", "ftp", "ns1", "ns2",
  "feed", "blog", "help", "support", "about", "login", "logout", "register",
  "signup", "signin", "settings", "notifications", "messages", "write",
  "explore", "topics", "archive", "u", "p", "auth", "legal", "static",
  "hot", "onboarding",
  "assets", "cdn", "status", "docs", "rss", "sitemap", "me", "my", "user",
  "users", "post", "posts", "following", "followers", "collections",
  "account", "profile", "dashboard", "search", "upload", "media",
  "icons", "images", "img", "robots", "manifest", "favicon", "home",
  "index", "main", "new", "edit", "delete", "create", "verify", "reset",
  "forgot", "password", "2fa", "privacy", "terms", "copyright", "abuse",
  "dmca", "security", "report", "reports", "inbox", "console",
  "sub", "e", "comit", "comitsh", "comit_sh", "official", "official_account", "staff",
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

/**
 * 注册/OAuth 口径（比改名宽松：允许数字开头与连字符，便于从第三方
 * display name 机械生成）：
 *  - 2–63 字符，仅小写字母/数字/连字符/下划线；
 *  - 不可连字符/下划线结尾（外观一致性；OAuth 生成器本就剥除首尾连字符）。
 * proxy 重写正则与本口径的字符集并集对齐（含 - 和 _）。
 */
export function isValidUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,61}[a-z0-9]$/.test(u) && RESERVED_USERNAMES.has(u) === false;
}
