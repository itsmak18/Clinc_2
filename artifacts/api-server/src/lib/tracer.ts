/**
 * OpenTelemetry tracer setup.
 *
 * Call initTracer() once at process start (index.ts) before accepting requests.
 * When OTEL_EXPORTER_OTLP_ENDPOINT is unset the OTel API defaults to a noop
 * provider — zero overhead, no spans exported. The API is available everywhere
 * in the codebase via getTracer() / withSpan() without any conditional checks.
 *
 * Production setup:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io   (or Tempo / Jaeger)
 *   OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<api-key>  (backend-specific)
 *
 * Span attributes follow OpenTelemetry semantic conventions where applicable.
 * PHI must never appear in span names or attributes — use numeric IDs only.
 */

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import {
  trace,
  context,
  SpanStatusCode,
  SpanKind,
  type Tracer,
  type Span,
} from "@opentelemetry/api";
import { logger } from "./logger";

let _initialized = false;

export function initTracer(): void {
  if (_initialized) return;
  _initialized = true;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return; // Noop provider — no SDK registration, zero overhead

  const headers: Record<string, string> = {};
  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "";
  for (const pair of rawHeaders.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }

  const exporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers });
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "medicore-api",
      [ATTR_SERVICE_VERSION]: "0.1.0",
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register();
  logger.info({ endpoint }, "otel_tracer_initialized");
}

export function getTracer(): Tracer {
  return trace.getTracer("medicore-api", "0.1.0");
}

/**
 * Run fn inside a named OTel span. Sets OK/ERROR status automatically.
 * Context propagates to any child spans started within fn.
 *
 * Usage:
 *   const result = await withSpan("patients.list", { "db.operation": "select" }, async (span) => {
 *     const rows = await db.select()...;
 *     span.setAttribute("result.count", rows.length);
 *     return rows;
 *   });
 *
 * PHI rule: span names and attributes MUST NOT contain patient data or PHI.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = getTracer().startSpan(name, { attributes, kind: SpanKind.INTERNAL });
  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Express middleware: start an HTTP server span for the request, attach the
 * active OTel context so downstream spans nest correctly, and end on finish.
 *
 * Span attributes are limited to non-PHI metadata:
 *   http.method, http.target (path only — no query params), http.status_code, app.request_id
 */
export function httpSpanMiddleware(
  req: { method: string; path: string; id?: string },
  res: { on(event: "finish", fn: () => void): void; statusCode: number },
  next: () => void,
): void {
  const span = getTracer().startSpan(`HTTP ${req.method}`, {
    kind: SpanKind.SERVER,
    attributes: {
      "http.method":     req.method,
      "http.target":     req.path,
      "app.request_id":  req.id ?? "",
    },
  });

  res.on("finish", () => {
    span.setAttribute("http.status_code", res.statusCode);
    span.setStatus({
      code: res.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
    span.end();
  });

  context.with(trace.setSpan(context.active(), span), next);
}
