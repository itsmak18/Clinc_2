/**
 * jwt-secret.test.ts
 *
 * Covers:
 *   - JWKS document structure: correct OKP/Ed25519 metadata, no private key material.
 *   - Sign + verify round-trip: token signed with signingKey verifies against jwksVerify.
 *   - JWT_SECRET export: Uint8Array from SESSION_SECRET (backward compat for device-fingerprint.ts).
 *   - Unknown kid: verification rejects a token signed with an unregistered key.
 *   - [INVARIANT] Key rotation overlap: JWT_PREV_PUBLIC_KEY allows old tokens to verify
 *     while new writes use the current key.
 *
 * vi.resetModules() + dynamic import pattern (same as field-encryption.test.ts) so
 * env vars are read before module initialization.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

// Test key pairs — generated once; deterministic across describe blocks.
const {
  privateKey: PRIV_PEM,
  publicKey:  PUB_PEM,
} = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding:  { type: "spki",  format: "pem" },
}) as { privateKey: string; publicKey: string };

const {
  privateKey: PREV_PRIV_PEM,
  publicKey:  PREV_PUB_PEM,
} = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding:  { type: "spki",  format: "pem" },
}) as { privateKey: string; publicKey: string };

// ── Primary module handle (loaded in beforeAll) ────────────────────────────────
let signingKey:   typeof import("../lib/jwt-secret")["signingKey"];
let jwksVerify:   typeof import("../lib/jwt-secret")["jwksVerify"];
let jwksDocument: typeof import("../lib/jwt-secret")["jwksDocument"];
let CURRENT_KID:  string;
let JWT_SECRET:   Uint8Array;

beforeAll(async () => {
  vi.resetModules();
  process.env.JWT_PRIVATE_KEY      = PRIV_PEM;
  process.env.JWT_PUBLIC_KEY       = PUB_PEM;
  process.env.JWT_KID              = "1";
  process.env.SESSION_SECRET       = "a".repeat(64);
  delete process.env.JWT_PREV_PUBLIC_KEY;
  delete process.env.JWT_PREV_KID;

  const mod = await import("../lib/jwt-secret");
  signingKey   = mod.signingKey;
  jwksVerify   = mod.jwksVerify;
  jwksDocument = mod.jwksDocument;
  CURRENT_KID  = mod.CURRENT_KID;
  JWT_SECRET   = mod.JWT_SECRET;
});

// ────────────────────────────────────────────────────────────────────────────────

describe("jwt-secret — JWKS document structure", () => {
  it("contains exactly one key with correct OKP/Ed25519 metadata", () => {
    expect(jwksDocument.keys).toHaveLength(1);
    const key = jwksDocument.keys[0] as unknown as Record<string, unknown>;
    expect(key.kty).toBe("OKP");
    expect(key.crv).toBe("Ed25519");
    expect(key.kid).toBe("1");
    expect(key.use).toBe("sig");
    expect(key.alg).toBe("EdDSA");
    expect(typeof key.x).toBe("string"); // base64url public key component
  });

  it("[INVARIANT] JWKS must NOT contain private key material (d component)", () => {
    for (const key of jwksDocument.keys as unknown as Record<string, unknown>[]) {
      expect(key.d).toBeUndefined();
    }
  });

  it("CURRENT_KID matches the key's kid field", () => {
    const key = jwksDocument.keys[0] as unknown as Record<string, unknown>;
    expect(CURRENT_KID).toBe(key.kid);
  });
});

describe("jwt-secret — JWT sign + verify round-trip", () => {
  it("signs a JWT that verifies against jwksVerify", async () => {
    const token = await new SignJWT({ sub: "test-user", role: "doctor" })
      .setProtectedHeader({ alg: "EdDSA", kid: CURRENT_KID, typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(signingKey);

    const { payload } = await jwtVerify(token, jwksVerify, { algorithms: ["EdDSA"] });
    expect(payload.sub).toBe("test-user");
    expect((payload as { role: string }).role).toBe("doctor");
  });

  it("produces an EdDSA JWT (alg header check)", async () => {
    const token = await new SignJWT({ sub: "t" })
      .setProtectedHeader({ alg: "EdDSA", kid: CURRENT_KID, typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(signingKey);
    const [headerB64] = token.split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
    expect(header.alg).toBe("EdDSA");
    expect(header.kid).toBe(CURRENT_KID);
  });

  it("[INVARIANT] token signed with unknown key is rejected by jwksVerify", async () => {
    const { privateKey: unknownPriv } = generateKeyPairSync("ed25519");
    const rouge = await new SignJWT({ sub: "attacker" })
      .setProtectedHeader({ alg: "EdDSA", kid: "999", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(unknownPriv);
    await expect(
      jwtVerify(rouge, jwksVerify, { algorithms: ["EdDSA"] }),
    ).rejects.toThrow();
  });
});

describe("jwt-secret — HMAC server secret (JWT_SECRET backward compat)", () => {
  it("JWT_SECRET is a Uint8Array (used by device-fingerprint.ts)", () => {
    expect(JWT_SECRET).toBeInstanceOf(Uint8Array);
    expect(JWT_SECRET.length).toBeGreaterThan(0);
  });

  it("JWT_SECRET derives from SESSION_SECRET", () => {
    const expected = new TextEncoder().encode("a".repeat(64));
    expect(JWT_SECRET).toEqual(expected);
  });
});

describe("jwt-secret — key rotation overlap (JWT_PREV_PUBLIC_KEY)", () => {
  it("[INVARIANT] a token signed with the previous key still verifies when JWT_PREV_PUBLIC_KEY is registered", async () => {
    vi.resetModules();
    process.env.JWT_PRIVATE_KEY      = PRIV_PEM;      // current private
    process.env.JWT_PUBLIC_KEY       = PUB_PEM;       // current public  (kid="2")
    process.env.JWT_KID              = "2";
    process.env.JWT_PREV_PUBLIC_KEY  = PREV_PUB_PEM;  // previous public (kid="1")
    process.env.JWT_PREV_KID         = "1";
    process.env.SESSION_SECRET       = "a".repeat(64);

    const mod = await import("../lib/jwt-secret");

    // Sign with the OLD private key + kid="1"
    const prevPrivKey = createPrivateKey(PREV_PRIV_PEM);
    const oldToken = await new SignJWT({ sub: "olduser" })
      .setProtectedHeader({ alg: "EdDSA", kid: "1", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(prevPrivKey);

    // Verify against the new JWKS (which includes both kid="1" prev and kid="2" current)
    const { payload } = await jwtVerify(oldToken, mod.jwksVerify, { algorithms: ["EdDSA"] });
    expect(payload.sub).toBe("olduser");

    // New tokens (kid="2") also verify
    const newToken = await new SignJWT({ sub: "newuser" })
      .setProtectedHeader({ alg: "EdDSA", kid: "2", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(mod.signingKey);
    const { payload: newPayload } = await jwtVerify(newToken, mod.jwksVerify, { algorithms: ["EdDSA"] });
    expect(newPayload.sub).toBe("newuser");
  });
});
