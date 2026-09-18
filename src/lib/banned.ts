/**
 * 封禁状态展示约定（纯函数，服务端/客户端共用）。
 *
 * 处罚模型：status = "suspended" + bannedUntil（null ⇒ 永久；未来时间 ⇒ 限时）。
 * 写操作面（发帖/评论/点赞/关注/私信）由会话层统一拦截 —— 封禁即清除全部
 * session 且登录被拒（lib/auth/session.ts、auth/login），到期后下次登录自动解封。
 *
 * 读取面（本模块负责）的「没收」语义：
 *  - 没收昵称：displayName 统一显示「已封禁用户」
 *  - 没收头像：avatarPath 置空（回落首字母/图标 fallback）
 *  - 主页标注：/u/[username] 渲染封禁横幅替代正常内容
 */

export const BANNED_DISPLAY_NAME = "已封禁用户";

export interface BanLikeUser {
  username?: string;
  displayName: string;
  avatarPath: string | null;
  status: string;
  bannedUntil: Date | string | null;
}

/** 是否处于有效封禁中（限时封禁已到期 ⇒ 视为待解封，不算封禁中）。 */
export function isBanned(user: { status: string; bannedUntil: Date | string | null }): boolean {
  if (user.status !== "suspended") return false;
  if (!user.bannedUntil) return true; // 永久
  return new Date(user.bannedUntil).getTime() > Date.now();
}

/** 没收展示：封禁中的用户隐藏头像、昵称替换为统一文案；其余原样返回。 */
export function confiscateBannedUser<T extends BanLikeUser>(user: T): T {
  if (!isBanned(user)) return user;
  return { ...user, displayName: BANNED_DISPLAY_NAME, avatarPath: null };
}

/** 封禁剩余描述（通知/横幅用）：「永久封禁」/「封禁至 2026-10-01」。 */
export function banScopeLabel(bannedUntil: Date | string | null): string {
  if (!bannedUntil) return "永久封禁";
  const d = new Date(bannedUntil);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `封禁至 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
