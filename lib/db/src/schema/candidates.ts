import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { screenerSessionsTable } from "./screenerSessions";

export const candidatesTable = pgTable("candidates", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => screenerSessionsTable.id, { onDelete: "cascade" }),
  category: text("category", { enum: ["MOMENTUM", "SQUEEZE", "STUDS", "WEAKEST"] }).notNull(),
  rank: integer("rank").notNull(),
  ticker: text("ticker").notNull(),
  price: real("price").notNull(),
  rs3m: real("rs3m").notNull(),
  perf1m: real("perf_1m").notNull(),
  rsi: integer("rsi").notNull(),
  pctB: real("pct_b").notNull(),
  atr: real("atr").notNull(),
  volMultiplier: real("vol_multiplier").notNull(),
  distFrom20dH: real("dist_from_20d_h").notNull(),
  gapWarning: real("gap_warning"),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  entryPrice: real("entry_price").notNull(),
  stopPrice: real("stop_price").notNull(),
  targetPrice: real("target_price").notNull(),
  rr: real("rr").notNull(),
  oneR: real("one_r").notNull(),
  outcome: text("outcome", { enum: ["WIN", "LOSS", "SKIP", "PENDING"] }).notNull().default("PENDING"),
  exitPrice: real("exit_price"),
  outcomeNotes: text("outcome_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
