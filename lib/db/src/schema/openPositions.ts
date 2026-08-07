import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";

export const openPositionsTable = pgTable("open_positions", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  entryPrice: real("entry_price").notNull(),
  shares: real("shares").notNull(),
  stopPrice: real("stop_price"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OpenPosition = typeof openPositionsTable.$inferSelect;
