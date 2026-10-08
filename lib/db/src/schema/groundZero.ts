import { pgTable, serial, date, bigint, timestamp } from "drizzle-orm/pg-core";

// Separate, append-only manual valuations. Never reset challenge/trade history.
export const groundZeroSnapshotsTable = pgTable("ground_zero_snapshots", {
  id: serial("id").primaryKey(),
  asOfDate: date("as_of_date", { mode: "string" }).notNull(),
  totalValueOre: bigint("total_value_ore", { mode: "number" }).notNull(),
  netExternalFlowsOre: bigint("net_external_flows_ore", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
