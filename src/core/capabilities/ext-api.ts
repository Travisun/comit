/**
 * 扩展 API 路由 — Next 的 API 路由是文件制的，扩展的接口统一挂在
 * `/api/ext/<extensionId>/...` 命名空间下，经此注册表 + catch-all 路由
 * (`src/app/api/ext/[...slug]/route.ts`) 分发。鉴权复用 `withApi`/`withUser`。
 */
export type ExtHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ExtApiRouteDef {
  method: ExtHttpMethod;
  /** 挂载在 /api/ext/<extensionId>/ 下的相对路径，如 "current" */
  path: string;
  /** user ⇒ 强制登录（withUser）；缺省 public（withApi，仅同源校验） */
  auth?: "public" | "user";
  handler: (
    req: Request,
    ctx: { user: { id: string; role: string } | null },
  ) => Promise<Response> | Response;
}

const g = globalThis as unknown as { __mbExtApiRoutes?: Map<string, ExtApiRouteDef> };
const routes: Map<string, ExtApiRouteDef> = (g.__mbExtApiRoutes ??= new Map());

function key(extensionId: string, def: Pick<ExtApiRouteDef, "method" | "path">): string {
  return `${def.method} ${extensionId}/${def.path.replace(/^\/+/, "")}`;
}

export function registerExtApiRoute(extensionId: string, def: ExtApiRouteDef): void {
  routes.set(key(extensionId, def), def);
}

export function matchExtApiRoute(
  method: string,
  segments: string[],
): ExtApiRouteDef | null {
  return routes.get(`${method} ${segments.join("/")}`) ?? null;
}
