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
    return decoded === value ? value : decoded;
  } catch {
    return value;
  }
}
