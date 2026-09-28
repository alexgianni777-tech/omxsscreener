CREATE TABLE "top3_selection_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"candidate_id" integer NOT NULL,
	"ticker" text NOT NULL,
	"category" text NOT NULL,
	"selected" boolean NOT NULL,
	"rank" integer,
	"score" real NOT NULL,
	"review" jsonb NOT NULL,
	"decision" jsonb NOT NULL,
	"earnings_warning" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"selected_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"market" text,
	"direction" text NOT NULL,
	"source" text,
	CONSTRAINT "top3_selection_snapshots_session_id_screener_sessions_id_fk"
		FOREIGN KEY ("session_id") REFERENCES "public"."screener_sessions"("id")
		ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "screener_sessions" ADD COLUMN "top3_snapshot_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "screener_sessions" ADD COLUMN "top3_policy_version" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "top3_selection_snapshots_session_candidate_uq"
	ON "top3_selection_snapshots" USING btree ("session_id", "candidate_id");