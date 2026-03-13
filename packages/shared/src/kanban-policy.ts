// ---------------------------------------------------------------------------
// Transition rules — pure data, imported by both server and UI
// ---------------------------------------------------------------------------
import { kanbanConfigSchema } from "./validators/kanban-config.js";

export interface TransitionRule {
  /** Status key the issue is moving from. Accepts any string to support custom columns. */
  from: string;
  /** Status key the issue is moving to. Accepts any string to support custom columns. */
  to: string;
  /** Roles that can make this transition. "board" means board actor. */
  allowedRoles: string[];
  /** Fields that must be present on the issue for the transition to proceed. */
  requiredFields?: Array<"prUrl">;
  /**
   * When true, this is a quality gate transition. Board actors cannot bypass
   * role checks — only an agent with the designated role may make this move.
   * Use for gates where human override would defeat the purpose (e.g. QA sign-off,
   * DevOps deployment confirmation).
   */
  strict?: boolean;
}

// ---------------------------------------------------------------------------
// Column definitions — describes each board column
// ---------------------------------------------------------------------------

export interface ColumnDefinition {
  /** Internal snake_case status key, e.g. "intelligence_queue" */
  status: string;
  /** Display name shown on the board header */
  label: string;
  /** Global WIP limit — max total issues allowed in this column */
  wipGlobalLimit?: number;
  /** Per-assignee WIP limit — max issues per agent in this column */
  wipPerAssigneeLimit?: number;
  /** When true, column is collapsed to 5 items unless filtered (like done/cancelled) */
  truncateByDefault?: boolean;
}

/** Full kanban configuration: ordered columns + transition rules */
export interface KanbanConfig {
  columns: ColumnDefinition[];
  rules: TransitionRule[];
}

/** The default column set — mirrors the current hardcoded BOARD_COLUMNS in KanbanBoard.tsx */
export const DEFAULT_COLUMNS: ColumnDefinition[] = [
  { status: "backlog",     label: "Backlog" },
  { status: "todo",        label: "Todo" },
  { status: "ready",       label: "Ready",       wipGlobalLimit: 10 },
  { status: "in_progress", label: "In Progress",  wipPerAssigneeLimit: 2 },
  { status: "in_review",   label: "In Review",    wipGlobalLimit: 4 },
  { status: "qa",          label: "QA",           wipGlobalLimit: 4 },
  { status: "deploy",      label: "Deploy" },
  { status: "done",        label: "Done",         truncateByDefault: true },
  { status: "blocked",     label: "Blocked" },
  { status: "cancelled",   label: "Cancelled",    truncateByDefault: true },
];

/**
 * Returns the effective kanban config for a company.
 * If the company has no custom config (null), returns the system defaults.
 * If the config fails validation (e.g. corrupted DB JSON), logs a warning and falls back to defaults.
 */
export function resolveKanbanConfig(config: KanbanConfig | null | undefined): KanbanConfig {
  if (!config) return { columns: DEFAULT_COLUMNS, rules: DEFAULT_TRANSITION_RULES };
  const parsed = kanbanConfigSchema.safeParse(config);
  if (!parsed.success) {
    console.warn("[kanban-policy] resolveKanbanConfig: stored config failed validation, falling back to defaults.", parsed.error.flatten());
    return { columns: DEFAULT_COLUMNS, rules: DEFAULT_TRANSITION_RULES };
  }
  return parsed.data;
}

/**
 * The canonical Kanban transition table.
 *
 * Design decisions documented here:
 * - "general" role is intentionally absent from all allowedRoles. Agents
 *   created without a role default to "general" and are blocked from all
 *   transitions in authenticated mode. Operators must assign a specific role
 *   (e.g. "engineer") before enforcement is active. This is documented in
 *   SKILL.md. See also: KANBAN_ENFORCEMENT_ENABLED env var.
 * - Board actors bypass role checks for most transitions (operational flexibility).
 *   For strict:true transitions, board bypass is disabled — only the designated
 *   role agent may make the move (quality gate enforcement).
 * - "cto" is used for the Tech Lead / senior engineer role.
 * - Product Owner (pm) role does NOT triage backlog→todo — that is the Tech Lead's
 *   responsibility. PM owns cancellations and reopening cancelled tickets only.
 * - Done tickets cannot be reopened (raise a new ticket instead — workflow doc rule).
 *   Cancelled tickets can be restored to todo by pm.
 */
