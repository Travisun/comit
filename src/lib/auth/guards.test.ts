// 被测模块：src/lib/auth/guards.ts 的一次性令牌生命周期判定（签发/原子消费/吊销）。
// 依赖 mock：@/db —— 链式记录器（thenable，兼容 drizzle「builder 即 promise」用法），
// 捕获 set/where/returning 入参；where 片段用 PgDialect.sqlToQuery 渲染成 SQL 文本，
// 以便断言「原子认领」确实落在同一条 UPDATE … WHERE used_at IS NULL RETURNING 上。
// 全程无 DB / Redis。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { consumeAuthToken, issueAuthToken, revokeAuthTokens } from "./guards";
import { sha256 } from "./password";

type Call = {
  method: string;
  set?: Record<string, unknown>;
  values?: Record<string, unknown>;
  where?: SQL;
  returning?: boolean;
};

const calls: Call[] = [];
/** consumeAuthToken 的 UPDATE … RETURNING 结果行（按用例注入） */
let returningRows: Record<string, unknown>[] = [];

vi.mock("@/db", () => {
  const record = (method: string) => {
    const call: Call = { method };
    calls.push(call);
    const self: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
              Promise.resolve(returningRows).then(res, rej);
          }
          if (prop === "set") {
            return (payload: Record<string, unknown>) => {
              call.set = payload;
              return self;
            };
          }
          if (prop === "values") {
            return (payload: Record<string, unknown>) => {
              call.values = payload;
              return self;
            };
          }
          if (prop === "where") {
            return (sql: SQL) => {
              call.where = sql;
              return self;
            };
          }
          if (prop === "returning") {
            return () => {
              call.returning = true;
              return self;
            };
          }
          return self;
        },
      },
    );
    return self;
  };
  return {
    db: {
      update: () => record("update"),
      insert: () => record("insert"),
      select: () => record("select"),
    },
  };
});

const dialect = new PgDialect();

/** 把捕获到的 where 片段渲染为 SQL 文本 + 参数，便于形状断言（文本统一小写归一） */
function renderWhere(call: Call): { sql: string; params: unknown[] } {
  expect(call.where, "该语句应带 WHERE 谓词").toBeTypeOf("object");
  const query = dialect.sqlToQuery(call.where as SQL);
  return { sql: query.sql.replace(/\s+/g, " ").toLowerCase(), params: query.params };
}

beforeEach(() => {
  calls.length = 0;
  returningRows = [];
});

describe("consumeAuthToken · 原子消费（无双花窗口）", () => {
  const token = "tok-" + "a".repeat(40);

  it("消费是一条 UPDATE … WHERE used_at IS NULL RETURNING（不是先查后改）", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    returningRows = [{ userId: "u1", expiresAt }];
    await expect(consumeAuthToken(token, "password_reset")).resolves.toBe("u1");

    expect(calls.map((c) => c.method)).toEqual(["update"]); // 无独立 SELECT ⇒ 不存在 check-then-set 竞态
    const [call] = calls;
    expect(call.returning, "必须靠 RETURNING 判定认领成功").toBe(true);
    expect(call.set?.usedAt).toBeInstanceOf(Date);

    const { sql, params } = renderWhere(call);
    expect(sql).toContain('"used_at" is null'); // 条件认领：并发后到者命中 0 行
    expect(sql).toContain('"token_hash" =');
    expect(params).toContain(sha256(token)); // 只存/比哈希，不存明文
    expect(sql).toContain('"type" =');
  });

  it("type 参与原子谓词 ⇒ 邮件验证令牌不能当找回密码令牌用（跨用途重放被封）", async () => {
    returningRows = [{ userId: "u1", expiresAt: new Date(Date.now() + 60_000) }];
    await consumeAuthToken(token, "email_verify");
    await consumeAuthToken(token, "password_reset");
    const types = calls.map((c) => renderWhere(c).params.filter((p) => typeof p === "string" && p.includes("_")));
    expect(types).toEqual([["email_verify"], ["password_reset"]]);
    // 同一原文令牌、两种用途 ⇒ 两条独立语句，用途值始终在 WHERE 内
    expect(calls.every((c) => renderWhere(c).sql.includes('"type" ='))).toBe(true);
  });

  it("已过期 ⇒ 判无效（且过期行同样被置为已用，不留可复用状态）", async () => {
    returningRows = [{ userId: "u1", expiresAt: new Date(Date.now() - 1) }];
    await expect(consumeAuthToken(token, "email_verify")).resolves.toBeNull();
    expect(calls[0].set?.usedAt).toBeInstanceOf(Date);
  });

  it("命中 0 行（重放/不存在）⇒ null", async () => {
    returningRows = [];
    await expect(consumeAuthToken(token, "email_verify")).resolves.toBeNull();
  });
});

describe("issueAuthToken · 签发即吊销同类旧票", () => {
  it("先 UPDATE 同类未消费行，再 INSERT 新哈希（历史链接不并行有效）", async () => {
    await issueAuthToken("u1", "email_verify", 30);
    expect(calls.map((c) => c.method)).toEqual(["update", "insert"]);
    const [invalidate, created] = calls;
    expect(invalidate.set?.usedAt).toBeInstanceOf(Date);
    const { sql, params } = renderWhere(invalidate);
    expect(sql).toContain('"used_at" is null');
    expect(sql).toContain('"user_id" =');
    expect(params).toContain("u1");
    expect(params).toContain("email_verify");
    expect(created.values?.tokenHash).toMatch(/^[0-9a-f]{64}$/); // 明文不落库
    expect(created.values?.expiresAt).toBeInstanceOf(Date);
  });
});

describe("revokeAuthTokens · 凭据/邮箱变更后的待决令牌吊销", () => {
  it("默认吊销该用户全部未消费令牌（跨类型：含另一用途的残留）", async () => {
    returningRows = [{ id: "t1" }, { id: "t2" }];
    await expect(revokeAuthTokens("u1")).resolves.toBe(2);
    const [call] = calls;
    expect(call.method).toBe("update");
    expect(call.set?.usedAt).toBeInstanceOf(Date);
    const { sql, params } = renderWhere(call);
    expect(sql).toContain('"user_id" =');
    expect(sql).toContain('"used_at" is null');
    expect(sql, "不带类型过滤 = 全类型吊销").not.toContain('"type" in');
    expect(params).toContain("u1");
  });

  it("指定 types 时按用途收窄（只清 password_reset，不动验证链接）", async () => {
    returningRows = [{ id: "t1" }];
    await expect(revokeAuthTokens("u1", ["password_reset"])).resolves.toBe(1);
    const { sql, params } = renderWhere(calls[0]);
    expect(sql).toContain('"type" in');
    expect(params).toContain("password_reset");
    expect(params).not.toContain("email_verify");
  });
});
