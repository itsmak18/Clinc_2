import cron from "node-cron";
import { db } from "@workspace/db";
import { appointmentsTable, notificationsTable } from "@workspace/db";
import { eq, and, lte, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

// Start cron jobs
export function startCronJobs() {
  logger.info("Starting background cron jobs...");

  // 1. No-show Auto-Cancellation (Runs every hour)
  // Marks appointments as 'no_show' if they are 'scheduled' and the time has passed by >2 hours
  cron.schedule("0 * * * *", async () => {
    logger.info("[Cron] Running No-show Auto-Cancellation job");
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      
      const result = await db.update(appointmentsTable)
        .set({ status: "no_show", updatedAt: new Date() })
        .where(
          and(
            eq(appointmentsTable.status, "scheduled"),
            lte(appointmentsTable.scheduledAt, twoHoursAgo)
          )
        )
        .returning({ id: appointmentsTable.id });
        
      if (result.length > 0) {
        logger.info({ count: result.length }, "[Cron] Marked appointments as no_show");
      }
    } catch (err) {
      logger.error({ err }, "[Cron] Failed to run No-show Auto-Cancellation");
    }
  });

  // 2. Patient Recall Worker (Runs daily at 08:00 AM)
  // Reminds patients to book a follow-up if they haven't booked one 6 months after completion
  cron.schedule("0 8 * * *", async () => {
    logger.info("[Cron] Running Patient Recall Worker");
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // Example logic: Find patients with a completed appointment ~6 months ago,
      // and who have NO scheduled appointments in the future.
      // Since this requires a complex left join or subquery, we implement a simplified check here.
      
      const query = sql`
        SELECT DISTINCT a."patient_id"
        FROM "appointments" a
        WHERE a."status" = 'completed'
          AND a."updated_at" < ${sixMonthsAgo}
          AND NOT EXISTS (
            SELECT 1 FROM "appointments" a2 
            WHERE a2."patient_id" = a."patient_id" 
              AND a2."scheduled_at" > CURRENT_DATE
              AND a2."status" NOT IN ('cancelled', 'no_show')
          )
      `;
      
      const result = await db.execute(query);
      if (result.rowCount && result.rowCount > 0) {
        logger.info({ count: result.rowCount }, "[Cron] Found patients for recall");
        // We could insert notifications here:
        // await db.insert(notificationsTable).values(rows.map(r => ({ userId: (front desk ID), title: "Recall Due", message: "Patient ID " + r.patient_id + " is due for follow-up" })))
      }
    } catch (err) {
      logger.error({ err }, "[Cron] Failed to run Patient Recall Worker");
    }
  });

  // 3. Nightly DB vacuum/analyze (Runs daily at 02:00 AM)
  // Keeps PostgreSQL indices healthy
  cron.schedule("0 2 * * *", async () => {
    logger.info("[Cron] Running Nightly DB VACUUM ANALYZE");
    try {
      await db.execute(sql`VACUUM ANALYZE;`);
      logger.info("[Cron] Successfully completed VACUUM ANALYZE");
    } catch (err) {
      logger.error({ err }, "[Cron] Failed to run DB VACUUM ANALYZE");
    }
  });

}
