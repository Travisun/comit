import { ok, withUser } from "@/lib/http";
import { llmAvailable, llmChat } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 随机灵感池（LLM 不可用时的服务端兜底，与客户端向导池互补） */
const FALLBACK = [
  "新家落成 🎉 从今天起在这里记录代码、生活与一切值得留下的瞬间。",
  "Day 1：注册了我的主页。计划把每天的一点想法都记录在这里。",
  "搬进新主页，正在布置。第一条动态留给今天——一个全新的开始。",
  "你好，世界！我来了，带着一堆没写完的想法和满格的表达欲。",
  "开张啦。以后这里就是我的公开笔记本，欢迎路过围观。",
];

/**
 * POST /api/me/onboarding/suggest — 为「第一条动态」生成开场白。
 * 优先用系统 LLM（平台默认模型）按用户昵称个性化生成；未配置/失败时
 * 回落随机灵感池（保证永远有结果，前端无需分支）。
 */
export async function POST(req: Request) {
  return withUser(req, async (auth) => {
    const pick = () => FALLBACK[Math.floor(Math.random() * FALLBACK.length)];

    if (!(await llmAvailable())) return ok({ content: pick(), source: "pool" });
    try {
      const text = await llmChat({
        messages: [
          {
            role: "system",
            content:
              "你是社区开场白助手。为一位刚加入中文创作社区的用户生成第一条动态文案。" +
              "要求：50 字以内、口语化、真诚不做作、可带一个 emoji，直接输出文案本身（不要引号、不要解释）。",
          },
          {
            role: "user",
            content: `用户昵称：${auth.user.displayName}。生成一条与昵称气质契合的开场动态。`,
          },
        ],
        temperature: 1,
        json: false,
        maxTokens: 120,
      });
      const content = text.trim().slice(0, 200);
      return ok({ content: content || pick(), source: content ? "llm" : "pool" });
    } catch {
      return ok({ content: pick(), source: "pool" });
    }
  });
}
