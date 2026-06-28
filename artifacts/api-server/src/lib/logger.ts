import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.fullName",
      "*.fullNameAr",
      "*.phone",
      "*.email",
      "*.addressLine",
      "*.city",
      "*.region",
      "*.postalCode",
      "*.country",
      "*.vitals",
      "*.notes",
      "*.reason",
      "*.diagnosis",
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
