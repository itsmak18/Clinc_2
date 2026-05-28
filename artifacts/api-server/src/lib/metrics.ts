import client from "prom-client";
import { pool } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";

// Create a Registry
const register = new client.Registry();

// Add standard Node.js metrics (memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// Define custom HTTP metrics
export const httpRequestDurationMicroseconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10], // Buckets for P95 latency
});
register.registerMetric(httpRequestDurationMicroseconds);

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
});
register.registerMetric(httpRequestsTotal);

export const auditLogWriteFailuresTotal = new client.Counter({
  name: "audit_log_write_failures_total",
  help: "Audit outbox rows exhausted after max retry attempts — permanent loss",
  labelNames: ["action", "entity_type"],
});
register.registerMetric(auditLogWriteFailuresTotal);

export const auditOutboxDepthGauge = new client.Gauge({
  name: "audit_outbox_depth",
  help: "Number of audit events pending drain from the outbox (sampled at each drain tick)",
});
register.registerMetric(auditOutboxDepthGauge);

// Define custom DB metrics
const dbPoolTotal = new client.Gauge({
  name: "db_pool_total_connections",
  help: "Total connections in the database pool",
});
register.registerMetric(dbPoolTotal);

const dbPoolIdle = new client.Gauge({
  name: "db_pool_idle_connections",
  help: "Idle connections in the database pool",
});
register.registerMetric(dbPoolIdle);

const dbPoolWaiting = new client.Gauge({
  name: "db_pool_waiting_clients",
  help: "Clients waiting for a connection from the database pool",
});
register.registerMetric(dbPoolWaiting);

// Middleware to record HTTP metrics
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime();
  res.on("finish", () => {
    const elapsed = process.hrtime(start);
    const durationSec = elapsed[0] + elapsed[1] / 1e9;
    
    // Normalize route to avoid high cardinality (e.g., /api/users/123 -> /api/users/:id)
    const route = req.route ? req.route.path : req.path;
    
    httpRequestDurationMicroseconds
      .labels(req.method, route, res.statusCode.toString())
      .observe(durationSec);
      
    httpRequestsTotal
      .labels(req.method, route, res.statusCode.toString())
      .inc();
  });
  next();
};

// Endpoint to expose metrics to Prometheus
export const getMetrics = async (req: Request, res: Response) => {
  // Update DB metrics right before scraping
  dbPoolTotal.set(pool.totalCount);
  dbPoolIdle.set(pool.idleCount);
  dbPoolWaiting.set(pool.waitingCount);

  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
};
