import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";

export const openPositionsTable = pgTable("open_positions", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  instrument: text("instrument"),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  entryPrice: real("entry_price").notNull(),
  lastPrice: real("last_price"),
  shares: real("shares").notNull(),
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
  market: text("market"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OpenPosition = typeof openPositionsTable.$inferSelect;
