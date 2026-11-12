-- Idempotent baseline for databases previously provisioned by drizzle-kit push.
-- Future schema changes belong in immutable forward migrations.
CREATE TABLE IF NOT EXISTS "screener_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"omxs_value" real NOT NULL,
	"perf_5d" real NOT NULL,
	"perf_1m" real NOT NULL,
	"perf_3m" real NOT NULL,
	"market_rsi" real NOT NULL,
	"trend_label" text NOT NULL,
	"raw_text" text NOT NULL,
	"source" text,
	"edge_regime" text,
	"edge_expectancy" real,
	"edge_win_rate" real,
	"edge_pf" real,
	"edge_n" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screener_sessions_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"category" text NOT NULL,
	"rank" integer NOT NULL,
	"ticker" text NOT NULL,
	"price" real NOT NULL,
	"rs3m" real NOT NULL,
	"perf_1m" real NOT NULL,
	"rsi" integer NOT NULL,
	"pct_b" real NOT NULL,
	"atr" real NOT NULL,
	"vol_multiplier" real NOT NULL,
	"dist_from_20d_h" real NOT NULL,
	"gap_warning" real,
	"signal_rsi" integer,
	"signal_gap_pct" real,
	"market" text,
	"earnings_in_days" integer,
	"direction" text NOT NULL,
	"entry_price" real NOT NULL,
	"stop_price" real NOT NULL,
	"target_price" real NOT NULL,
	"rr" real NOT NULL,
	"one_r" real NOT NULL,
	"outcome" text DEFAULT 'PENDING' NOT NULL,
	"exit_price" real,
	"outcome_notes" text,
	"is_top3_pick" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survival_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"start_capital" real DEFAULT 5000 NOT NULL,
	"goal_capital" real DEFAULT 1000000 NOT NULL,
	"current_capital" real,
	"risk_pct" real DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "survival_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"ticker" text,
	"strategy" text NOT NULL,
	"direction" text NOT NULL,
	"leverage_x" real,
	"pnl_kr" real NOT NULL,
	"flag" text NOT NULL,
	"followed_plan" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "open_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"direction" text NOT NULL,
	"entry_price" real NOT NULL,
	"shares" real NOT NULL,
	"stop_price" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'candidates_session_id_screener_sessions_id_fk'
	) THEN
		ALTER TABLE "candidates"
			ADD CONSTRAINT "candidates_session_id_screener_sessions_id_fk"
			FOREIGN KEY ("session_id")
			REFERENCES "public"."screener_sessions"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions" USING btree ("expire");
