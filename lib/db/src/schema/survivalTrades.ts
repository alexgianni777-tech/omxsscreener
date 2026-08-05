import { pgTable, serial, text, real, boolean, date, timestamp } from "drizzle-orm/pg-core";

export const survivalConfigTable = pgTable("survival_config", {
  id: serial("id").primaryKey(),
  startCapital: real("start_capital").notNull().default(5000),
  goalCapital: real("goal_capital").notNull().default(1000000),
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
  flag: text("flag", { enum: ["LAST", "REFLEX"] }).notNull(),
  followedPlan: boolean("followed_plan").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SurvivalConfig = typeof survivalConfigTable.$inferSelect;
export type SurvivalTrade = typeof survivalTradesTable.$inferSelect;
