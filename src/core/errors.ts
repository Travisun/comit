/** Typed application errors with HTTP status mapping. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code: string = "bad_request",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (msg = "请先登录 / Please sign in") =>
  new AppError(msg, 401, "unauthorized");
export const forbidden = (msg = "没有权限 / Forbidden") =>
  new AppError(msg, 403, "forbidden");
export const notFound = (msg = "资源不存在 / Not found") =>
  new AppError(msg, 404, "not_found");
export const conflict = (msg: string) => new AppError(msg, 409, "conflict");
export const tooMany = (msg = "操作过于频繁 / Too many requests") =>
  new AppError(msg, 429, "rate_limited");

export function toErrorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[api] unhandled error:", err);
  return Response.json(
    { error: "服务器内部错误 / Internal server error", code: "internal" },
    { status: 500 },
  );
}
