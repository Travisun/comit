import { TOTP, generateSecret, generateURI, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
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

const scrypt = promisify(_scrypt) as (
  secret: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Create (or reset) a pending TOTP setup; returns secret + otpauth URI.
 *
 * 重要：setup 页面每次挂载都会调用本函数 —— 若每次都重置密钥，用户手机里
 * 已扫描的旧二维码会立即失效，造成「两步验证码不对」的死循环。因此：
 *  - 存在未确认（confirmedAt 为空）的 pending 密钥 ⇒ 原样复用，URI 按当前
 *    邮箱重拼（换邮箱后标签保持最新）；
 *  - 仅在「首次注册」或「重新启用已确认的 2FA」时才生成新密钥。
 */
export async function createTotpSetup(
  user: { id: string; email: string },
  opts: { force?: boolean } = {},
) {
  const [existing] = await db
    .select({ secret: totpSecrets.secret, confirmedAt: totpSecrets.confirmedAt })
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, user.id))
    .limit(1);

  if (existing && !existing.confirmedAt && existing.secret && !opts.force) {
    const uri = await generateURI({
      ...otpOptions(),
      secret: existing.secret,
      issuer: config.app.name,
      label: user.email,
    });
    return { secret: existing.secret, uri };
  }

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
      // 重新启用：新密钥必须连带清掉旧密钥的防重放步进，否则旧 lastUsedStep
      // 可能高于新密钥的时间步，验证会被防重放检查永久拒绝
      set: { secret, confirmedAt: null, recoveryCodes: [], lastUsedStep: null },
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
  const result = await t.verify(token.trim(), { epochTolerance: 60 });
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
    const hashed = await hashRecoveryCodes(codes);
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
  const hashed = await hashRecoveryCodes(codes);
  await db.update(totpSecrets).set({ recoveryCodes: hashed }).where(eq(totpSecrets.userId, userId));
  return codes;
}

export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  // scrypt 带盐 ⇒ 无法像 sha256 那样先算 hash 再交给 SQL 匹配，只能取出候选
  // 逐条验证。命中后仍走与旧实现同款的单条原子 UPDATE 完成消费：
  //   WHERE recovery_codes @> to_jsonb($stored) ⇒ jsonb 包含检查（该 hash 仍在）
  //   SET  recovery_codes - $stored             ⇒ jsonb `-` 移除匹配元素
  // 行锁 + WHERE 保证并发双花时后到者 UPDATE 命中 0 行 ⇒ 按无效恢复码拒绝。
  const [row] = await db
    .select({ recoveryCodes: totpSecrets.recoveryCodes })
    .from(totpSecrets)
    .where(eq(totpSecrets.userId, userId))
    .limit(1);
  if (!row || row.recoveryCodes.length === 0) return false;

  for (const stored of row.recoveryCodes) {
    if (!(await verifyRecoveryCodeHash(code, stored))) continue;
    const removed = await db
      .update(totpSecrets)
      .set({ recoveryCodes: sql`${totpSecrets.recoveryCodes} - ${stored}::text` })
      .where(
        and(
          eq(totpSecrets.userId, userId),
          sql`${totpSecrets.recoveryCodes} @> to_jsonb(${stored}::text)`,
        ),
      )
      .returning({ userId: totpSecrets.userId });
    if (removed.length > 0) return true;
  }
  return false;
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
    // 128 位熵（16 字节），4×8 hex 分组展示
    const raw = randomBytes(16).toString("hex").toUpperCase();
    return raw.match(/.{8}/g)!.join("-");
  });
}

/* ----------------------- recovery code hashing (v2) -----------------------
 * 存量恢复码是 40 位熵 + 裸 sha256（DB 泄露场景可离线爆破）；v2 升级为
 * 128 位熵 + scrypt 慢哈希。jsonb 数组内两种形态共存：
 *   - v2：`s1$<salthex>$<keyhex>`（带前缀，scrypt，归一化后哈希）
 *   - 存量：裸 64 位 hex（sha256，原始输入 trim 后哈希）
 * 旧码随消费/再生成自然淘汰，无需迁移。
 * ------------------------------------------------------------------------- */

/** 恢复码归一化：剥分隔符 + 统一大写（生成与校验共用同一形状）。 */
function normalizeRecoveryCode(code: string): string {
  return code.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

async function hashRecoveryCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(normalizeRecoveryCode(code), salt, 32);
  return `s1$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyRecoveryCodeHash(code: string, stored: string): Promise<boolean> {
  if (stored.startsWith("s1$")) {
    const [, saltHex, keyHex] = stored.split("$");
    if (!saltHex || !keyHex) return false;
    const key = await scrypt(normalizeRecoveryCode(code), Buffer.from(saltHex, "hex"), 32);
    const expected = Buffer.from(keyHex, "hex");
    return key.length === expected.length && timingSafeEqual(key, expected);
  }
  // 存量码兼容路径：与旧实现逐字节同口径（trim 后 sha256），不做大小写归一
  return stored === sha256(code.trim());
}

async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => hashRecoveryCode(c)));
}
