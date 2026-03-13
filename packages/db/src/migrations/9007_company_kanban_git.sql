ALTER TABLE "companies" ADD COLUMN "kanban_git_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "kanban_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "kanban_last_sync_error" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "kanban_git_sha" text;