export const DEFAULT_TRANSITION_RULES: TransitionRule[] = [
  // ── Backlog ─────────────────────────────────────────────────────────────
  // Tech Lead (cto) triages backlog → todo. PM creates in backlog but does not
  // move tickets forward — that is the Tech Lead's call.
  { from: "backlog",     to: "todo",        allowedRoles: ["cto"] },
  { from: "backlog",     to: "cancelled",   allowedRoles: ["pm"] },

  // ── Todo ────────────────────────────────────────────────────────────────
  // Tech Lead refines todo → ready. Only cto demotes back to backlog;
  // PM does not move tickets out of todo (workflow doc rule).
  { from: "todo",        to: "ready",       allowedRoles: ["cto"] },
  { from: "todo",        to: "backlog",     allowedRoles: ["cto"] },
  { from: "todo",        to: "cancelled",   allowedRoles: ["pm"] },

  // ── Ready ───────────────────────────────────────────────────────────────
  // Developer pulls from ready. PM can cancel.
  { from: "ready",       to: "in_progress", allowedRoles: ["engineer"] },
  { from: "ready",       to: "todo",        allowedRoles: ["cto"] },
  { from: "ready",       to: "cancelled",   allowedRoles: ["pm"] },

  // ── In Progress ─────────────────────────────────────────────────────────
  // Developer or Tech Lead submits PR (prUrl required) or blocks. PM can cancel.
  // cto is included so the Tech Lead can progress their own assigned tasks —
  // without it they have no exit from in_progress.
  { from: "in_progress", to: "in_review",   allowedRoles: ["engineer", "cto"], requiredFields: ["prUrl"] },
  { from: "in_progress", to: "blocked",     allowedRoles: ["engineer", "cto"] },
  { from: "in_progress", to: "cancelled",   allowedRoles: ["pm"] },

  // ── In Review ───────────────────────────────────────────────────────────
  // Reviewer (engineer peer or cto) approves → QA, or sends back. PM can cancel.
  // cto may also mark directly done for stories that skip QA/deploy (e.g. docs, config).
  { from: "in_review",   to: "qa",          allowedRoles: ["engineer", "cto"] },
  { from: "in_review",   to: "in_progress", allowedRoles: ["engineer", "cto"] },
  { from: "in_review",   to: "done",        allowedRoles: ["cto"] },
  { from: "in_review",   to: "cancelled",   allowedRoles: ["pm"] },

  // ── QA ──────────────────────────────────────────────────────────────────
  // STRICT: Only QA Engineer may sign off qa→deploy. Board override disabled.
  // This is a quality gate — human operators must not bypass QA sign-off.
  { from: "qa",          to: "deploy",      allowedRoles: ["qa"],     strict: true },
  { from: "qa",          to: "in_progress", allowedRoles: ["qa"] },
  { from: "qa",          to: "cancelled",   allowedRoles: ["pm"] },

  // ── Deploy ──────────────────────────────────────────────────────────────
  // STRICT: Only DevOps may confirm deploy→done. Board override disabled.
  // Rollback to QA is also devops-only (they own the deploy pipeline).
  { from: "deploy",      to: "done",        allowedRoles: ["devops"], strict: true },
  { from: "deploy",      to: "qa",          allowedRoles: ["devops"] },
  { from: "deploy",      to: "cancelled",   allowedRoles: ["pm"] },

  // ── Blocked ─────────────────────────────────────────────────────────────
  // Tech Lead is responsible for unblocking; engineer can self-unblock if
  // the blocker is resolved. PM can cancel.
  { from: "blocked",     to: "in_progress", allowedRoles: ["cto", "engineer"] },
  { from: "blocked",     to: "cancelled",   allowedRoles: ["pm"] },

  // ── Terminal states ──────────────────────────────────────────────────────
  // Done tickets are NOT reopened — raise a new ticket instead (workflow doc rule).
  // Cancelled tickets can be restored to todo by pm.
  { from: "cancelled",   to: "todo",        allowedRoles: ["pm"] },
];

// ---------------------------------------------------------------------------
// WIP limits — pure data
// ---------------------------------------------------------------------------

export const WIP_LIMITS: Partial<Record<string, { globalLimit?: number; perAssigneeLimit?: number }>> =
  Object.fromEntries(
    DEFAULT_COLUMNS
      .filter((c) => c.wipGlobalLimit !== undefined || c.wipPerAssigneeLimit !== undefined)
      .map((c) => [c.status, { globalLimit: c.wipGlobalLimit, perAssigneeLimit: c.wipPerAssigneeLimit }]),
  );

