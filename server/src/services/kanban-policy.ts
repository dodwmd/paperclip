/**
 * Server-side Kanban policy engine.
 *
 * Imports pure data and pure functions from @paperclipai/shared.
 * This module adds server-specific helpers (WIP DB queries, actor role
 * resolution) on top of the shared policy primitives.
 */
export {
  DEFAULT_TRANSITION_RULES,
  DEFAULT_COLUMNS,
  WIP_LIMITS,
  checkTransitionPolicy,
  checkWipPolicy,
  resolveKanbanConfig,
  type TransitionRule,
  type ColumnDefinition,
  type KanbanConfig,
  type TransitionCheckResult,
  type TransitionDeniedReason,
  type TransitionActor,
  type ActorKind,
} from "@paperclipai/shared";
