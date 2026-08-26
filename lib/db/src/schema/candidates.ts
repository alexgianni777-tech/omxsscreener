import { pgTable, serial, integer, text, real, boolean, timestamp } from "drizzle-orm/pg-core";
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
  // Separate signal inputs from legacy display fields: EdgeAI uses `rsi` for E[R].
  signalRsi: real("signal_rsi"),
  signalGapPct: real("signal_gap_pct"),
  distFrom20dH: real("dist_from_20d_h").notNull(),
  gapWarning: real("gap_warning"),
  earningsInDays: integer("earnings_in_days"),
  // Nullable: legacy rows imported before market tagging existed can still be NULL
  // in production (this screener's history predates EdgeAI's US support, so any
  // untagged legacy row is Swedish by construction, but we can't force-backfill
  // production data from here). API responses coalesce null -> "SE" at the
  // mapCandidate boundary instead of enforcing NOT NULL at the DB level — see
  // lib/db/SCHEMA-SAFETY.md history and #52.
  market: text("market", { enum: ["SE", "US"] }).default("SE"),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  entryPrice: real("entry_price").notNull(),
  stopPrice: real("stop_price").notNull(),
  targetPrice: real("target_price").notNull(),
  rr: real("rr").notNull(),
  oneR: real("one_r").notNull(),
  outcome: text("outcome", { enum: ["WIN", "LOSS", "SKIP", "PENDING"] }).notNull().default("PENDING"),
  exitPrice: real("exit_price"),
  outcomeNotes: text("outcome_notes"),
  isTop3Pick: boolean("is_top3_pick").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCandidateSchema = createInsertSchema(candidatesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidatesTable.$inferSelect;
