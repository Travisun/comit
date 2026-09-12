import { z } from "zod";
import { ok } from "@/lib/http";
import { withPermission } from "@/lib/permissions";
import { listRequests } from "@/lib/verification.server";
import { parseOrThrow, pagination } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.enum(["pending", "approved", "rejected"]).optional();

/**
 * GET /api/admin/verification?status=pending|approved|rejected&q=&limit=&offset=
 * → { items: AdminVerificationRequestView[], total }
 */
export async function GET(req: Request): Promise<Response> {
  return withPermission(req, "admin.verification", async () => {
    const url = new URL(req.url);
    const status = parseOrThrow(statusSchema, url.searchParams.get("status") ?? undefined);
    const q = url.searchParams.get("q") ?? undefined;
    const { limit, offset } = pagination(url);
    const { items, total } = await listRequests({ status, q, limit, offset });
    return ok({ items, total });
  });
}
