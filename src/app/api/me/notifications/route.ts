import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ok, withApi, withUser } from "@/lib/http";
import { getCurrentUser } from "@/lib/auth/session";
import { DEFAULT_CHANNELS } from "@/plugins/notifications";
import { channels } from "@/core/plugins/registry";
import { NOTIFICATION_EVENTS } from "@/components/settings/types";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_KEYS = NOTIFICATION_EVENTS.map((e) => e.key);

/** GET /api/me/notifications — available channels/events + current prefs. */
export async function GET(req: Request) {
  return withApi(req, async () => {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "请先登录 / Sign in required" }, { status: 401 });
    return ok({
      availableChannels: [...channels.values()].map((c) => ({ id: c.id, label: c.label })),
      availableEvents: NOTIFICATION_EVENTS,
      prefs: user.notificationPrefs ?? {},
      defaults: DEFAULT_CHANNELS,
    });
  });
}

const bodySchema = z.object({
  prefs: z.record(z.string(), z.array(z.string())),
});

/** PUT /api/me/notifications — replace the per-event channel preferences. */
export async function PUT(req: Request) {
  return withUser(req, async (auth) => {
    const body = parseOrThrow(bodySchema, await req.json().catch(() => null));

    const validChannels = new Set([...channels.keys()]);
    const prefs: Record<string, string[]> = {};
    for (const [key, chs] of Object.entries(body.prefs)) {
      if (!EVENT_KEYS.includes(key)) continue;
      prefs[key] = [...new Set(chs)].filter((c) => validChannels.has(c));
    }

    await db
      .update(users)
      .set({ notificationPrefs: prefs, updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));
    return ok({ prefs });
  });
}
