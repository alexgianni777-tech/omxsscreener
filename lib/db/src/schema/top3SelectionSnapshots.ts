import { pgTable, serial, integer, text, real, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { screenerSessionsTable } from "./screenerSessions";

/**
 * Point-in-time official Top 3 decision for each candidate present when a
 * session is first enriched. candidate_id intentionally has no FK: a pending
 * candidate may later be removed by a re-import, but its decision evidence
 * must remain queryable.
 */
export const top3SelectionSnapshotsTable = pgTable("top3_selection_snapshots", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => screenerSessionsTable.id, { onDelete: "cascade" }),
  candidateId: integer("candidate_id").notNull(),
  ticker: text("ticker").notNull(),
  category: text("category").notNull(),
  selected: boolean("selected").notNull(),
  rank: integer("rank"),
  score: real("score").notNull(),
  review: jsonb("review").notNull(),
  decision: jsonb("decision").notNull(),
  earningsWarning: boolean("earnings_warning").notNull(),
  policyVersion: text("policy_version").notNull(),
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull(),
  type: text("type").notNull(),
  market: text("market", { enum: ["SE", "US"] }),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  source: text("source", { enum: ["edgeai", "telegram", "manual", "screener"] }),
}, (table) => ({
  sessionCandidateUnique: uniqueIndex("top3_selection_snapshots_session_candidate_uq")
    .on(table.sessionId, table.candidateId),
}));

export type Top3SelectionSnapshot = typeof top3SelectionSnapshotsTable.$inferSelect;