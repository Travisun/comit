import { TOTP, generateSecret, generateURI, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { randomBytes } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { totpSecrets } from "@/db/schema";
import { config } from "@/core/config";
import { sha256 } from "./password";

/**
 * TOTP two-factor auth on otplib v13 (async API, noble crypto plugin).
 * Mandatory per product requirement — login is gated until confirmed.
 */
const otpOptions = () => ({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
});

/** Create (or reset) a pending TOTP setup; returns secret + otpauth URI. */
export async function createTotpSetup(user: { id: string; email: string }) {
  const secret = generateSecret();
  const uri = await generateURI({
    ...otpOptions(),
    secret,
    issuer: config.app.name,
    label: user.email,
  });
  await db
    .insert(totpSecrets)
    .values({ userId: user.id, secret, recoveryCodes: [] })
    .onConflictDoUpdate({
      target: totpSecrets.userId,
      set: { secret, confirmedAt: null, recoveryCodes: [] },
    });
  return { secret, uri };
}

export async function verifyTotpCode(
  userId: string,
  token: string,
  opts: { confirm?: boolean } = {},
): Promise<{ ok: boolean; recoveryCodes?: string[] }> {
  const [row] = await db.select().from(totpSecrets).where(eq(totpSecrets.userId, userId)).limit(1);
  if (!row) return { ok: false };
  const t = new TOTP({ ...otpOptions(), secret: row.secret });
  const result = await t.verify(token.trim(), { epochTolerance: 30 });
  if (!result.valid) return { ok: false };
  // 防重放（anti-replay）：timeStep 即命中的 30s 窗口（epochTolerance ±30s ⇒
  // 实际命中 ±1 窗口，取 otplib 返回的实际命中 step）。step <= lastUsedStep ⇒
  // 同一（或更早）窗口的 code 已被使用，复用"无效验证码"错误路径，不区分原因。
  const step = result.timeStep;
  if (row.lastUsedStep !== null && step <= row.lastUsedStep) return { ok: false };
  // 原子认领（atomic claim）：条件 UPDATE 保证 last_used_step 只前进；
  // 更新 0 行 = 并发请求抢先消费了该窗口 ⇒ 同样按无效拒绝。
  // confirm 路径也走这里，故确认 enroll 的 code 同样记录 step、同样不可重放。
  const claimed = await db
    .update(totpSecrets)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(totpSecrets.userId, userId),
        sql`(${totpSecrets.lastUsedStep} IS NULL OR ${totpSecrets.lastUsedStep} < ${step})`,
      ),
    )
    .returning({ userId: totpSecrets.userId });
  if (claimed.length === 0) return { ok: false };
  if (opts.confirm) {
    // confirm 成功激活 2FA；step 已在上面认领时记录
    const codes = generateRecoveryCodes();
    const hashed = await Promise.all(codes.map((c) => sha256(c)));
    await db
      .update(totpSecrets)
      .set({ confirmedAt: new Date(), recoveryCodes: hashed })
      .where(eq(totpSecrets.userId, userId));
    return { ok: true, recoveryCodes: codes };
  }
  return { ok: true };
}

/** Return newly generated recovery codes (plaintext, shown once). */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const hashed = await Promise.all(codes.map((c) => sha256(c)));
  await db.update(totpSecrets).set({ recoveryCodes: hashed }).where(eq(totpSecrets.userId, userId));
  return codes;
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  // 原子消费（atomic consume）：一条 UPDATE 同时完成存在检查 + 移除，替代旧的
  // select→update 两步（非原子，两个并发请求可双花同一恢复码）。
  //   WHERE recovery_codes @> to_jsonb($hash) ⇒ jsonb 包含检查：数组中存在该 hash
  //   SET  recovery_codes - $hash             ⇒ jsonb `-` 移除匹配的字符串元素
  // 行锁 + WHERE 条件保证只有第一个请求命中，后者返回 0 行 ⇒ 按无效恢复码拒绝。
  const hash = sha256(code.trim());
  const removed = await db
    .update(totpSecrets)
    .set({ recoveryCodes: sql`${totpSecrets.recoveryCodes} - ${hash}::text` })
    .where(
      and(
        eq(totpSecrets.userId, userId),
        sql`${totpSecrets.recoveryCodes} @> to_jsonb(${hash}::text)`,
      ),
    )
    .returning({ userId: totpSecrets.userId });
  return removed.length > 0;
}

export async function hasConfirmedTotp(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ confirmedAt: totpSecrets.confirmedAt })
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, userId))
    .limit(1);
  return Boolean(row?.confirmedAt);
}

export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
