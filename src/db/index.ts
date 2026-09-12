import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __mbPool: Pool | undefined;
}

function createPool(): Pool {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // per-process pool; size it so workers × PGPOOL_MAX stays under the
    // server's max_connections (e.g. 4 workers × 10 = 40 < 100 default)
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  pool.on("error", (err) => console.error("[db] pool error:", err));
  return pool;
}

const pool = globalThis.__mbPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__mbPool = pool;

export const db = drizzle(pool, { schema });
export { pool, schema };
export type Db = typeof db;
