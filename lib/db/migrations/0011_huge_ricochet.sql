ALTER TABLE "open_positions" ADD COLUMN "product_type" text;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "product_side" text;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "underlying_direction" text;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "underlying_ticker" text;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "indicative_leverage" real;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "financing_level" real;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "barrier_level" real;--> statement-breakpoint
ALTER TABLE "open_positions" ADD COLUMN "barrier_type" text;