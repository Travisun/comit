import { TOTP, generateSecret, generateURI, NobleCryptoPlugin, ScureBase32Plugin } from "otplib";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
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
  if (opts.confirm) {
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

export async function useRecoveryCode(userId: string, code: string): Promise<boolean> {
  const [row] = await db.select().from(totpSecrets).where(eq(totpSecrets.userId, userId)).limit(1);
  if (!row) return false;
  const hash = sha256(code.trim());
  if (!row.recoveryCodes.includes(hash)) return false;
  await db
    .update(totpSecrets)
    .set({ recoveryCodes: row.recoveryCodes.filter((h) => h !== hash) })
    .where(eq(totpSecrets.userId, userId));
  return true;
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
