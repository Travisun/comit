#!/usr/bin/env node
/**
 * MyBlogs 负载压测脚本（零依赖，Node 18+ 内置 fetch，建议 Node 24）。
 *
 * 用法:
 *   node scripts/load-test.mjs [baseUrl] [durationSec] [concurrency] [mode] [--show-workers]
 *
 *   baseUrl      默认 http://localhost:3001
 *   durationSec  压测时长（秒），默认 30
 *   concurrency  并发虚拟用户数，默认 20
 *   mode         mixed | read | health，默认 mixed
 *
 * 模式:
 *   mixed  60% GET /            20% GET /feed.xml
 *          10% GET /u/alice     10% GET /u/alice/posts/token
 *   read   100% GET /（首页 RSC 渲染路径）
 *   health 100% GET /api/health（纯进程吞吐，不含 DB/RSC 开销）
 *
 * 其他:
 *   --show-workers  观测模式：每秒 GET /api/health 打印 worker 字段，共 30 次，
 *                   用于验证 cluster 轮转（可另开终端与压测同时运行）。
 *   SIGINT(Ctrl-C)  优雅退出并打印已完成部分的统计。
 *
 * 判定: HTTP 2xx/3xx 记为成功，其余状态码记为失败并按状态码归类；
 *       网络异常（ECONNRESET 等）按错误消息归类。
 *
 * 示例:
 *   node scripts/load-test.mjs http://localhost:3001 10 20 mixed
 *   node scripts/load-test.mjs http://localhost:3001 30 50 read
 *   node scripts/load-test.mjs --show-workers http://localhost:3001
 */

const DEFAULT_BASE = "http://localhost:3001";
const DEFAULT_DURATION = 30;
const DEFAULT_CONCURRENCY = 20;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const pos = argv.filter((a) => !a.startsWith("--"));

const base = (pos[0] ?? DEFAULT_BASE).replace(/\/+$/, "");
const durationSec = Number(pos[1] ?? DEFAULT_DURATION);
const concurrency = Math.max(1, Number(pos[2] ?? DEFAULT_CONCURRENCY));
const mode = pos[3] ?? "mixed";

/* ------------------------------ worker 观测 ------------------------------ */

