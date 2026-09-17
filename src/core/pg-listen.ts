/**
 * pg-listen — 专用 Postgres LISTEN/NOTIFY 客户端（跨进程事件扇出的传输层）。
 *
 * 为什么不用 db/index.ts 的连接池：LISTEN 是会话级状态，池连接会被复用/回收
 * 导致订阅悄悄丢失，因此这里维护独立的 `pg.Client`（每进程恰好一条），
 * 完全不占用池连接。NOTIFY 也走同一条连接（会话内发即可，无需池）。
 *
 * 生命周期：
 * - 懒启动：首次 `ensurePgListener()` / `notifyMbEvent()` 才建连，纯静态渲染
 *   进程（无订阅、无发布）零连接；
 * - 断线自动重连：指数退避（0.5s 起步，上限 30s），重连成功后重新 LISTEN；
 * - 降级：DATABASE_URL 缺失 / 启动失败 / 发送失败仅 console.warn 一次，
 *   调用方（broadcast.ts）回退为进程内广播，本模块绝不 throw。
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";

/** NOTIFY 频道名（与 LISTEN 端一致）。 */
export const MB_NOTIFY_CHANNEL = "mb_events";

interface PgListenerState {
  /** 进程唯一标识：广播帧带上它，监听端据此丢弃自己发出的 NOTIFY 回环。 */
  origin?: string;
  client?: Client;
  /** 进行中的建连 promise（并发调用共享同一次尝试）。 */
  startPromise?: Promise<Client | null>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  /** 重连退避计数，成功后归零。 */
  attempt: number;
  /** 收到 notification 时的分发回调（broadcast.ts 注册，每进程一个）。 */
  onFrame?: (json: string) => void;
  /**
   * 断线重连成功后的补偿回调（broadcast.ts 注册）：重连窗口内 NOTIFY 丢失、
   * 而 SSE TCP 连接仍存活（客户端 onopen 不触发、补偿机制失效），必须由
   * 服务端主动广播 resync，否则未读数/私信无限期 stale。
   */
  onReconnect?: () => void;
}

// globalThis 单例守卫：跟随项目 HMR 模式（dev 下模块可能被多次求值，
// 参考 events.ts 的 bus 缓存注释），保证一个进程只有一条 LISTEN 连接。
const g = globalThis as unknown as { __mbPgListener?: PgListenerState };
const state: PgListenerState = (g.__mbPgListener ??= { attempt: 0 });

/** 已告警过的 key（连接缺失/启动失败/发送失败各至多一次）。 */
const warned = new Set<string>();
function warnOnce(key: string, message: string, err?: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message, err ?? "");
}

/** 进程唯一 origin，跨 HMR/多模块实例保持稳定（挂在 globalThis 上）。 */
export function pgOrigin(): string {
  state.origin ??= randomUUID();
  return state.origin;
}

function backoffMs(attempt: number): number {
  // 0.5s, 1s, 2s, 4s … 封顶 30s
  return Math.min(30_000, 500 * 2 ** attempt);
}

function scheduleReconnect(): void {
  if (state.reconnectTimer) return; // 幂等：error/end 双触发只排一次
  const delay = backoffMs(state.attempt++);
  const timer = setTimeout(() => {
    state.reconnectTimer = undefined;
    void connect();
  }, delay);
  // 重连定时器不阻塞进程退出（graceful shutdown 友好）
  timer.unref?.();
}

/**
 * 建连 + LISTEN。幂等且永不 reject：返回进行中/已就绪的连接，失败返回 null
 * （同时调度后台退避重连，DB 恢复后自动回到跨进程扇出）。
 */
function connect(): Promise<Client | null> {
  if (state.client) return Promise.resolve(state.client);
  if (state.startPromise) return state.startPromise;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // 配置缺失属于永久降级：不重试，系统停留在进程内广播行为
    warnOnce(
      "missing-url",
      "[pg-listen] DATABASE_URL missing — cross-process broadcast disabled (in-process only)",
    );
    return Promise.resolve(null);
  }

  state.startPromise = (async () => {
    const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
    // 单次连接尝试内 error/end 只处理一次（pg 断连时两者都会触发）
    let settled = false;
    const drop = () => {
      if (settled) return;
      settled = true;
      if (state.client === client) state.client = undefined;
      // 释放半开 socket（幂等；失败/已断的连接 end() 报错吞掉即可）。
      // 只清引用会让长期多次断线的进程累积半开 socket。
      void client.end().catch(() => undefined);
      scheduleReconnect();
    };
    client.on("notification", (msg) => {
      const raw = msg.payload;
      const cb = state.onFrame;
      if (!raw || !cb) return;
      try {
        cb(raw);
      } catch (err) {
        console.warn("[pg-listen] frame dispatch threw", err);
      }
    });
    client.on("error", drop);
    client.on("end", drop);
    try {
      await client.connect();
      await client.query(`LISTEN ${MB_NOTIFY_CHANNEL}`);
      state.client = client;
      const isReconnect = state.attempt > 0;
      state.attempt = 0; // 成功后重置退避
      // 告警去重表复位：恢复后再次故障要能重新告警（否则故障期间长期静默）
      warned.delete("notify-failed");
      warned.delete("start-failed");
      console.log(`[pg-listen] connected, listening on "${MB_NOTIFY_CHANNEL}"`);
      if (isReconnect) {
        // 断线窗口内的 NOTIFY 已丢失且客户端无法感知（SSE 仍存活），广播
        // resync 让全部订阅方 invalidate 补数。回调抛错只记日志。
        try {
          state.onReconnect?.();
        } catch (err) {
          console.warn("[pg-listen] onReconnect callback threw", err);
        }
      }
      return client;
    } catch (err) {
      drop();
      // 释放半开 socket；失败的握手连接 end() 可能报错，吞掉即可
      void client.end().catch(() => undefined);
      warnOnce(
        "start-failed",
        "[pg-listen] startup failed — degrading to in-process broadcast (will retry in background)",
        err,
      );
      return null;
    }
  })();

  // startPromise 用完即清：下一次 connect()（含重连定时器触发的）重新发起
  void state.startPromise.finally(() => {
    if (state.startPromise) state.startPromise = undefined;
  });
  return state.startPromise;
}

/**
 * 注册跨进程 notification 分发回调并确保监听器已启动（懒启动入口）。
 * 同进程重复调用只更新回调（HMR 后旧闭包被替换，channels 数组本身
 * 挂在 globalThis 上，不受模块重求值影响）。
 * `onReconnect`：断线重连成功后的补偿回调（可选）。
 */
export function ensurePgListener(
  onFrame: (json: string) => void,
  onReconnect?: () => void,
): void {
  state.onFrame = onFrame;
  if (onReconnect) state.onReconnect = onReconnect;
  if (!state.client && !state.startPromise && !state.reconnectTimer) void connect();
}

/**
 * Fire-and-forget 发布一帧 NOTIFY（payload 已由调用方序列化）。
 * 懒启动：首个 publish 也会触发建连；连接未就绪/重连等待期直接丢弃
 * （进程内分发已完成，跨进程属 best-effort），失败仅 warn 一次。
 */
export function notifyMbEvent(json: string): void {
  void (async () => {
    // 重连退避等待期不强行建连：避免 DB 故障期间每个 publish 都挂起一次连接超时
    const client = state.client ?? (state.reconnectTimer ? null : await connect());
    if (!client) return;
    await client.query("SELECT pg_notify($1, $2)", [MB_NOTIFY_CHANNEL, json]);
  })().catch((err) => {
    warnOnce("notify-failed", "[pg-listen] notify failed — keeping in-process only", err);
  });
}
