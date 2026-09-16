import { listActions } from "@/core/capabilities/actions";
import { config } from "@/core/config";

export const runtime = "nodejs";

/**
 * GET /api/openapi.json — 由 Action 目录自动生成的接口文档（A4）。
 * path/method 来自 Action 声明；schema 以 zod 结构描述（文档级，非严格 OpenAPI Schema）。
 */
export async function GET() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const a of listActions()) {
    paths[a.path] = {
      [a.method.toLowerCase()]: {
        operationId: a.name,
        summary: a.name,
        security: a.auth !== "public" ? [{ cookieAuth: [] }] : [],
        responses: { "200": { description: "ok" }, "4XX": { description: "error" } },
      },
    };
  }
  return Response.json({
    openapi: "3.0.0",
    info: {
      title: "comit.sh API",
      version: "1",
      description:
        "当前仅覆盖 Action 目录（defineAction）注册的端点，其余 route handler 未收录。/ " +
        "Only endpoints registered in the Action catalog (defineAction) are listed; " +
        "other route handlers are not included.",
    },
    components: {
      securitySchemes: {
        cookieAuth: { type: "apiKey", in: "cookie", name: config.auth.sessionCookie },
      },
    },
    paths,
  });
}
