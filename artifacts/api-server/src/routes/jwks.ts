import { Router } from "express";
import { jwksDocument } from "../lib/jwt-secret";

const router = Router();

// Public endpoint — clients use this to fetch the current public keys for
// verifying JWT signatures. No authentication required (public keys are safe
// to expose by definition). Cached 1 hour; keys only change on key rotation.
router.get("/.well-known/jwks.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600").json(jwksDocument);
});

export default router;
