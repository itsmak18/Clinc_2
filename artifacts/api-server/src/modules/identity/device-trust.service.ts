// Phase 2 — Device trust dispatcher.
//
// Called from auth.service.loginUser() AFTER the password has been verified
// but BEFORE the session JWT is issued. Returns one of three outcomes:
//
//   { kind: "trusted" }            → caller issues a normal session.
//   { kind: "allow_unverified" }   → caller issues a session with dvu=true
//                                     and sends a new-device email.
//   { kind: "blocked", pending }    → caller refuses to issue a session and
//                                     returns `pending_verification` to the
//                                     client; verification email has been sent.
//
// When the master kill-switch is OFF, every login resolves to "trusted" with
// no DB writes and no emails — byte-identical to Phase 1 behavior.

// dbUnsafe: user_devices and device_verification_tokens have no clinicId column
// and are keyed by userId; device trust runs cross-clinic pre-auth.
import { dbUnsafe as db } from "@workspace/db";
import {
  userDevicesTable,
  usersTable,
  type UserDevice,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import {
  isPhase2Enabled,
  isEmailVerifyEnabled,
} from "../../lib/auth-constants";
import {
  computeFingerprint,
  newDeviceId,
} from "../../lib/device-fingerprint";
import {
  createVerificationToken,
  buildVerificationLink,
} from "./device-verification.service";
import { sendEmail } from "../../services/email.service";

const BLOCKED_ROLES = new Set([
  "super_admin",
  "admin",
  "compliance_officer",
  "doctor",
]);

const TRUST_TTL_DAYS = 90;

export interface DeviceTrustInput {
  userId: number;
  username: string;
  role: string;
  email: string | null;
  userAgent: string | undefined;
  platform: string | undefined;
  clientHints: string | undefined;
  ipAddress: string;
  /** Pre-existing __Host-device_id cookie, if any. */
  deviceIdCookie: string | undefined;
}

export type DeviceTrustOutcome =
  | { kind: "trusted"; deviceId: string }
  | { kind: "allow_unverified"; deviceId: string }
  | { kind: "blocked"; deviceId: string; pendingTokenId: number };

function trustExpiresAt(): Date {
  return new Date(Date.now() + TRUST_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function findDeviceByCookie(
  userId: number,
  deviceId: string,
): Promise<UserDevice | undefined> {
  const [row] = await db
    .select()
    .from(userDevicesTable)
    .where(
      and(
        eq(userDevicesTable.userId, userId),
        eq(userDevicesTable.deviceId, deviceId),
        isNull(userDevicesTable.revokedAt),
      ),
    )
    .limit(1);
  return row;
}

async function findDeviceByFingerprint(
  userId: number,
  fingerprintHash: string,
): Promise<UserDevice | undefined> {
  const [row] = await db
    .select()
    .from(userDevicesTable)
    .where(
      and(
        eq(userDevicesTable.userId, userId),
        eq(userDevicesTable.fingerprintHash, fingerprintHash),
        isNull(userDevicesTable.revokedAt),
      ),
    )
    .limit(1);
  return row;
}

async function userHasAnyDevice(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ d: userDevicesTable.deviceId })
    .from(userDevicesTable)
    .where(eq(userDevicesTable.userId, userId))
    .limit(1);
  return Boolean(row);
}

/** Touch lastSeen + IP and (optionally) extend trust window. */
async function refreshDevice(
  device: UserDevice,
  ip: string,
): Promise<void> {
  await db
    .update(userDevicesTable)
    .set({
      lastSeen: new Date(),
      ipLast: ip,
      trustExpiresAt: device.trusted ? trustExpiresAt() : device.trustExpiresAt,
    })
    .where(
      and(
        eq(userDevicesTable.userId, device.userId),
        eq(userDevicesTable.deviceId, device.deviceId),
      ),
    );
}

async function insertDevice(args: {
  userId: number;
  deviceId: string;
  fingerprintHash: string;
  ip: string;
  trusted: boolean;
  trustSource: string | null;
}): Promise<void> {
  await db.insert(userDevicesTable).values({
    userId: args.userId,
    deviceId: args.deviceId,
    fingerprintHash: args.fingerprintHash,
    ipLast: args.ip,
    trusted: args.trusted,
    trustSource: args.trustSource,
    trustExpiresAt: args.trusted ? trustExpiresAt() : null,
  });
}

export async function evaluateDeviceTrust(
  inp: DeviceTrustInput,
): Promise<DeviceTrustOutcome> {
  // Master kill-switch → behave like Phase 1.
  if (!isPhase2Enabled()) {
    return { kind: "trusted", deviceId: inp.deviceIdCookie ?? newDeviceId() };
  }

  const fingerprintHash = computeFingerprint({
    userId: inp.userId,
    userAgent: inp.userAgent,
    platform: inp.platform,
    clientHints: inp.clientHints,
  });

  // 1. Cookie match wins.
  if (inp.deviceIdCookie) {
    const byCookie = await findDeviceByCookie(inp.userId, inp.deviceIdCookie);
    if (byCookie) {
      await refreshDevice(byCookie, inp.ipAddress);
      return byCookie.trusted
        ? { kind: "trusted", deviceId: byCookie.deviceId }
        : { kind: "allow_unverified", deviceId: byCookie.deviceId };
    }
  }

  // 2. Fingerprint fallback (cookie cleared but same browser).
  const byFp = await findDeviceByFingerprint(inp.userId, fingerprintHash);
  if (byFp) {
    await refreshDevice(byFp, inp.ipAddress);
    return byFp.trusted
      ? { kind: "trusted", deviceId: byFp.deviceId }
      : { kind: "allow_unverified", deviceId: byFp.deviceId };
  }

  // 3. New device path. First-ever login auto-trusts; otherwise dispatch by role.
  const hasAny = await userHasAnyDevice(inp.userId);
  const newId = newDeviceId();

  if (!hasAny) {
    await insertDevice({
      userId: inp.userId,
      deviceId: newId,
      fingerprintHash,
      ip: inp.ipAddress,
      trusted: true,
      trustSource: "first_login",
    });
    return { kind: "trusted", deviceId: newId };
  }

  const isBlockedRole = BLOCKED_ROLES.has(inp.role);

  if (isBlockedRole) {
    // Persist as pending (untrusted) and emit verification email.
    await insertDevice({
      userId: inp.userId,
      deviceId: newId,
      fingerprintHash,
      ip: inp.ipAddress,
      trusted: false,
      trustSource: null,
    });

    let pendingTokenId = -1;
    if (isEmailVerifyEnabled() && inp.email) {
      const { id, rawToken } = await createVerificationToken({
        userId: inp.userId,
        pendingDeviceId: newId,
        fingerprintHash,
      });
      pendingTokenId = id;
      const link = buildVerificationLink(rawToken);
      await sendEmail({
        to: inp.email,
        subject: "Wateen Clinic — verify this device to continue signing in",
        text:
          `Hi ${inp.username},\n\n` +
          `A new device tried to sign in to your Wateen Clinic account from IP ${inp.ipAddress}.\n` +
          `If this was you, click to verify and complete sign-in (link expires in 15 min):\n\n${link}\n\n` +
          `If this was NOT you, ignore this email and notify the compliance officer.`,
        tag: "device_verify",
      });
    }

    return { kind: "blocked", deviceId: newId, pendingTokenId };
  }

  // Non-blocked roles: allow but mark dvu=true and email a kill-switch.
  await insertDevice({
    userId: inp.userId,
    deviceId: newId,
    fingerprintHash,
    ip: inp.ipAddress,
    trusted: false,
    trustSource: null,
  });

  if (isEmailVerifyEnabled() && inp.email) {
    await sendEmail({
      to: inp.email,
      subject: "Wateen Clinic — new device signed in to your account",
      text:
        `Hi ${inp.username},\n\n` +
        `A new device just signed in to Wateen Clinic from IP ${inp.ipAddress}.\n` +
        `If this was you, you don't need to do anything — the device will be trusted automatically in 24 hours.\n\n` +
        `If this was NOT you, click here immediately to revoke the session and lock the account:\n` +
        `${buildVerificationLink("WASNT_ME_PLACEHOLDER")}\n`,
      tag: "device_alert",
    });
  }

  return { kind: "allow_unverified", deviceId: newId };
}

/** Promote a device to trusted on successful email confirmation. */
export async function markDeviceTrusted(
  userId: number,
  deviceId: string,
  source: "email_confirmed" | "admin_approved" | "grandfathered",
): Promise<void> {
  await db
    .update(userDevicesTable)
    .set({
      trusted: true,
      trustSource: source,
      trustExpiresAt: trustExpiresAt(),
      lastSeen: new Date(),
    })
    .where(
      and(
        eq(userDevicesTable.userId, userId),
        eq(userDevicesTable.deviceId, deviceId),
      ),
    );
}

export async function revokeDevice(
  userId: number,
  deviceId: string,
): Promise<void> {
  await db
    .update(userDevicesTable)
    .set({ revokedAt: new Date(), trusted: false })
    .where(
      and(
        eq(userDevicesTable.userId, userId),
        eq(userDevicesTable.deviceId, deviceId),
      ),
    );
}

export async function listDevicesForUser(userId: number): Promise<UserDevice[]> {
  return db
    .select()
    .from(userDevicesTable)
    .where(
      and(
        eq(userDevicesTable.userId, userId),
        isNull(userDevicesTable.revokedAt),
      ),
    );
}

// ─── Route-layer helpers (keep DB out of routes/devices.ts) ──────────────────

/** Fetch a user record for the new-session issuance path after verification. */
export async function findActiveUserForLogin(userId: number) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, userId), isNull(usersTable.deletedAt)))
    .limit(1);
  if (!user || !user.isActive) return null;
  return user;
}

/** Privileged-role lockout after "wasn't me" click. Returns the affected user
 *  shape needed by the caller to decide on compliance alerts. */
export async function lockUserIfPrivileged(userId: number): Promise<{
  role: string;
  email: string | null;
  locked: boolean;
} | null> {
  const [user] = await db
    .select({ role: usersTable.role, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;
  const PRIV = new Set(["super_admin", "admin", "compliance_officer"]);
  const shouldLock = PRIV.has(user.role);
  if (shouldLock) {
    await db
      .update(usersTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }
  return { role: user.role, email: user.email, locked: shouldLock };
}

/** Return active compliance-officer email addresses for fan-out alerts. */
export async function listComplianceOfficerEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.role, "compliance_officer"),
        eq(usersTable.isActive, true),
        isNull(usersTable.deletedAt),
      ),
    );
  return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
}
