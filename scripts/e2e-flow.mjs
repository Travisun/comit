/* eslint-disable no-console */
/**
 * Full-flow E2E smoke test against a running server.
 * Usage: node scripts/e2e-flow.mjs [baseUrl]
 */
const B = process.argv[2] ?? "http://localhost:3001";
const ORIGIN = B;
let cookie = "";

async function api(method, path, body, isForm, extraHeaders = {}) {
  const headers = { Origin: ORIGIN, ...extraHeaders };
  if (cookie) headers.Cookie = cookie;
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(`${B}${path}`, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const sc of setCookie) {
    const kv = sc.split(";")[0];
    if (kv.startsWith("mb_")) cookie = cookie ? `${cookie}; ${kv}` : kv;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, location: res.headers.get("location") };
}

function assert(cond, label, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  << ${extra}`}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  // 0. public pages
  const home = await api("GET", "/");
  assert(home.status === 200, "home 200");
  assert(home.text.includes("comit.sh"), "home brand text");
  assert(home.text.includes("社区") || home.text.includes("Commit"), "home hero text");
  const rss = await api("GET", "/feed.xml");
  assert(rss.status === 200 && rss.text.includes("<rss"), "global RSS");
  const atom = await api("GET", "/feed.xml?type=atom");
  assert(atom.status === 200 && atom.text.includes("feed xmlns"), "atom feed");
  const prof = await api("GET", "/u/alice");
  assert(prof.status === 200 && prof.text.includes("Alice Chen"), "profile page");
  const post = await api("GET", "/u/alice/posts/figma");
  assert(post.status === 200, "article page 200");
  assert(post.text.includes("katex") || post.text.includes("mermaid") || post.text.includes("shiki") || post.text.includes("article-prose"), "article rendered markup");
  const sitemap = await api("GET", "/sitemap.xml");
  assert(sitemap.status === 200 && sitemap.text.includes("/u/alice"), "sitemap includes users");
  const robots = await api("GET", "/robots.txt");
  assert(robots.status === 200 && robots.text.includes("Sitemap"), "robots");

  // 1. login (seeded, verified) → forced 2FA setup
  cookie = "";
  (await import("node:child_process")).execSync(
    'docker exec myblogs-postgres psql -U blog -d myblogs -c "delete from totp_secrets"',
    { stdio: "ignore" },
  );
  const login = await api("POST", "/api/auth/login", { email: "alice@myblogs.local", password: "Admin123456" });
  assert(login.status === 200 && login.json?.status === "2fa_setup", "login → 2fa_setup", JSON.stringify(login.json));

  const setup = await api("POST", "/api/auth/2fa/setup");
  assert(setup.status === 200 && setup.json?.secret && setup.json?.qrDataUrl?.startsWith("data:image"), "2fa setup returns secret+QR");
  const { secret } = setup.json;

  const { TOTP, NobleCryptoPlugin, ScureBase32Plugin } = await import("otplib");
  const totp = new TOTP({ secret, crypto: new NobleCryptoPlugin(), base32: new ScureBase32Plugin() });
  const code = await totp.generate();

  const confirm = await api("POST", "/api/auth/2fa/confirm", { code });
  assert(confirm.status === 200 && Array.isArray(confirm.json?.recoveryCodes) && confirm.json.recoveryCodes.length === 8, "2fa confirm → 8 recovery codes");

  const me = await api("GET", "/api/me/profile");
  assert(me.status === 200 && me.json?.username === "alice", "authenticated /api/me/profile");

  // 2. publish article via API (reviewMode default = off → auto publish)
  const create = await api("POST", "/api/posts", {
    type: "article",
    title: `E2E 测试文章 ${Date.now()}`,
    content: "# Hello\n\n这是一篇 **E2E** 测试文章。\n\n$$E=mc^2$$\n\n```ts\nconst x: number = 42;\n```\n",
    topicNames: ["测试"],
    action: "submit",
  });
  assert(create.status === 200 && create.json?.id, "create+submit article", create.text.slice(0, 200));
  const postId = create.json?.id;
  let pubStatus = create.json?.status;
  for (let i = 0; i < 8; i++) {
    if (pubStatus === "published") break;
    await new Promise((r) => setTimeout(r, 500));
    const detail = await api("GET", `/api/posts/${postId}`);
    pubStatus = detail.json?.status;
  }
  assert(pubStatus === "published", "reviewMode=off → auto published", pubStatus);

  // 3. keyword pre-check blocks bad content
  const bad = await api("POST", "/api/posts", {
    type: "article",
    title: "bad",
    content: "这里包含 spam-link-01 应被拦截",
    action: "submit",
  });
  assert(bad.status === 422 && Array.isArray(bad.json?.blocked) && bad.json.blocked.length > 0, "keyword block → 422", bad.text.slice(0, 160));

  // 4. social: like + comment + follow
  const like = await api("POST", "/api/likes", { targetType: "post", targetId: postId });
  assert(like.status === 200 && like.json?.liked === true, "like post", like.text.slice(0, 120));
  const cm = await api("POST", "/api/comments", { postId, body: "E2E 评论 👋" });
  assert(cm.status === 200 && cm.json?.id, "create comment", cm.text.slice(0, 140));
  const cmlist = await api("GET", `/api/comments?postId=${postId}&limit=5`);
  assert(cmlist.status === 200 && cmlist.json?.items?.length >= 1, "comment list");

  // 5. repost
  const repost = await api("POST", "/api/reposts", { postId });
  assert(repost.status === 200 && repost.json?.reposted === true, "repost", repost.text.slice(0, 120));

  // 6. notifications list
  const notif = await api("GET", "/api/notifications?limit=5");
  assert(notif.status === 200, "notifications list");

  // 7. export
  const exp = await api("POST", "/api/export");
  assert(exp.status === 200 && exp.json?.requestId, "export job queued", exp.text.slice(0, 120));
  let done = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const jobs = await api("GET", "/api/export");
    const job = jobs.json?.jobs?.find((j) => j.id === exp.json.requestId);
    if (job?.status === "done") { done = true; break; }
    if (job?.status === "failed") break;
  }
  assert(done, "export zip built (pg-boss worker)");

  // 8. MCP: create token then call tools/list
  const tok = await api("POST", "/api/me/tokens", { name: "e2e", scopes: ["posts:read", "feed:read", "profile:read"] });
  assert(tok.status === 200 && tok.json?.token?.startsWith("mbt_"), "create api token", tok.text.slice(0, 140));
  const bearer = tok.json.token;
  cookie = ""; // token auth, no session
  const mcpList = await api("POST", "/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list", }, false, { Authorization: `Bearer ${bearer}` });
  assert(mcpList.status === 200 || mcpList.json?.result?.tools, "MCP tools/list", mcpList.text.slice(0, 160));
  const mcpCall = await api("POST", "/api/mcp", {
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: { name: "search_posts", arguments: { query: "E2E" } },
  }, false, { Authorization: `Bearer ${bearer}` });
  assert(mcpCall.status === 200 && JSON.stringify(mcpCall.json).includes("E2E"), "MCP search finds new post", mcpCall.text.slice(0, 200));

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
