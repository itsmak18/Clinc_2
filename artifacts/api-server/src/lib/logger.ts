import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.logLevel,
  redact: {
    // Both the bare key and the "*.key" wildcard are required: pino/fast-redact's
    // "*" matches one path segment above the leaf, so "*.email" only covers a
    // nested field (e.g. user.email) and does NOT match a top-level { email }
    // key. Confirmed empirically 2026-07-01 — a top-level { email: msg.to } log
    // call was leaking in cleartext despite "*.email" being present.
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "password",
      "*.password",
      "passwordHash",
      "*.passwordHash",
      "fullName",
      "*.fullName",
      "fullNameAr",
      "*.fullNameAr",
      "phone",
      "*.phone",
      "email",
      "*.email",
      "addressLine",
      "*.addressLine",
      "city",
      "*.city",
      "region",
      "*.region",
      "postalCode",
      "*.postalCode",
      "country",
      "*.country",
      "vitals",
      "*.vitals",
      "notes",
      "*.notes",
      "reason",
      "*.reason",
      "diagnosis",
      "*.diagnosis",
      "symptoms",
      "*.symptoms",
    ],
    censor: "[REDACTED]",
  },
  ...(config.isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
