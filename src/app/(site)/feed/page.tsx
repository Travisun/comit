import { permanentRedirect } from "next/navigation";
import { routes } from "@/core/routes";

/**
 * /feed is folded into the X-style home timeline (首页 = 时间线).
 * Kept as a permanent redirect so old links and the nav registry stay valid.
 */
export default function FeedPage() {
  permanentRedirect(routes.home);
}
