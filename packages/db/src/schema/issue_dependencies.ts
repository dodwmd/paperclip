import { pgTable, uuid, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

export const issueDependencies = pgTable(
  "issue_dependencies",
  {
    dependentId: uuid("dependent_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    blockerId: uuid("blocker_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.dependentId, table.blockerId], name: "issue_dependencies_pk" }),
    dependentIdx: index("issue_dependencies_dependent_idx").on(table.dependentId),
    blockerIdx: index("issue_dependencies_blocker_idx").on(table.blockerId),
    companyIdx: index("issue_dependencies_company_idx").on(table.companyId),
  }),
);
