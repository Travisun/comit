import { sql } from "drizzle-orm";
import { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 用事务级 advisory lock 串行化「先查后写」的配额/唯一性判定。
 *
 * WHY：cluster 模式下有 N 个 worker 共用一个 PG，进程内 Map/锁互不相通；
 * `SELECT count(*)` → 判断 → `INSERT` 这种读校验对并发请求没有隔离性
 * （两个请求同时数到 limit-1，各自插入 → 上限被翻倍）。advisory xact lock
 * 把同一 key 的临界区收敛到数据库：第二个事务在 `pg_advisory_xact_lock`
 * 上排队，直到第一个事务提交/回滚；因为它拿到锁后才执行 count
 * （READ COMMITTED 每条语句取新快照），所以必然看见已提交的插入。
 *
 * 注意：临界区内的所有读写必须走传入的 `tx`，否则写入会在锁释放后提交，
 * 退化成原来的竞态。
 */
export async function withAdvisoryLock<T>(key: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // hashtext 是 32 位：极少数不同 key 会撞同一把锁，那只是多一次互斥，
    // 不会漏锁（保守方向安全）。参数走绑定变量，不拼接 SQL。
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    return run(tx);
  });
}
