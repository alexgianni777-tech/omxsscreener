CREATE TABLE IF NOT EXISTS "trade_journal" (
  "id" text PRIMARY KEY NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
