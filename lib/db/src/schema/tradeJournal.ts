import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/** Append-only, separate from candidate outcomes and Challenge Tracker accounting. */
export const tradeJournalTable = pgTable("trade_journal", {
  id: text("id").primaryKey(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
