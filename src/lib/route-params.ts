/**
 * 动态路由参数安全归一 — 全站 RSC 页面取 params 的唯一入口。
 *
 * 背景：Next App Router 的 params 已由框架解码一次；历史上页面里普遍再
 * 手动 `decodeURIComponent` 一次，当 slug/用户名本身含 `%` 序列
 * （如 `100%-guide`）时二次解码抛 URIError → 整页 500。
 *
 * 语义：仅在「包含 %、解码成功、且解码结果确实不同」时采用解码值 ——
 *  - 普通已解码参数原样返回（绝大多数请求，零开销）；
 *  - 历史上以编码形式入库的 slug 仍能命中（兼容）；
 *  - 非法 % 序列回落原值，交给后续 notFound()，绝不 500。
 */
export function routeParam(value: string): string {
  if (!value.includes("%")) return value;
  try {
    const decoded = decodeURIComponent(value);
    // 只在「解出来更浅且仍是单段」时采用：解码结果再含 % 说明是多层编码
    // （%252f → %2f → /），含 / 或 \ 说明解出了路径分隔符 —— 两者都会让两个
    // 不同 URL 命中同一条记录（缓存/权限判定与真实目标分歧），一律回落原值。
    if (decoded === value || decoded.includes("%") || decoded.includes("/") || decoded.includes("\\")) {
      return value;
    }
    return decoded;
  } catch {
    return value;
  }
}
