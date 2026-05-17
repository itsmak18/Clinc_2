import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateSecret, generateURI, verify as verifyOtp } from "otplib";
import { toDataURL } from "qrcode";
import { randomBytes, createHash } from "crypto";
import bcrypt from "bcrypt";
import { NotFoundError, UnauthorizedError, ValidationError } from "./errors";

const APP_NAME = "MediCore";
const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12");

function encryptSecret(secret: string): string {
  const key = createHash("sha256").update(process.env.SESSION_SECRET ?? "dev-secret").digest();
  const buf = Buffer.from(secret, "utf8");
  const enc = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) enc[i] = buf[i] ^ key[i % key.length];
  return enc.toString("base64");
}

function decryptSecret(encrypted: string): string {
  const key = createHash("sha256").update(process.env.SESSION_SECRET ?? "dev-secret").digest();
  const buf = Buffer.from(encrypted, "base64");
  const dec = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) dec[i] = buf[i] ^ key[i % key.length];
  return dec.toString("utf8");
}

function generateRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(5).toString("hex").toUpperCase());
}

export async function enrollMfa(userId: number): Promise<{ qrDataUrl: string; secret: string; recoveryCodes: string[] }> {
  const [user] = await db.select({ username: usersTable.username, mfaEnrolledAt: usersTable.mfaEnrolledAt })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new NotFoundError("user", userId);
  if (user.mfaEnrolledAt) throw new ValidationError("MFA is already enrolled. Disable it first.");

  const secret = generateSecret();
  const otpauthUrl = generateURI({ issuer: APP_NAME, label: user.username, secret });
  const qrDataUrl = await toDataURL(otpauthUrl);

  // Store pending secret (not yet confirmed — confirmed on /mfa/confirm)
  await db.update(usersTable)
    .set({ mfaSecret: encryptSecret(secret), updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  const recoveryCodes = generateRecoveryCodes();
  return { qrDataUrl, secret, recoveryCodes };
}

export async function confirmMfaEnrollment(userId: number, token: string, recoveryCodes: string[]): Promise<void> {
  const [user] = await db.select({ mfaSecret: usersTable.mfaSecret })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.mfaSecret) throw new ValidationError("MFA enrollment not started.");

  const secret = decryptSecret(user.mfaSecret);
  const result = await verifyOtp({ token, secret });
  if (!result.valid) throw new UnauthorizedError("Invalid TOTP code.");

  const hashedCodes = await Promise.all(recoveryCodes.map(c => bcrypt.hash(c, ROUNDS)));
  await db.update(usersTable)
    .set({ mfaEnrolledAt: new Date(), mfaRecoveryCodesHash: hashedCodes, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

export async function verifyMfaToken(userId: number, token: string): Promise<boolean> {
  const [user] = await db.select({ mfaSecret: usersTable.mfaSecret, mfaEnrolledAt: usersTable.mfaEnrolledAt })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.mfaSecret || !user.mfaEnrolledAt) return false;

  const secret = decryptSecret(user.mfaSecret);
  const result = await verifyOtp({ token, secret });
  return result.valid;
}

export async function consumeRecoveryCode(userId: number, code: string): Promise<void> {
  const [user] = await db.select({ mfaRecoveryCodesHash: usersTable.mfaRecoveryCodesHash })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.mfaRecoveryCodesHash?.length) {
    throw new UnauthorizedError("No recovery codes available.");
  }

  const hashes = user.mfaRecoveryCodesHash as string[];
  let matchIdx = -1;
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(code.toUpperCase(), hashes[i])) { matchIdx = i; break; }
  }
  if (matchIdx === -1) throw new UnauthorizedError("Invalid recovery code.");

  const remaining = hashes.filter((_, i) => i !== matchIdx);
  await db.update(usersTable)
    .set({ mfaRecoveryCodesHash: remaining, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

export async function disableMfa(userId: number, actorId: number, actorRole: string): Promise<void> {
  if (userId !== actorId && actorRole !== "super_admin") {
    throw new UnauthorizedError("Only super admins can disable another user's MFA.");
  }
  await db.update(usersTable)
    .set({ mfaSecret: null, mfaEnrolledAt: null, mfaRecoveryCodesHash: null, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
}

export async function isMfaEnrolled(userId: number): Promise<boolean> {
  const [user] = await db.select({ mfaEnrolledAt: usersTable.mfaEnrolledAt })
    .from(usersTable).where(eq(usersTable.id, userId));
  return !!user?.mfaEnrolledAt;
}
