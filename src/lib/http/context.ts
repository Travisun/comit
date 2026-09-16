/**
 * Request 上下文消费端 API（平台化能力 1）。
 *
 * 存储与类型归 core/logger（ALS 单一实现，日志 emit 自动携带 requestId）；本模块
 * 是 lib 侧的稳定入口：
 *  - 守卫层（lib/http、lib/permissions、actions.runAction）用 requestContextFromRequest
 *    在入口建立上下文，鉴权后 setRequestUser 回填 userId；
 *  - 深层代码（模型层/审计/事件监听器）用 requestContext() 读取标准化请求信息。
 *
 * requestContext() 在无上下文时返回 null 而非 throw —— SSE 流延续、worker、
 * 未走守卫的路径安全降级，调用方按可空处理（TypeScript 层强制判空）。
 */
import { randomUUID } from "node:crypto";
import { currentRequestContext, type RequestContext } from "@/core/logger";
import { clientIp } from "@/lib/net/real-ip";

export type { RequestContext };

/** 当前请求上下文；无 ALS 上下文时返回 null（不 throw）。 */
export function requestContext(): RequestContext | null {
  return currentRequestContext() ?? null;
}

/**
 * 守卫层入口用：从 Request 构建 ctx —— requestId 新生成，ip/path/method 取自请求。
 * userId 此刻未知，由守卫鉴权成功后经 setRequestUser 回填。
 */
export function requestContextFromRequest(req: Request): RequestContext {
  return {
    requestId: randomUUID(),
    ip: clientIp(req),
    path: new URL(req.url).pathname,
    method: req.method,
  };
}