// ---------------------------------------------------------------------------
// Policy check types (shared between server and UI)
// ---------------------------------------------------------------------------

export type TransitionDeniedReason = "forbidden_role" | "missing_field" | "wip_exceeded";

export interface TransitionCheckResult {
  allowed: boolean;
  reason?: TransitionDeniedReason;
  detail?: string;
}

export type ActorKind = "board" | "agent";

export interface TransitionActor {
  kind: ActorKind;
  role: string | null;
}

// ---------------------------------------------------------------------------
// checkTransitionPolicy — pure function, no DB calls
//
// Board actors unconditionally bypass role checks — they can move an issue
// into any defined column. This is intentional: board operators need full
// override capability (hotfixes, manual corrections, etc.).
//
// The strict flag on a rule signals to agents that a quality gate is in place
// (only the designated role agent may make that transition). Board actors are
// unaffected by strict — they always bypass.
//
// Required-field checks (e.g. prUrl) apply to all actors including board,
// because the field is genuinely needed for the workflow to function.
// ---------------------------------------------------------------------------

export function checkTransitionPolicy(
  from: string,
  to: string,
  actor: TransitionActor,
  fields: { prUrl?: string | null },
  rules: TransitionRule[] = DEFAULT_TRANSITION_RULES,
): TransitionCheckResult {
  // Idempotency: status unchanged → always allowed (safe to retry).
  if (from === to) return { allowed: true };

  // Board actors bypass all role and rule-existence checks — they can force
  // any column transition as a manual override (hotfix, correction, CEO/CTO
  // override, etc.). Only required-field checks still apply because the field
  // is genuinely needed for the workflow to function (e.g. prUrl for in_review).
  if (actor.kind === "board") {
    const rule = rules.find((r) => r.from === from && r.to === to);
    if (rule?.requiredFields?.includes("prUrl") && !fields.prUrl) {
      return {
        allowed: false,
        reason: "missing_field",
        detail: "A PR URL is required before moving to in_review",
      };
    }
    return { allowed: true };
  }

  // Agent actor: rule must exist and role must be permitted.
  const rule = rules.find((r) => r.from === from && r.to === to);
  if (!rule) {
    return {
      allowed: false,
      reason: "forbidden_role",
      detail: `Transition '${from}' → '${to}' is not defined`,
    };
  }

  const actorRole = actor.role ?? "general";
  if (!rule.allowedRoles.includes(actorRole)) {
    const detail = rule.strict
      ? `Quality gate: only role '${rule.allowedRoles.join("/")}' may move '${from}' → '${to}'`
      : `Role '${actorRole}' cannot move '${from}' → '${to}'`;
    return {
      allowed: false,
      reason: "forbidden_role",
      detail,
    };
  }

  // Required field checks apply to all actors.
  if (rule.requiredFields?.includes("prUrl") && !fields.prUrl) {
    return {
      allowed: false,
      reason: "missing_field",
      detail: "A PR URL is required before moving to in_review",
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// checkWipPolicy — pure function, no DB calls
//
// NOTE: Only call from WIP enforcement on active columns (ready, in_progress,
// in_review, qa). Avoid on terminal statuses (done, cancelled) from hot paths.
// ---------------------------------------------------------------------------

export function checkWipPolicy(
  to: string,
  currentCountInColumn: number,
  assigneeAgentId: string | null,
  currentCountByAssignee: number,
  wipLimits: Partial<Record<string, { globalLimit?: number; perAssigneeLimit?: number }>> = WIP_LIMITS,
): TransitionCheckResult {
  const config = wipLimits[to];
  if (!config) return { allowed: true };

  if (config.globalLimit != null && currentCountInColumn >= config.globalLimit) {
    return {
      allowed: false,
      reason: "wip_exceeded",
      detail: `Column '${to}' is at its WIP limit of ${config.globalLimit} (current: ${currentCountInColumn})`,
    };
  }

  if (
    config.perAssigneeLimit != null &&
    assigneeAgentId != null &&
    currentCountByAssignee >= config.perAssigneeLimit
  ) {
    return {
      allowed: false,
      reason: "wip_exceeded",
      detail: `Assignee already has ${config.perAssigneeLimit} items in '${to}' (current: ${currentCountByAssignee})`,
    };
  }

  return { allowed: true };
}
