import { pgTable, serial, integer, text, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { screenerSessionsTable } from "./screenerSessions";

/** Append-only recommendations; original official snapshots remain statistical evidence. */
export const top3SelectionRevisionsTable = pgTable("top3_selection_revisions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => screenerSessionsTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  fingerprint: text("fingerprint").notNull(),
  policyVersion: text("policy_version").notNull(),
  available: boolean("available").notNull(),
  displayEligible: boolean("display_eligible").notNull().default(true),
  sources: jsonb("sources").$type<string[]>().notNull(),
  inputs: jsonb("inputs").$type<unknown[]>().notNull(),
  selections: jsonb("selections").$type<unknown[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => ({
  sessionRevisionUnique: uniqueIndex("top3_selection_revisions_session_revision_uq").on(table.sessionId, table.revision),
}));