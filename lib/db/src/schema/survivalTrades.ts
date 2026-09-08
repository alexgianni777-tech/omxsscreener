import { pgTable, serial, text, real, boolean, date, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { candidatesTable } from "./candidates";

export const survivalConfigTable = pgTable("survival_config", {
  id: serial("id").primaryKey(),
  startCapital: real("start_capital").notNull().default(5000),
  goalCapital: real("goal_capital").notNull().default(1000000),
  currentCapital: real("current_capital"),   // manually-entered actual account balance
  riskPct: real("risk_pct").notNull().default(2),  // % of account risked per trade
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const survivalTradesTable = pgTable("survival_trades", {
  id: serial("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  ticker: text("ticker"),
  strategy: text("strategy").notNull(),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  leverageX: real("leverage_x"),
  pnlKr: real("pnl_kr").notNull(),
  // Authoritative cash amount allocated to one R. New candidate-linked trades
  // persist it so later outcome corrections can recompute P&L without drift.
  riskAllocationKr: real("risk_allocation_kr"),
  flag: text("flag", { enum: ["LAST", "REFLEX"] }).notNull(),
  followedPlan: boolean("followed_plan").notNull(),
  boughtBeforeReport: boolean("bought_before_report").notNull().default(false),
  sourceCandidateId: integer("source_candidate_id").references(() => candidatesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("survival_trades_source_candidate_unique").on(table.sourceCandidateId),
]);

export type SurvivalConfig = typeof survivalConfigTable.$inferSelect;
export type SurvivalTrade = typeof survivalTradesTable.$inferSelect;
