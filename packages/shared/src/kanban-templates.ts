import { DEFAULT_COLUMNS, DEFAULT_TRANSITION_RULES } from "./kanban-policy.js";
import type { KanbanConfig, TransitionRule } from "./kanban-policy.js";

export interface KanbanTemplate {
  id: string;
  name: string;
  description: string;
  /** Short list of column labels shown as a preview in the template picker */
  previewColumns: string[];
  config: KanbanConfig;
}

// ---------------------------------------------------------------------------
// Simple Kanban — 4 columns, no gates
// ---------------------------------------------------------------------------

const SIMPLE_COLUMNS = DEFAULT_COLUMNS.filter((c) =>
  ["backlog", "in_progress", "done", "cancelled"].includes(c.status),
);

const SIMPLE_RULES: TransitionRule[] = [
  { from: "backlog",     to: "in_progress", allowedRoles: ["engineer", "cto"] },
  { from: "backlog",     to: "cancelled",   allowedRoles: ["pm"] },
  { from: "in_progress", to: "done",        allowedRoles: ["engineer", "cto"] },
  { from: "in_progress", to: "backlog",     allowedRoles: ["cto"] },
  { from: "in_progress", to: "cancelled",   allowedRoles: ["pm"] },
  { from: "cancelled",   to: "backlog",     allowedRoles: ["pm"] },
];

// ---------------------------------------------------------------------------
// Scrum — product backlog → sprint backlog → in_progress → in_review → done
// ---------------------------------------------------------------------------

const SCRUM_COLUMNS = [
  { status: "product_backlog", label: "Product Backlog" },
  { status: "sprint_backlog",  label: "Sprint Backlog", wipGlobalLimit: 20 },
  { status: "in_progress",     label: "In Progress",    wipPerAssigneeLimit: 2 },
  { status: "in_review",       label: "In Review",      wipGlobalLimit: 4 },
  { status: "done",            label: "Done",           truncateByDefault: true },
  { status: "blocked",         label: "Blocked" },
  { status: "cancelled",       label: "Cancelled",      truncateByDefault: true },
];

const SCRUM_RULES: TransitionRule[] = [
  // Sprint planning: cto/pm pulls stories into the sprint
  { from: "product_backlog", to: "sprint_backlog",   allowedRoles: ["cto", "pm"] },
  { from: "product_backlog", to: "cancelled",         allowedRoles: ["pm"] },
  // Sprint backlog → work
  { from: "sprint_backlog",  to: "in_progress",      allowedRoles: ["engineer"] },
  { from: "sprint_backlog",  to: "product_backlog",  allowedRoles: ["cto"] },
  { from: "sprint_backlog",  to: "cancelled",         allowedRoles: ["pm"] },
  // In progress
  { from: "in_progress",     to: "in_review",        allowedRoles: ["engineer", "cto"], requiredFields: ["prUrl"] },
  { from: "in_progress",     to: "blocked",           allowedRoles: ["engineer", "cto"] },
  { from: "in_progress",     to: "cancelled",         allowedRoles: ["pm"] },
  // Review: approved or rejected
  { from: "in_review",       to: "in_progress",      allowedRoles: ["engineer", "cto"] },
  { from: "in_review",       to: "done",              allowedRoles: ["cto"] },
  { from: "in_review",       to: "cancelled",         allowedRoles: ["pm"] },
  // Blocked
  { from: "blocked",         to: "in_progress",      allowedRoles: ["cto", "engineer"] },
  { from: "blocked",         to: "cancelled",         allowedRoles: ["pm"] },
  // Restore cancelled to sprint
  { from: "cancelled",       to: "sprint_backlog",   allowedRoles: ["pm"] },
];

// ---------------------------------------------------------------------------
// Design Pipeline — intelligence + design queues prepend the standard flow
// ---------------------------------------------------------------------------

const DESIGN_PIPELINE_COLUMNS = [
  { status: "intelligence_queue", label: "Intelligence Queue", wipGlobalLimit: 5 },
  { status: "design_queue",       label: "Design Queue",       wipGlobalLimit: 5 },
  ...DEFAULT_COLUMNS,
];

const DESIGN_PIPELINE_RULES: TransitionRule[] = [
  { from: "intelligence_queue", to: "design_queue", allowedRoles: ["cto", "pm"] },
  { from: "intelligence_queue", to: "cancelled",    allowedRoles: ["pm"] },
  { from: "design_queue",       to: "backlog",      allowedRoles: ["cto"] },
  { from: "design_queue",       to: "cancelled",    allowedRoles: ["pm"] },
  ...DEFAULT_TRANSITION_RULES,
];

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

export const KANBAN_TEMPLATES: KanbanTemplate[] = [
  {
    id: "standard",
    name: "Standard (Default)",
    description: "Full software pipeline with QA and deployment gates",
    previewColumns: ["Backlog", "Todo", "Ready", "In Progress", "In Review", "QA", "Deploy", "Done"],
    config: { columns: DEFAULT_COLUMNS, rules: DEFAULT_TRANSITION_RULES },
  },
  {
    id: "simple",
    name: "Simple Kanban",
    description: "Lightweight 4-column board — ideal for fast-moving teams",
    previewColumns: ["Backlog", "In Progress", "Done"],
    config: { columns: SIMPLE_COLUMNS, rules: SIMPLE_RULES },
  },
  {
    id: "scrum",
    name: "Scrum",
    description: "Sprint-based workflow with product backlog and sprint planning gate",
    previewColumns: ["Product Backlog", "Sprint Backlog", "In Progress", "In Review", "Done"],
    config: { columns: SCRUM_COLUMNS, rules: SCRUM_RULES },
  },
  {
    id: "design_pipeline",
    name: "Design Pipeline",
    description: "Adds intelligence and design queues before the development pipeline",
    previewColumns: ["Intelligence Queue", "Design Queue", "Backlog", "Todo", "Ready", "In Progress", "..."],
    config: { columns: DESIGN_PIPELINE_COLUMNS, rules: DESIGN_PIPELINE_RULES },
  },
];
