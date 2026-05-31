import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { listAuditLogs, getAuditLogsByEntity, exportAuditLogs, rowsToCsv } from "../services/audit.service";

const router = Router();
router.use(requireAuth);
router.use("/audit-logs", requireRole("super_admin", "compliance_officer"));

router.get(
  "/audit-logs",
  asyncHandler(async (req: AuthRequest, res) => {
    const { dateFrom, dateTo, action, userId, entityType, limit, offset } =
      req.query as Record<string, string | undefined>;
    res.json(await listAuditLogs(req, { dateFrom, dateTo, action, userId, entityType, limit, offset }));
  }),
);

router.get(
  "/audit-logs/entity/:entityType/:entityId",
  asyncHandler(async (req: AuthRequest, res) => {
    const entityType = String(req.params.entityType);
    const entityId = String(req.params.entityId);
    res.json(await getAuditLogsByEntity(req, entityType, entityId));
  }),
);

router.get(
  "/audit-logs/export",
  asyncHandler(async (req: AuthRequest, res) => {
    const { dateFrom, dateTo, action, userId, entityType, format = "json" } =
      req.query as Record<string, string | undefined>;

    const rows = await exportAuditLogs(req, { dateFrom, dateTo, action, userId, entityType, format });
    const dateLabel = new Date().toISOString().split("T")[0];

    if (format === "csv") {
      res.header("Content-Type", "text/csv");
      res.attachment(`audit-logs-${dateLabel}.csv`);
      res.send(rowsToCsv(rows as Record<string, unknown>[]));
      return;
    }

    res.attachment(`audit-logs-${dateLabel}.json`);
    res.json(rows);
  }),
);

export default router;
