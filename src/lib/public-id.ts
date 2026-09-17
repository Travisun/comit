import { randomBytes } from "node:crypto";

/**
 * 帖子对外短 ID（public id）— Twitter 式纯数字字符串，但去序列化。
 *
 * 业界对照：
 *  - Twitter/X Snowflake：64 位（时间+机器+序列）十进制串 —— 可排序但低
 *    位可预测，按 id 递增抓取可行（官方 API 就是这么翻页的）；
 *  - YouTube：11 位 base64 全随机 —— 不可枚举但无任何时间信息。
 *
 * 本实现取两者折中：**62 位 CSPRNG 随机整数的十进制字符串（17~19 位）**。
 *  - 顺序抓取不可行：相邻 id 与真实相邻帖子无关，逐位递增命中率 ~1/10^18；
 *  - 无业务信息泄露：不含时间戳/机器号/计数器；
 *  - 碰撞概率：10^7 篇帖子时约 10^14 / 2^63 ≈ 可忽略，且有唯一索引兜底；
 *  - 纯数字形态与 Twitter 观感一致，URL 简短可复制。
 *
 * 内部主键仍为 uuid（不对外暴露）；本 id 仅用于 permalink 与对外引用。
 */
export const PUBLIC_ID_MAX = 20;

export function isPublicIdShape(value: string): boolean {
  return /^\d{10,20}$/.test(value);
}

export function newPublicId(): string {
  // 64 位随机 → 截到 62 位（掩掉最高 2 位，保持 < 2^62，URL 数字串 ≤ 19 位）
  const buf = randomBytes(8);
  buf[0] &= 0x3f;
  return BigInt(`0x${buf.toString("hex")}`).toString(10);
}
