import "dotenv/config";
import { db } from "../src/db";
import { sessions, users } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { sha256 } from "../src/lib/auth/password";
async function main() {
  const token = process.argv[2].split("=")[1];
  const [row] = await db
    .select({ hash: sessions.tokenHash, user: users.username, expires: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  console.log("lookup:", row ? `${row.user} expires ${row.expires}` : "NOT FOUND");
  process.exit(0);
}
main();
