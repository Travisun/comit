/**
 * High-concurrency Node.js server: multi-process cluster on top of Next.js.
 *
 * - Master process forks WEB_CONCURRENCY workers (default: min(4, cores-1)).
 * - Each worker runs a full Next.js server (SSR) plus its own pg-boss
 *   workers → queue jobs are processed with competing consumers, scaling
 *   linearly with worker count.
 * - libuv threadpool (UV_THREADPOOL_SIZE) is raised per worker for
 *   fs/crypto heavy paths; sharp manages its own threadpool.
 * - Keep-alive timeouts are tuned above common LB idle timeouts.
 * - SIGTERM triggers graceful drain: stop accepting, finish in-flight
 *   requests, then exit; the master respawns crashed workers.
 */
import cluster from "node:cluster";
import http from "node:http";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const WORKERS = Number(
  process.env.WEB_CONCURRENCY || Math.min(4, Math.max(2, availableParallelism() - 1)),
);
const UV_THREADS = process.env.UV_THREADPOOL_SIZE || "8";

if (cluster.isPrimary) {
  console.log(`[cluster] master pid=${process.pid} forking ${WORKERS} workers (uv threads=${UV_THREADS})`);
  if (WORKERS > 1) {
    // 多进程语义告警（不改变行为）：限流已是 PG 共享计数，多 worker 阈值一致，
    // DB 故障/超时才会短暂退化为进程内计数（阈值按 worker 数暂时放大）；
    // 缓存与 settings 失效仍为进程内存态，多 worker 间不共享。
    console.warn(
      `[cluster] WEB_CONCURRENCY=${WORKERS}: rate limiting is PG-backed (shared across workers; ` +
        `briefly degrades to per-worker in-process memory if the DB is down) — ` +
        `caches and settings invalidation remain per-worker in-process memory`,
    );
  }
  for (let i = 0; i < WORKERS; i++) {
    cluster.fork({ WORKER_ID: String(i + 1), UV_THREADPOOL_SIZE: UV_THREADS });
  }
  cluster.on("exit", (worker, code, signal) => {
    console.error(`[cluster] worker ${worker.process.pid} exited (${code ?? ""}/${signal ?? ""}) — respawning`);
    cluster.fork({ WORKER_ID: String(worker.id % WORKERS + 1), UV_THREADPOOL_SIZE: UV_THREADS });
  });
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[cluster] SIGTERM — draining workers");
    for (const id of Object.keys(cluster.workers)) cluster.workers[id]?.disconnect();
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} else {
  const app = next({ dev: process.env.NODE_ENV !== "production", dir: projectDir });
  await app.prepare();
  const handle = app.getRequestHandler();

  const server = http.createServer((req, res) => {
    // surface keep-alive friendly defaults; Next handles body/routing
    handle(req, res);
  });
  // protect against keep-alive races behind proxies
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;

  server.listen(PORT, HOST, () => {
    console.log(`[cluster] worker ${process.env.WORKER_ID ?? "?"} pid=${process.pid} serving :${PORT}`);
  });

  const shutdown = () => {
    console.log(`[cluster] worker ${process.env.WORKER_ID} draining`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
