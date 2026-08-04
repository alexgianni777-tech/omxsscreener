import { pgTable, serial, text, real, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const screenerSessionsTable = pgTable("screener_sessions", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull().unique(),
  omxsValue: real("omxs_value").notNull(),
  perf5d: real("perf_5d").notNull(),
  perf1m: real("perf_1m").notNull(),
  perf3m: real("perf_3m").notNull(),
  marketRsi: real("market_rsi").notNull(),
  trendLabel: text("trend_label").notNull(),
  rawText: text("raw_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScreenerSessionSchema = createInsertSchema(screenerSessionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertScreenerSession = z.infer<typeof insertScreenerSessionSchema>;
export type ScreenerSession = typeof screenerSessionsTable.$inferSelect;
