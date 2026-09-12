import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "crypto";
import { promisify } from "util";

const scrypt = promisify(_scrypt) as (
  pw: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** scrypt password hashing (no native deps): scrypt$N$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$16384$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, , saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function isValidPassword(pw: string): boolean {
  return pw.length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
}
