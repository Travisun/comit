import { matchExtApiRoute, type ExtHttpMethod } from "@/core/capabilities/ext-api";
import { notFound } from "@/core/errors";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/net/real-ip";
import { withApi, withUser, withAdmin } from "@/lib/http";

/**
 * /api/ext/[...slug] — 扩展 API 命名空间的统一入口。
 * 路由由扩展经 `registerExtApiRoute` 注册（/api/ext/<extensionId>/<path>），
 * auth: "user" 的路由套 withUser（登录 + 同源校验），其余 withApi。
 */

type Ctx = { params: Promise<{ slug?: string[] }> };

async function dispatch(req: Request, ctx: Ctx): Promise<Response> {
  const { slug } = await ctx.params;
  const def = matchExtApiRoute(req.method as ExtHttpMethod, slug ?? []);
  if (!def) throw notFound();

  // 扩展 API 统一限流：每 IP 60 次/分钟（第三方代码的性能边界不由平台假设）
  await rateLimit(`ext.api.${slug?.join(".") ?? "root"}:${clientIp(req)}`, 60, 60_000);

  const run = (user: { id: string; role: string } | null) =>
    def.handler(req, { user });

  if (def.auth === "admin") {
    return withAdmin(req, async (auth) => run({ id: auth.user.id, role: auth.user.role }));
  }
  if (def.auth === "user") {
    return withUser(req, async (auth) => run({ id: auth.user.id, role: auth.user.role }));
  }
  return withApi(req, async () => run(null));
}

export async function GET(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function POST(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function PUT(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function PATCH(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
