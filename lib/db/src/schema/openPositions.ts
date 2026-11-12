import { pgTable, serial, text, real, timestamp } from "drizzle-orm/pg-core";

export const openPositionsTable = pgTable("open_positions", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  instrument: text("instrument"),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  productType: text("product_type"),
  productSide: text("product_side", { enum: ["LONG", "SHORT"] }),
  underlyingDirection: text("underlying_direction", { enum: ["LONG", "SHORT"] }),
  underlyingTicker: text("underlying_ticker"),
  indicativeLeverage: real("indicative_leverage"),
  financingLevel: real("financing_level"),
  barrierLevel: real("barrier_level"),
  barrierType: text("barrier_type"),
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