async function showWorkers() {
  const url = `${base}/api/health`;
  console.log(`--show-workers: 每秒请求 ${url}，观察 worker 轮转（共 30 次，Ctrl-C 退出）`);
  for (let i = 1; i <= 30; i++) {
    const started = performance.now();
    try {
      const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
      const body = (await res.json()) ?? {};
      const ms = (performance.now() - started).toFixed(1);
      console.log(
        `#${String(i).padStart(2, "0")} worker=${body.worker ?? "?"} pid=${body.pid ?? "?"} uptime=${body.uptimeSec ?? "?"}s (${ms}ms)`,
      );
    } catch (err) {
      console.log(`#${String(i).padStart(2, "0")} 请求失败: ${err?.cause?.code ?? err?.message ?? err}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/* -------------------------------- 目标池 --------------------------------- */

const MODES = {
  mixed: [
    ["/", 60],
    ["/feed.xml", 20],
    ["/u/alice", 10],
    ["/u/alice/posts/token", 10],
  ],
  read: [["/", 100]],
  health: [["/api/health", 100]],
};

function buildTargets(spec) {
  // 加权扩展成固定轮转池，避免热循环里做浮点随机
  const pool = [];
  for (const [path, weight] of spec) {
    for (let i = 0; i < weight; i++) pool.push(path);
  }
  return pool;
}

/* --------------------------------- 统计 ---------------------------------- */

const stats = {
  total: 0,
  ok: 0,
  fail: 0,
  latencies: [], // 成功+失败都记录延迟
  statusCounts: new Map(), // 成功的原始状态码 "200" -> n
  failReasons: new Map(), // 失败归类 "HTTP 500 GET /u/alice" / "ECONNRESET" -> n
};

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

function printReport(elapsedMs, { partial = false } = {}) {
  const secs = elapsedMs / 1000;
  const lat = [...stats.latencies].sort((a, b) => a - b);
  const p50 = percentile(lat, 50);
  const p95 = percentile(lat, 95);
  const p99 = percentile(lat, 99);
  const avg = lat.length ? lat.reduce((s, v) => s + v, 0) / lat.length : 0;
  const rps = secs > 0 ? stats.total / secs : 0;
  const okRate = stats.total ? ((stats.ok / stats.total) * 100).toFixed(1) : "0.0";

  const statuses = [...stats.statusCounts.entries()].sort((a, b) => b[1] - a[1]);
  const errors = [...stats.failReasons.entries()].sort((a, b) => b[1] - a[1]);

  console.log("");
  console.log(partial ? "—— 部分统计（SIGINT 提前结束）——" : "—— 压测结果 ——");
  console.log(`目标            ${base}`);
  console.log(`模式            ${mode}（${concurrency} 并发，实际 ${secs.toFixed(1)}s）`);
  console.log(`总请求          ${fmt(stats.total)}`);
  console.log(`成功            ${fmt(stats.ok)}（${okRate}%，HTTP 2xx/3xx）`);
  console.log(`失败            ${fmt(stats.fail)}`);
  console.log(`吞吐            ${rps.toFixed(1)} req/s`);
  console.log(
    `延迟 avg/P50    ${avg.toFixed(1)} / ${p50.toFixed(1)} ms`,
  );
  console.log(`延迟 P95/P99    ${p95.toFixed(1)} / ${p99.toFixed(1)} ms`);
  if (lat.length) console.log(`延迟 min/max    ${lat[0].toFixed(1)} / ${lat[lat.length - 1].toFixed(1)} ms`);
  if (statuses.length) {
    console.log("状态码分布      " + statuses.map(([s, n]) => `${s}: ${fmt(n)}`).join("  "));
  }
  if (errors.length) {
    console.log("失败归类        " + errors.map(([e, n]) => `${e}: ${fmt(n)}`).join("  "));
  }
}

/* -------------------------------- 主流程 --------------------------------- */

async function run() {
  const spec = MODES[mode];
  if (!spec) {
    console.error(`未知模式: ${mode}（可选 mixed | read | health）`);
    process.exit(1);
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    console.error(`非法时长: ${pos[1]}`);
    process.exit(1);
  }

  console.log(`MyBlogs load-test → ${base}`);
  console.log(`mode=${mode} concurrency=${concurrency} duration=${durationSec}s`);
  console.log(`目标池: ${spec.map(([p, w]) => `${p}×${w}%`).join("  ")}`);
  console.log("每 5s 输出一次进度，Ctrl-C 提前结束并打印统计。\n");

  const pool = buildTargets(spec);
  const deadline = Date.now() + durationSec * 1000;
  const startedAt = Date.now();
  let stopping = false;

  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\n收到 SIGINT，正在停止新请求…");
  });

  let nextIdx = 0;
  const nextTarget = () => pool[nextIdx++ % pool.length];

  async function worker() {
    while (!stopping && Date.now() < deadline) {
      const path = nextTarget();
      const t0 = performance.now();
      try {
        const res = await fetch(`${base}${path}`, {
          redirect: "manual",
          headers: { "user-agent": "myblogs-load-test/1.0" },
        });
        // 消费 body 以复用 keep-alive 连接
        await res.arrayBuffer();
        const ms = performance.now() - t0;
        stats.total += 1;
        stats.latencies.push(ms);
        if (res.status >= 200 && res.status < 400) {
          stats.ok += 1;
          bump(stats.statusCounts, String(res.status));
        } else {
          stats.fail += 1;
          bump(stats.failReasons, `HTTP ${res.status} ${path}`);
        }
      } catch (err) {
        const ms = performance.now() - t0;
        stats.total += 1;
        stats.fail += 1;
        stats.latencies.push(ms);
        const reason = err?.cause?.code ?? err?.message ?? "unknown";
        bump(stats.failReasons, `ERR ${reason} ${path}`);
      }
    }
  }

  const progressTimer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const lat = [...stats.latencies].sort((a, b) => a - b);
    const window = elapsed > 0 ? stats.total / elapsed : 0;
    process.stdout.write(
      `[${elapsed.toFixed(0).padStart(3, " ")}s] 请求 ${fmt(stats.total)} · RPS ${window.toFixed(0)} · P50 ${percentile(lat, 50).toFixed(0)}ms · P95 ${percentile(lat, 95).toFixed(0)}ms · 失败 ${fmt(stats.fail)}\n`,
    );
  }, 5000);

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  clearInterval(progressTimer);

  printReport(Date.now() - startedAt, { partial: stopping });

  console.log("");
  console.log("集群 worker 分布：压测期间请求应由多个 worker 轮流响应。");
  console.log(`验证方式：另开终端执行  node scripts/load-test.mjs --show-workers ${base}`);
  console.log("（每秒打印 /api/health 返回的 worker 字段，共 30 次）");
  if (stats.fail > 0) process.exitCode = 2;
}

if (flags.has("--show-workers")) {
  showWorkers().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  run();
}
