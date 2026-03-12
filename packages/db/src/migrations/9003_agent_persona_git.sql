ALTER TABLE "agents" ADD COLUMN "persona_git_url" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "persona_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "persona_last_sync_error" text;
