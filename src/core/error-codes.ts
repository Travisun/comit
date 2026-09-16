/**
 * 错误码注册表（A5）— 平台错误码的单一出处。
 * code 同时是 API 错误响应的机器可读标识与 i18n 映射键。
 * AppError 的 code 字段应取自这里（未注册码保持向后兼容不报错）。
 */

export interface ErrorSpec {
  /** 默认中文文案（AppError message 缺省值） */
  message: string;
  /** HTTP 状态码 */
  status: number;
}

export const ERROR_CODES = {
  bad_request: { message: "请求无效 / Bad request", status: 400 },
  bad_json: { message: "请求体不是合法 JSON / Invalid JSON body", status: 400 },
  validation_error: { message: "字段校验未通过 / Validation failed", status: 422 },
  unauthorized: { message: "请先登录 / Sign in required", status: 401 },
  bad_credentials: { message: "邮箱或密码错误 / Invalid credentials", status: 401 },
  forbidden: { message: "没有权限 / Forbidden", status: 403 },
  not_found: { message: "资源不存在 / Not found", status: 404 },
  conflict: { message: "冲突 / Conflict", status: 409 },
  too_large: { message: "超出大小限制 / Too large", status: 413 },
  rate_limited: { message: "操作过于频繁 / Too many requests", status: 429 },
  extension_rejected: { message: "操作被扩展拦截 / Rejected by extension", status: 422 },
  moderation_blocked: { message: "内容包含被禁止的内容 / Blocked by moderation", status: 422 },
  internal: { message: "服务器内部错误 / Internal error", status: 500 },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** 供管理端/文档枚举全部错误码。 */
export function listErrorCodes(): (ErrorSpec & { code: ErrorCode })[] {
  return Object.entries(ERROR_CODES).map(([code, spec]) => ({ code: code as ErrorCode, ...spec }));
}
