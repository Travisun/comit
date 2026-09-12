import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { forbidden } from "@/core/errors";
import { ok, withApi, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { getSetting } from "@/lib/settings";
import { isValidSubdomain } from "@/lib/users";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const SUBDOMAIN_YEARLY_LIMIT = 3;

/** Changes consumed in the current calendar year (single audit timestamp). */
function changesThisYear(subdomainUpdatedAt: Date | null): number {
  if (!subdomainUpdatedAt) return 0;
  const now = new Date();
  return subdomainUpdatedAt.getFullYear() === now.getFullYear() ? 1 : 0;
}

/** GET /api/me/subdomain — current subdomain + policy flags. */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "请先登录 / Sign in required" }, { status: 401 });
    return ok({
      subdomain: user.subdomain,
      locked: await getSetting("site.subdomainLocked"),
      changesThisYear: changesThisYear(user.subdomainUpdatedAt),
      yearlyLimit: SUBDOMAIN_YEARLY_LIMIT,
      enabled: await getSetting("site.subdomains"),
    });
  });
}

const putSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .max(63)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "仅小写字母、数字与连字符 / Invalid subdomain"),
});

/** PUT /api/me/subdomain — claim (or, when unlocked, change) the subdomain. */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const { subdomain } = parseOrThrow(putSchema, await req.json().catch(() => null));

    if (!(await getSetting("site.subdomains"))) {
      throw forbidden("子域名功能未开启 / Subdomains are disabled");
    }
    if (!isValidSubdomain(subdomain)) {
      throw forbidden("该子域名不可用（保留字或格式错误）/ Subdomain unavailable");
    }

    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.subdomain, subdomain), ne(users.id, auth.user.id)))
      .limit(1);
    if (taken) {
      throw forbidden("该子域名已被占用 / Subdomain already taken");
    }

    const locked = await getSetting("site.subdomainLocked");
    if (locked && auth.user.subdomain) {
      throw forbidden("子域名已锁定，不可更改 / Subdomain is locked");
    }
    if (!locked && changesThisYear(auth.user.subdomainUpdatedAt) >= SUBDOMAIN_YEARLY_LIMIT) {
      throw forbidden(`每年最多修改 ${SUBDOMAIN_YEARLY_LIMIT} 次 / Yearly change limit reached`);
    }

    await db
      .update(users)
      .set({ subdomain, subdomainUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));
    return ok({ subdomain });
  });
}
