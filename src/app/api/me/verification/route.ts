import { z } from "zod";
import { ok, withUser } from "@/lib/http";
import { VERIFICATION_TYPES, createVerificationRequestSchema } from "@/lib/verification";
import {
  createVerificationRequest,
  getUserVerification,
  listMyRequests,
  withdrawRequest,
} from "@/lib/verification.server";
import { parseOrThrow } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/verification — my badge state + application history.
 * → { verified, activeRequest, types, myRequests }
 */
export async function GET(req: Request): Promise<Response> {
  return withUser(req, async ({ user }) => {
    const [verified, myRequests] = await Promise.all([
      getUserVerification(user.id),
      listMyRequests(user.id, 5),
    ]);
    // latest pending while one exists; otherwise the most recent request so
    // the panel can render the rejection card
    const activeRequest =
      myRequests.find((r) => r.status === "pending") ?? myRequests[0] ?? null;
    return ok({ verified, activeRequest, types: VERIFICATION_TYPES, myRequests });
  });
}

/**
 * POST /api/me/verification — submit an application.
 * body: { type, label(2..80), description(10..500), attachments(1..3 own media paths) }
 */
export async function POST(req: Request): Promise<Response> {
  return withUser(req, async ({ user }) => {
    const body = parseOrThrow(createVerificationRequestSchema, await req.json().catch(() => ({})));
    const request = await createVerificationRequest(user.id, body);
    return ok({ request });
  });
}

/** DELETE /api/me/verification?id=… — withdraw my own pending request. */
export async function DELETE(req: Request): Promise<Response> {
  return withUser(req, async ({ user }) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    parseOrThrow(z.object({ id: z.string().uuid() }), { id });
    await withdrawRequest(user.id, id);
    return ok({ ok: true });
  });
}
