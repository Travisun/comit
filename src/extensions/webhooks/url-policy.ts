/**
 * Webhook 端点 URL 准入策略（纯函数、零 server-only 依赖 → 可直接单测）。
 *
 * 定位：这是 SSRF 防线的**第一层**（注册时快速拒绝明显危险的地址）；
 * 权威判定在投递时的 `core/http-client` ssrfGuard（DNS 解析后逐跳/逐地址校验）。
 * 两层缺一不可：注册层挡住字面量与协议滥用，投递层挡住「域名 → 内网 IP」。
 *
 * 为什么这些规则值得单独成文件（对照 2026-09 审计结论）：
 *  - zod v4 的 `z.url()` 对 scheme 极其宽松（`javascript:`、`ftp:`、`httpx:` 全部通过），
 *    旧的 `.startsWith("http")` 因此形同虚设 → 必须用 `new URL()` 精确判定 protocol；
 *  - `https://user:pass@host/` 会把凭据写进日志/上游、并可用 @ 伪造"看起来的主机"，
 *    主流平台一律拒绝；
 *  - 十进制/八进制/十六进制主机（`http://2130706433`、`http://0177.0.0.1`）会被
 *    glibc getaddrinfo 还原成 127.0.0.1，而字面量黑名单只认点分十进制 → 注册层直接拒；
 *  - 落库统一存 **归一化后的 href**：校验用的解析结果与投递用的字符串严格同源，
 *    避免 URL 解析器差异（tab/换行被 WHATWG 剥离、大小写、默认端口）造成校验绕过。
 */
import { isForbiddenHostLiteral } from "@/core/ssrf";

/** 端点 URL 最大长度（与历史 schema 一致；过长 URL 会撑爆日志与下游 header 预算） */
export const WEBHOOK_URL_MAX_LENGTH = 2000;

/**
 * 是否允许明文 http 端点。默认 false → **HTTPS-only**：webhook payload 含用户
 * 内容/ID，明文出站等于把数据摆在链路上。仅本地开发/内网联调显式设
 * `WEBHOOK_ALLOW_HTTP=1`（此时内网地址仍被字面量黑名单与投递层 ssrfGuard 拦住）。
 */
export function allowInsecureWebhookHttp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WEBHOOK_ALLOW_HTTP === "1";
}

/**
 * 主机是否为「IP 字面量或其编码变体」：点分十进制 / 单段十进制
 * （http://2130706433 → 127.0.0.1）/ 八进制前导 0（http://0177.0.0.1）/
 * 十六进制（http://0x7f.0.0.1）。glibc getaddrinfo 会把这些还原成回环/私网地址，
 * 而字面量黑名单只认规范点分形式 → 注册层直接按"非域名主机"整体拒绝：
 * 合法 webhook 接收端应有域名，字面量 IP 的主要用途是绕过尝试与内网端口探测。
 */
function isEncodedIpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host.includes(":")) return true; // IPv6 字面量（含 [::1]）：走域名之外的路径一律拒
  if (/^\d+$/.test(host)) return true; // 单段纯数字 = 十进制 IPv4
  const parts = host.split(".");
  if (parts.length < 2 || parts.length > 4) return false;
  // 每一段都是数字（含前导 0 的八进制）或 0x 十六进制 → 视为 IP 变体字面量
  return parts.every((p) => /^(?:0[xX][0-9a-fA-F]+|0|\d+)$/.test(p));
}

/** 解析 + 规范化；非法 URL 返回 null。纯字符串入参（不读 process.env，便于单测注入）。 */
export function normalizeWebhookUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > WEBHOOK_URL_MAX_LENGTH) return null;
  return parseHttpUrl(value);
}

/** 实际解析（空串/超长属参数校验，不在此重复判定，故可能返回 null）。 */
function parseHttpUrl(value: string): URL | null {
  // 空白/换行/控制符：即便 WHATWG 解析器会静默剥离，也可能与下游代理的解析产生分歧
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export interface WebhookUrlCheckOptions {
  /** 覆盖 http 放行开关（测试/特殊部署用），默认读环境变量 */
  allowHttp?: boolean;
}

/**
 * 返回归一化后的 https（或显式放行 http）端点 URL；不合法时抛 Error（message 即
 * 面向用户的 bilingual 错误文案，由调用侧 zod refine 转成 400）。
 */
export function assertWebhookUrl(raw: unknown, opts: WebhookUrlCheckOptions = {}): string {
  const url = normalizeWebhookUrl(raw);
  if (!url) throw new Error("URL 格式不正确 / Invalid URL");
  const allowHttp = opts.allowHttp ?? allowInsecureWebhookHttp();
  if (url.protocol === "http:" && !allowHttp) {
    throw new Error("端点必须使用 HTTPS / Endpoint must use HTTPS");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("仅支持 http(s) 端点 / Only http(s) endpoints are supported");
  }
  // 凭据内嵌：既是主机混淆面，也会把密钥写进 URL 落入日志/审计
  if (url.username || url.password) {
    throw new Error("URL 不得包含用户名/密码凭据 / URL must not contain credentials");
  }
  // ":0" 端口必然连接失败，且历史上被用于绕过部分端口白名单
  if (url.port === "0") {
    throw new Error("URL 端口无效 / Invalid port");
  }
  if (isEncodedIpHost(url.hostname)) {
    throw new Error("URL 主机不能是 IP 字面量或其编码形式 / Host must not be an (encoded) IP literal");
  }
  if (isForbiddenHostLiteral(url.hostname)) {
    throw new Error("URL 不允许指向本机或内网地址 / URL must not point to internal hosts");
  }
  return url.href;
}

/** 布尔版（快速判定用）。 */
export function isAcceptedWebhookUrl(raw: unknown, opts: WebhookUrlCheckOptions = {}): boolean {
  return validateWebhookUrl(raw, opts) !== null;
}

/**
 * 非抛错版：合法 → 归一化 href；不合法 → null。
 * 供测试与「只想拿结果不想 catch」的调用方使用；错误文案见 assertWebhookUrl。
 */
export function validateWebhookUrl(raw: unknown, opts: WebhookUrlCheckOptions = {}): string | null {
  try {
    return assertWebhookUrl(raw, opts);
  } catch {
    return null;
  }
}

/**
 * 端点归一化键（重复注册判定用）：host 大小写、默认端口、尾斜杠属同一端点。
 * 注意 hash/query 不同视为不同端点（部分平台按路径分发），故不裁剪。
 */
export function webhookUrlDedupKey(raw: string): string {
  const url = normalizeWebhookUrl(raw);
  if (!url) return String(raw).trim().toLowerCase();
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}${url.search}`.toLowerCase();
}
