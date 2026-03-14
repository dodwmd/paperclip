import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const instanceMcpCatalog = pgTable("instance_mcp_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
