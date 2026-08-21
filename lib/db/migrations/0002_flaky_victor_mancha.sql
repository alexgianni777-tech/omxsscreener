ALTER TABLE "open_positions" ADD COLUMN "target_price" real;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "market" text;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "notes" text;