import { pgTable, uuid, integer, text, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { clinicsTable } from "./clinics";
import { usersTable } from "./users";
import { inventoryTable } from "./inventory";
import { uuidV7 } from "../uuid-v7";

// Reason a stock level changed. Append-only ledger — one row per movement.
export const inventoryTxnReasonEnum = pgEnum("inventory_txn_reason", [
  "initial",     // opening balance when the item is first created
  "restock",     // stock received / added
  "consumed",    // stock used / dispensed
  "expired",     // written off due to expiry
  "adjustment",  // manual correction (stock-take, damage, etc.)
]);

export const inventoryTransactionsTable = pgTable("inventory_transactions", {
  id: uuid("id").$defaultFn(uuidV7).primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  itemId: integer("item_id").notNull().references(() => inventoryTable.id),
  // Signed change: +received, -consumed. Never zero.
  delta: integer("delta").notNull(),
  // Resulting quantity after this movement (ledger snapshot — survives item edits).
  quantityAfter: integer("quantity_after").notNull(),
  reason: inventoryTxnReasonEnum("reason").notNull(),
  note: text("note"),
  performedById: integer("performed_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("inv_txn_item_idx").on(t.clinicId, t.itemId, t.createdAt),
]);

export type InventoryTransaction = typeof inventoryTransactionsTable.$inferSelect;
