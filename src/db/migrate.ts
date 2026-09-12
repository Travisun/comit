/**
 * Unified database migration entrypoint — applies every SQL migration under
 * /drizzle in order and records the version (drizzle's __drizzle_migrations).
 * Run via `pnpm db:migrate`; the dev server does not auto-migrate.
 */
import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

async function main() {
  console.log("[db] applying migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[db] migrations applied.");
  await pool.end();
}
main().catch((err) => {
  console.error("[db] migration failed:", err);
  process.exit(1);
});
