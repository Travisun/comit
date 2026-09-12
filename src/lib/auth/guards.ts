import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { authTokens } from "@/db/schema";
import { getAuth, type AuthContext } from "./session";
import { randomToken, sha256 } from "./password";
import { routes } from "@/core/routes";

/** Page guard: fully signed-in user (2FA passed), else redirect to login. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect(routes.login);
  if (auth.pending2fa) redirect(routes.twofaChallenge);
  if (!auth.user.emailVerifiedAt) redirect(routes.verifyEmail);
  return auth;
}

export async function requireAdmin(): Promise<AuthContext> {
  const auth = await requireUser();
  if (auth.user.role !== "admin") redirect("/");
  return auth;
}

/** API guard variant: returns null instead of redirecting. */
export async function apiUser(): Promise<AuthContext | null> {
  const auth = await getAuth();
  if (!auth || auth.pending2fa || !auth.user.emailVerifiedAt) return null;
  return auth;
}

/* --------------------------- email / reset tokens ----------------------- */

export async function issueAuthToken(
  userId: string,
  type: "email_verify" | "password_reset",
  ttlMinutes = 60 * 24,
): Promise<string> {
  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId,
    type,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  });
  return token;
}

export async function consumeAuthToken(
  token: string,
  type: "email_verify" | "password_reset",
): Promise<string | null> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.type, type),
        isNull(authTokens.usedAt),
      ),
    )
    .returning({ userId: authTokens.userId, expiresAt: authTokens.expiresAt });
  if (!row || row.expiresAt < new Date()) return null;
  return row.userId;
}
