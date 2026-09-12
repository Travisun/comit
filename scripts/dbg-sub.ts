import "dotenv/config";
import { db } from "@/db";
import { users, settings } from "@/db/schema";
import { eq } from "drizzle-orm";
async function main() {
  const [s] = await db.select().from(settings).where(eq(settings.key, "site.subdomains"));
  console.log("settings row:", s?.value);
  const [u] = await db.select().from(users).where(eq(users.subdomain, "alice"));
  console.log("user:", u?.username, u?.status);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
