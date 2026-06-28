/**
 * jwt-secret.ts — EdDSA JWT key registry + server HMAC secret.
 *
 * JWT signing / verification (Ed25519 EdDSA):
 *   Env vars consumed at module init:
 *     JWT_PRIVATE_KEY       — PKCS8 PEM Ed25519 private key.  Required in prod.
 *     JWT_PUBLIC_KEY        — SPKI  PEM Ed25519 public key.   Required in prod.
 *     JWT_PREV_PUBLIC_KEY   — Optional SPKI PEM previous public key. Set during
 *                             key rotation so tokens issued before the rotation
 *                             still verify (overlap window).
 *     JWT_KID               — Key ID for current key pair. Default "1".
 *     JWT_PREV_KID          — Key ID for previous public key. Default "0".
 *
 *   Dev fallback: if JWT_PRIVATE_KEY / JWT_PUBLIC_KEY are unset and
 *   NODE_ENV != "production", an ephemeral Ed25519 key pair is generated. Sessions
 *   are invalidated on restart — set the env vars for stable dev sessions.
 *
 * HMAC server secret (SESSION_SECRET):
 *   SESSION_SECRET is retained as the server HMAC key for device-fingerprint.ts.
 *   It no longer signs JWTs. JWT_SECRET (Uint8Array export) is kept for backward
 *   compatibility with device-fingerprint.ts — do not use it anywhere else.
 *
 * Key generation:
 *   node -e "
 *     const {generateKeyPairSync} = require('node:crypto');
 *     const kp = generateKeyPairSync('ed25519', {
 *       privateKeyEncoding:{type:'pkcs8',format:'pem'},
 *       publicKeyEncoding:{type:'spki',format:'pem'}
 *     });
 *     process.stdout.write(kp.privateKey);
 *     process.stderr.write(kp.publicKey);
 *   " > ./secrets/jwt_private_key 2>./secrets/jwt_public_key
 *   chmod 600 ./secrets/jwt_private_key ./secrets/jwt_public_key
 *
 * Rotation procedure: see docs/SECURITY.md "JWT key rotation" section.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { createLocalJWKSet } from "jose";
import type { JWK } from "jose";
import { logger } from "./logger";

// ─── HMAC server secret (device-fingerprint.ts uses this) ────────────────────

const HMAC_RAW = process.env.SESSION_SECRET;
if (!HMAC_RAW && process.env.NODE_ENV === "production") {
  throw new Error(
    "SESSION_SECRET environment variable is required in production. " +
    "Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}
/**
 * Server HMAC secret — consumed by device-fingerprint.ts for per-user device
 * fingerprint hashes. NOT used for JWT signing (EdDSA keys handle that now).
 */
export const JWT_SECRET = new TextEncoder().encode(
  HMAC_RAW || "clinic-dev-secret-DO-NOT-USE-IN-PROD",
);

// ─── EdDSA key registry ───────────────────────────────────────────────────────

/** Key ID embedded in every JWT header (`kid` claim). */
export const CURRENT_KID: string = process.env.JWT_KID ?? "1";
const PREV_KID: string = process.env.JWT_PREV_KID ?? "0";

type JwksDoc = { keys: JWK[] };

function keyObjectToJwk(keyObj: KeyObject, kid: string): JWK {
  const raw = keyObj.export({ format: "jwk" }) as JWK;
  return { ...raw, kid, use: "sig", alg: "EdDSA" };
}

let _signingKey: KeyObject;
let _jwksDocument: JwksDoc;

const privateKeyPem = process.env.JWT_PRIVATE_KEY;
const publicKeyPem  = process.env.JWT_PUBLIC_KEY;
const prevPubKeyPem = process.env.JWT_PREV_PUBLIC_KEY;

if (privateKeyPem && publicKeyPem) {
  _signingKey = createPrivateKey(privateKeyPem);
  const pubKey = createPublicKey(publicKeyPem);
  const keys: JWK[] = [keyObjectToJwk(pubKey, CURRENT_KID)];
  if (prevPubKeyPem) {
    keys.push(keyObjectToJwk(createPublicKey(prevPubKeyPem), PREV_KID));
  }
  _jwksDocument = { keys };
} else if (process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production. " +
    "See docs/SECURITY.md for key generation instructions.",
  );
} else {
  logger.warn(
    "JWT_PRIVATE_KEY / JWT_PUBLIC_KEY not set — generating ephemeral Ed25519 key pair. " +
    "Sessions will be invalidated on server restart. Set these env vars for stable dev sessions.",
  );
  const { privateKey: ephPriv, publicKey: ephPub } = generateKeyPairSync("ed25519");
  _signingKey = ephPriv;
  _jwksDocument = { keys: [keyObjectToJwk(ephPub, CURRENT_KID)] };
}

/** Ed25519 private KeyObject for JWT signing. */
export const signingKey: KeyObject = _signingKey;

/** JWKS document (public keys only — safe to expose at /.well-known/jwks.json). */
export const jwksDocument: JwksDoc = _jwksDocument;

/** jose GetKeyFunction — pass directly as the `key` parameter to jwtVerify(). */
export const jwksVerify = createLocalJWKSet(_jwksDocument);
