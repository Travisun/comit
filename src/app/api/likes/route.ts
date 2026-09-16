import { runAction } from "@/core/capabilities/actions";
import { toggleLike } from "@/lib/actions/likes";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return runAction(req, toggleLike);
}
