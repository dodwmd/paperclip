CREATE TABLE "issue_dependencies" (
	"dependent_id" uuid NOT NULL,
	"blocker_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_dependencies_pk" PRIMARY KEY("dependent_id","blocker_id")
);
--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_dependent_id_issues_id_fk" FOREIGN KEY ("dependent_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_blocker_id_issues_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_dependencies_dependent_idx" ON "issue_dependencies" USING btree ("dependent_id");--> statement-breakpoint
CREATE INDEX "issue_dependencies_blocker_idx" ON "issue_dependencies" USING btree ("blocker_id");--> statement-breakpoint
CREATE INDEX "issue_dependencies_company_idx" ON "issue_dependencies" USING btree ("company_id");
