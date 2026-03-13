import { z } from "zod";

export const columnDefinitionSchema = z.object({
  status: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "Column status must be lowercase_snake_case (e.g. intelligence_queue)"),
  label: z.string().min(1).max(80),
  wipGlobalLimit: z.number().int().positive().optional(),
  wipPerAssigneeLimit: z.number().int().positive().optional(),
  truncateByDefault: z.boolean().optional(),
});

export const transitionRuleSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  allowedRoles: z.array(z.string()).min(1, "At least one allowed role is required"),
  requiredFields: z.array(z.enum(["prUrl"])).optional(),
  strict: z.boolean().optional(),
});

export const kanbanConfigSchema = z
  .object({
    columns: z.array(columnDefinitionSchema).min(1).max(50),
    rules: z.array(transitionRuleSchema).min(1).max(500),
  })
  .superRefine((data, ctx) => {
    const statuses = new Set(data.columns.map((c) => c.status));

    // Column status keys must be unique
    const seen = new Set<string>();
    data.columns.forEach((col, i) => {
      if (seen.has(col.status)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate column status: "${col.status}"`,
          path: ["columns", i, "status"],
        });
      }
      seen.add(col.status);
    });

    // All rule from/to must reference a defined column
    data.rules.forEach((rule, i) => {
      if (!statuses.has(rule.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rule references undefined column: "${rule.from}"`,
          path: ["rules", i, "from"],
        });
      }
      if (!statuses.has(rule.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rule references undefined column: "${rule.to}"`,
          path: ["rules", i, "to"],
        });
      }
    });
  });

export type KanbanConfigInput = z.input<typeof kanbanConfigSchema>;
export type KanbanConfigParsed = z.output<typeof kanbanConfigSchema>;
