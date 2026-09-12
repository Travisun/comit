import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware:
 *  1. Subdomain → user-space rewrite: `alice.example.com/posts/slug`
 *     ⇒ `/u/alice/posts/slug` (only when host is a subdomain of ROOT_DOMAIN
 *     and not www/apex/reserved). The app itself reads DB settings per request,
 *     so if the admin disables subdomains the root app simply ignores the
 *     rewritten path shape — rewrites stay harmless.
 *  2. Security headers.
 */
const RESERVED = new Set(["www", "app", "api", "admin", "mail", "smtp", "ftp", "ns1", "ns2"]);

export function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const rootDomain = (process.env.ROOT_DOMAIN ?? "localhost").toLowerCase();
  const url = req.nextUrl;

  let subdomain: string | null = null;
  if (host !== rootDomain && host.endsWith(`.${rootDomain}`)) {
    const candidate = host.slice(0, -1 * (rootDomain.length + 1));
    if (candidate && !candidate.includes(".") && !RESERVED.has(candidate) && candidate !== "www") {
      subdomain = candidate;
    }
  }

  let res: NextResponse;
  if (subdomain) {
    // serve user space from the subdomain; keep the path as-is
    const rewriteUrl = url.clone();
    rewriteUrl.pathname = `/sub/${subdomain}${url.pathname === "/" ? "" : url.pathname}`;
    res = NextResponse.rewrite(rewriteUrl);
  } else {
    res = NextResponse.next();
  }

  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/oauth|api/mcp).*)"],
};
